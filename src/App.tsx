import {
  DisconnectOutlined,
  LinkOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Alert, Button, Descriptions, Modal, Space, Spin, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AddressBalance,
  AssetKind,
  OpenApiUtxo,
  ResultState,
  RuneIndexerEntry,
  RuneIndexerUtxo,
  TimeLockBlocks,
  TimeLockRecord,
} from "./types";
import {
  buildRuneTimeLockDeposit,
  buildSingleUtxoTimeLockDeposit,
  buildTimeLockUnlockTx,
  deriveTimeLockAddress,
} from "./lib/timelock";
import {
  getAddressBalance,
  getAddressBrc20Balances,
  getAddressRuneUtxos,
  getAvailableUtxos,
  getBrc20AvailableBalance,
  getRuneMetadata,
} from "./lib/openapi";
import type { Brc20Balance } from "./lib/openapi";
import { getRecommendedFeeRate } from "./lib/mempool";
import { copyText, shortAddress } from "./lib/format";
import { pushSignedPsbt, signPsbtCompat, signPsbtsCompat } from "./lib/wallet";
import { DEFAULT_FEE_RATE } from "./constants";
import { getErrorMessage } from "./lib/errors";
import { normalizeSignedPsbtToHex, toUniSatSignInputs } from "./lib/psbt";
import { useOpenApiKey } from "./hooks/useOpenApiKey";
import { useWalletUtxos } from "./hooks/useWalletUtxos";
import { useWalletConnection } from "./hooks/useWalletConnection";
import { WalletInfoCard } from "./components/WalletInfoCard";
import { OperationPanel } from "./components/OperationPanel";
import { isFractalChain } from "./lib/chain";
import { isSelectableUtxo } from "./lib/utxo";

const TIMELOCK_STORAGE_KEY = "bitcoin_asset_timelock_records";

function readRecords(): TimeLockRecord[] {
  try {
    const stored = window.localStorage.getItem(TIMELOCK_STORAGE_KEY);
    const value = stored ? JSON.parse(stored) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function isSupportedWalletAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  return (
    value.startsWith("bc1q") ||
    value.startsWith("bc1p") ||
    value.startsWith("tb1q") ||
    value.startsWith("tb1p")
  );
}

function isBip68NotFinalError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("non-bip68-final");
}

function isAlreadyBroadcastError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return /already.*(mempool|known|block chain|exists)|txn-already-known/.test(message);
}

function validateRuneName(name: string, fractal: boolean): string | undefined {
  const value = name.trim();
  if (!value) return "Enter the Rune name as a network safety check.";
  const expected = fractal ? /^[a-z]+$/ : /^[A-Z]+$/;
  if (!expected.test(value))
    return fractal
      ? "Fractal Runes use lowercase letters only (for example fractal)."
      : "Bitcoin Runes use uppercase letters only (for example UNCOMMONGOODS).";
  return undefined;
}

function compareDecimalAmounts(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
    if (!match) throw new Error(`Invalid decimal amount: ${value}`)
    return { whole: match[1], fraction: match[2] || "" }
  }
  const leftParts = parse(left)
  const rightParts = parse(right)
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length)
  const toInteger = ({ whole, fraction }: { whole: string; fraction: string }) =>
    BigInt(`${whole}${fraction.padEnd(scale, "0")}`)
  const leftInteger = toInteger(leftParts)
  const rightInteger = toInteger(rightParts)
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0
}

function selectRuneUtxo(
  runeUtxos: RuneIndexerUtxo[],
  metadata: RuneIndexerEntry,
  amount: string,
): { utxos: OpenApiUtxo[]; balance: string; hasUnallocatedRunes: boolean } {
  if (!/^\d+$/.test(amount.trim()) || BigInt(amount.trim()) <= 0n)
    throw new Error("Rune amount must be a positive integer in base units.");
  const required = BigInt(amount.trim());
  const candidates = runeUtxos
    .map((item) => ({
      item,
      balance: item.runes.find((rune) => rune.runeid === metadata.runeid)
        ?.amount,
    }))
    .filter(
      (
        item,
      ): item is { item: RuneIndexerUtxo; balance: string } =>
        typeof item.balance === "string" &&
        /^\d+$/.test(item.balance) &&
        BigInt(item.balance) > 0n,
    );
  const total = candidates.reduce(
    (sum, candidate) => sum + BigInt(candidate.balance),
    0n,
  );
  if (total < required)
    throw new Error(
      `Transferable ${metadata.rune} balance is ${total.toString()} base units, which is less than the requested ${amount.trim()}.`,
    );

  const compareCandidates = (
    left: (typeof candidates)[number],
    right: (typeof candidates)[number],
  ) => {
    const byBalance = BigInt(left.balance) < BigInt(right.balance) ? -1 : BigInt(left.balance) > BigInt(right.balance) ? 1 : 0;
    return byBalance || left.item.txid.localeCompare(right.item.txid) || left.item.vout - right.item.vout;
  };
  // Preserve the previous low-input behavior when one source is enough. When
  // it is not, the largest sources first give the smallest possible input count.
  const single = [...candidates]
    .filter((candidate) => BigInt(candidate.balance) >= required)
    .sort(compareCandidates)[0];
  const selected = single ? [single] : [];
  let selectedBalance = single ? BigInt(single.balance) : 0n;
  if (!single) {
    for (const candidate of [...candidates].sort((left, right) => -compareCandidates(left, right))) {
      if (selectedBalance >= required) break;
      selected.push(candidate);
      selectedBalance += BigInt(candidate.balance);
    }
  }
  return {
    balance: selectedBalance.toString(),
    hasUnallocatedRunes: selected.some((candidate) => candidate.item.runes.some(
      (rune) =>
        rune.runeid !== metadata.runeid &&
        /^\d+$/.test(rune.amount) &&
        BigInt(rune.amount) > 0n,
    )),
    utxos: selected.map(({ item }) => ({
      address: item.address,
      satoshi: item.satoshi,
      scriptPk: item.scriptPk,
      txid: item.txid,
      vout: item.vout,
      scriptType: item.scriptPk.startsWith("5120") ? "P2TR" : undefined,
    })),
  };
}

function selectAutomaticBrc20FundingUtxo(
  utxos: OpenApiUtxo[],
): OpenApiUtxo {
  const fundingUtxo = [...utxos]
    .filter(isSelectableUtxo)
    .sort((left, right) => right.satoshi - left.satoshi)[0];
  if (!fundingUtxo)
    throw new Error("Load wallet UTXOs before creating a BRC-20 time lock.");
  return fundingUtxo;
}

function automaticFeeUtxoCandidates(utxos: OpenApiUtxo[]): OpenApiUtxo[] {
  // Larger UTXOs first minimizes the number of fee inputs the transaction uses.
  return [...utxos]
    .filter(isSelectableUtxo)
    .sort((left, right) => right.satoshi - left.satoshi);
}

function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [ticker, setTicker] = useState("");
  const [amount, setAmount] = useState("");
  const [brc20Balances, setBrc20Balances] = useState<Brc20Balance[]>([]);
  const [brc20BalancesLoading, setBrc20BalancesLoading] = useState(false);
  const [assetKind, setAssetKind] = useState<AssetKind>("brc20");
  const [runeReference, setRuneReference] = useState("");
  const [lockBlocks, setLockBlocks] = useState<TimeLockBlocks>(3);
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [walletBalance, setWalletBalance] = useState<AddressBalance | null>(
    null,
  );
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const [loadingText, setLoadingText] = useState("");
  const [records, setRecords] = useState<TimeLockRecord[]>(readRecords);
  const feeRateManuallySet = useRef(false);

  const resetBuiltState = useCallback(() => {
    setResult({ status: "idle" });
  }, []);
  const wallet = useWalletConnection((msg) => messageApi.error(msg));
  const walletUtxos = useWalletUtxos();
  const clearLoadedData = useCallback(() => {
    setWalletBalance(null);
    walletUtxos.clear();
    resetBuiltState();
  }, [resetBuiltState, walletUtxos]);
  const {
    openApiKey,
    openApiKeyForRequests,
    hasOpenApiKey,
    handleOpenApiKeyChange,
  } = useOpenApiKey(clearLoadedData);

  useEffect(() => {
    window.localStorage.setItem(TIMELOCK_STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    if (!hasOpenApiKey || !wallet.connected || !wallet.chain) return;
    let cancelled = false;
    void getRecommendedFeeRate(String(wallet.chain), openApiKeyForRequests)
      .then((recommendedFeeRate) => {
        if (!cancelled && !feeRateManuallySet.current) {
          setFeeRate(recommendedFeeRate);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hasOpenApiKey, openApiKeyForRequests, wallet.chain, wallet.connected]);

  useEffect(() => {
    if (assetKind !== "brc20" || !hasOpenApiKey || !wallet.connected || !wallet.address || !wallet.chain) {
      setBrc20Balances([]);
      setBrc20BalancesLoading(false);
      return;
    }
    let cancelled = false;
    setBrc20BalancesLoading(true);
    void getAddressBrc20Balances(
      wallet.address,
      openApiKeyForRequests,
      wallet.chain,
    )
      .then((balances) => {
        if (!cancelled) {
          setBrc20Balances(balances.filter((balance) =>
            compareDecimalAmounts(balance.availableBalance, "0") > 0,
          ));
        }
      })
      .catch(() => {
        if (!cancelled) setBrc20Balances([]);
      })
      .finally(() => {
        if (!cancelled) setBrc20BalancesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetKind, hasOpenApiKey, openApiKeyForRequests, wallet.address, wallet.chain, wallet.connected]);

  const timeLockAddress = useMemo(() => {
    if (!wallet.pubKey) return "";
    try {
      return deriveTimeLockAddress(wallet.pubKey, lockBlocks, wallet.chain);
    } catch {
      return "";
    }
  }, [lockBlocks, wallet.pubKey, wallet.chain]);
  const canFetchUtxos =
    wallet.connected &&
    !!wallet.address &&
    !!wallet.pubKey &&
    isSupportedWalletAddress(wallet.address);
  const canCreate =
    assetKind === "brc20"
      ? canFetchUtxos &&
        !!ticker.trim() &&
        !!amount.trim()
      : canFetchUtxos && !!runeReference.trim() && !!amount.trim();
  const loading = !!loadingText;

  const handleConnect = async () => {
    setLoadingText("Connecting UniSat Wallet...");
    try {
      await wallet.connect();
    } catch (error) {
      messageApi.error(getErrorMessage(error));
    } finally {
      setLoadingText("");
    }
  };

  const handleDisconnect = async () => {
    await wallet.disconnect();
    clearLoadedData();
  };

  const handleSwitchChain = async (chain: import("./types").ChainType) => {
    setLoadingText(`Switching UniSat to ${chain}...`);
    try {
      feeRateManuallySet.current = false;
      await wallet.switchChain(chain);
      clearLoadedData();
      messageApi.success(
        `Switched to ${chain}. UTXOs will be refreshed when you create a deposit.`,
      );
    } catch (error) {
      messageApi.error(getErrorMessage(error));
    } finally {
      setLoadingText("");
    }
  };

  const handleCopy = async (value: string, label = "Copied") => {
    try {
      await copyText(value);
      messageApi.success(label);
    } catch (error) {
      messageApi.error(getErrorMessage(error));
    }
  };

  const fetchWalletUtxos = async () => {
    if (!canFetchUtxos) {
      messageApi.warning("Connect your wallet first.");
      return;
    }
    if (!hasOpenApiKey) {
      messageApi.warning("Enter your UniSat OpenAPI key first.");
      return;
    }
    setLoadingText("Loading wallet UTXOs...");
    resetBuiltState();
    try {
      const [balance, utxos] = await Promise.all([
        getAddressBalance(wallet.address, openApiKeyForRequests, wallet.chain),
        getAvailableUtxos(
          wallet.address,
          openApiKeyForRequests,
          500,
          wallet.chain,
        ),
      ]);
      setWalletBalance(balance);
      walletUtxos.setFetchedUtxos(utxos);
      if (!utxos.length)
        messageApi.warning("No available UTXOs were found for this wallet.");
    } catch (error) {
      messageApi.error(getErrorMessage(error));
    } finally {
      setLoadingText("");
    }
  };

  const createRecord = (
    params: Omit<TimeLockRecord, "id" | "createdAt" | "status">,
    status: TimeLockRecord["status"] = "locked",
  ) => {
    const id =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record: TimeLockRecord = {
      ...params,
      id,
      createdAt: new Date().toISOString(),
      status,
    };
    const nextRecords = [record, ...readRecords()];
    window.localStorage.setItem(TIMELOCK_STORAGE_KEY, JSON.stringify(nextRecords));
    setRecords(nextRecords);
    return record;
  };

  const updateStoredRecord = (
    id: string,
    update: (record: TimeLockRecord) => TimeLockRecord,
  ) => {
    const nextRecords = readRecords().map((item) =>
      item.id === id ? update(item) : item,
    );
    window.localStorage.setItem(TIMELOCK_STORAGE_KEY, JSON.stringify(nextRecords));
    setRecords(nextRecords);
  };

  const broadcastPendingBrc20 = async (record: TimeLockRecord) => {
    const signedPsbts = record.pendingPsbts;
    const expectedTxids = [
      record.initialCommitTxid,
      record.initialRevealTxid,
      record.transferToLockTxid,
      record.lockCommitTxid,
      record.lockRevealTxid,
    ];
    if (!signedPsbts || signedPsbts.length !== 5 || expectedTxids.some((txid) => !txid)) {
      throw new Error("This pending BRC-20 record is missing its signed transaction chain and cannot be resumed.");
    }
    const startStep = record.broadcastStep || 0;
    for (let index = startStep; index < 5; index += 1) {
      setLoadingText(`Broadcasting ${index + 1}/5...`);
      let txid: string | undefined;
      try {
        txid = await pushSignedPsbt(signedPsbts[index]);
      } catch (error) {
        // A timeout can occur after the wallet has accepted the transaction.
        // Re-submitting a known tx is safe and counts as progress.
        if (!isAlreadyBroadcastError(error)) throw error;
      }
      if (txid && txid !== expectedTxids[index]) {
        throw new Error(
          `Broadcast txid differs from the saved transaction at step ${index + 1}: ${txid}`,
        );
      }
      updateStoredRecord(record.id, (item) => ({
        ...item,
        broadcastStep: index + 1,
      }));
    }
    updateStoredRecord(record.id, (item) => ({
      ...item,
      status: "locked",
      broadcastStep: undefined,
      pendingPsbts: undefined,
    }));
    setResult({
      status: "timelock_success",
      commitTxid: record.lockCommitTxid!,
      revealTxid: record.lockRevealTxid!,
      timeLockAddress: record.timeLockAddress,
    });
    messageApi.success("All five deposit transactions were broadcast. The final transfer inscription is locked.");
    void fetchWalletUtxos();
  };

  const confirmLock = (params: {
    asset: string;
    timeLockAddress: string;
    estimatedCost: number;
  }) =>
    new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: "Confirm Asset Lock",
        width: 640,
        content: (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Current Network">
              {String(wallet.chain)}
            </Descriptions.Item>
            <Descriptions.Item label="Current Address">
              {wallet.address}
            </Descriptions.Item>
            <Descriptions.Item label="Time-lock Address">
              {params.timeLockAddress}
            </Descriptions.Item>
            <Descriptions.Item label="Lock Period">
              {lockBlocks} blocks
            </Descriptions.Item>
            <Descriptions.Item label="Locked Asset">
              {params.asset}
            </Descriptions.Item>
            <Descriptions.Item label="Estimated Cost">
              {params.estimatedCost} sats
            </Descriptions.Item>
          </Descriptions>
        ),
        okText: "Confirm Lock",
        cancelText: "Cancel",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

  const handleCreate = async () => {
    if (!canCreate || !hasOpenApiKey) {
      messageApi.warning(
        "Enter the token and amount, then configure an OpenAPI key.",
      );
      return;
    }
    setResult({ status: "idle" });
    try {
      if (!isSupportedWalletAddress(wallet.address)) {
        throw new Error(
          "Only native SegWit (bc1q / tb1q) and Taproot (bc1p / tb1p) wallet addresses are supported. P2PKH and P2SH are not supported.",
        );
      }
      if (assetKind === "brc20" && records.some(
        (record) =>
          record.status === "pending" &&
          record.ownerAddress === wallet.address &&
          record.chain === wallet.chain,
      )) {
        throw new Error("A BRC-20 deposit is still pending. Continue its broadcast from the local record before creating another one.");
      }
      if (assetKind === "brc20") {
        setLoadingText("Checking BRC-20 available balance...");
        const availableBalance = await getBrc20AvailableBalance(
          wallet.address,
          ticker,
          openApiKeyForRequests,
          wallet.chain,
        );
        if (compareDecimalAmounts(availableBalance, amount) < 0) {
          throw new Error(
            `BRC-20 available balance for ${ticker.trim().toLowerCase()} is ${availableBalance}, which is less than the requested lock amount of ${amount.trim()}.`,
          );
        }
      }
      setLoadingText("Loading current wallet UTXOs...");
      const currentWalletUtxos = await getAvailableUtxos(
        wallet.address,
        openApiKeyForRequests,
        500,
        wallet.chain,
      );
      walletUtxos.setFetchedUtxos(currentWalletUtxos);
      if (assetKind === "runes") {
        const fractal = isFractalChain(String(wallet.chain));
        if (!/^\d+:\d+$/.test(runeReference.trim())) {
          const runeError = validateRuneName(runeReference, fractal);
          if (runeError) throw new Error(runeError);
        }
        setLoadingText("Looking up Rune metadata and transferable UTXOs...");
        const metadata = await getRuneMetadata(
          runeReference,
          openApiKeyForRequests,
          wallet.chain,
        );
        const metadataNameError = validateRuneName(metadata.rune, fractal);
        if (metadataNameError)
          throw new Error(
            `The resolved Rune does not match the connected network: ${metadataNameError}`,
          );
        const runeUtxos = await getAddressRuneUtxos(
          wallet.address,
          metadata.runeid,
          openApiKeyForRequests,
          wallet.chain,
        );
        const source = selectRuneUtxo(runeUtxos, metadata, amount);
        setLoadingText("Building the Runestone time-lock transaction...");
        const deposit = buildRuneTimeLockDeposit({
          userAddress: wallet.address,
          pubKey: wallet.pubKey,
          lockBlocks,
          runeId: metadata.runeid,
          runeName: metadata.rune,
          runeAmount: amount,
          runeBalance: source.balance,
          // Fee inputs are chosen automatically. Always retain a Rune-change
          // output so any Runes on an automatically chosen fee UTXO return to
          // the wallet rather than being assigned to the lock output.
          hasUnallocatedRunes: true,
          runeUtxos: source.utxos,
          feeUtxos: automaticFeeUtxoCandidates(currentWalletUtxos),
          feeRate,
          chain: wallet.chain,
        });
        setLoadingText("");
        if (!(await confirmLock({
          asset: `${amount.trim()} ${metadata.rune}`,
          timeLockAddress: deposit.timeLockAddress,
          estimatedCost: deposit.estimatedFee,
        }))) return;
        setLoadingText(
          "Review and sign the Runestone time-lock transaction in UniSat...",
        );
        const signed = await signPsbtCompat(deposit.psbtHex, {
          autoFinalized: true,
          toSignInputs: toUniSatSignInputs(deposit.toSignInputs),
        });
        setLoadingText("Broadcasting the Runestone time-lock transaction...");
        const txid = await pushSignedPsbt(normalizeSignedPsbtToHex(signed));
        createRecord({
          ownerAddress: wallet.address,
          chain: wallet.chain,
          assetKind: "runes",
          ticker: metadata.rune,
          amount: amount.trim(),
          runeId: metadata.runeid,
          runeName: metadata.rune,
          lockBlocks,
          timeLockAddress: deposit.timeLockAddress,
          commitTxid: txid,
          revealTxid: txid,
          inscriptionTxid: txid,
          inscriptionVout: 1,
          inscriptionSatoshi: deposit.outputs[1].satoshi,
        });
        setResult({
          status: "timelock_success",
          commitTxid: txid,
          revealTxid: txid,
          timeLockAddress: deposit.timeLockAddress,
        });
        messageApi.success(
          "The Rune transfer was broadcast to the time-lock address.",
        );
        void fetchWalletUtxos();
        return;
      }
      setLoadingText(
        "Building the five-transaction BRC-20 deposit from one UTXO...",
      );
      const fundingUtxo = selectAutomaticBrc20FundingUtxo(
        currentWalletUtxos,
      );
      const deposit = buildSingleUtxoTimeLockDeposit({
        userAddress: wallet.address,
        pubKey: wallet.pubKey,
        ticker,
        amount,
        lockBlocks,
        feeRate,
        fundingUtxo,
        chain: wallet.chain,
      });
      setLoadingText("");
      if (!(await confirmLock({
        asset: `${amount.trim()} ${ticker.trim().toLowerCase()}`,
        timeLockAddress: deposit.timeLockAddress,
        estimatedCost: deposit.totalEstimatedFee,
      }))) return;
      setLoadingText("Review and sign all five transactions in UniSat...");
      const signedPsbts = await signPsbtsCompat(
        deposit.steps.map((step) => step.psbtHex),
        deposit.steps.map((step) => ({
          autoFinalized: true,
          toSignInputs: toUniSatSignInputs(step.toSignInputs),
        })),
      );
      const pendingRecord = createRecord({
        ownerAddress: wallet.address,
        chain: wallet.chain,
        assetKind: "brc20",
        ticker: ticker.trim().toLowerCase(),
        amount: amount.trim(),
        lockBlocks,
        timeLockAddress: deposit.timeLockAddress,
        commitTxid: deposit.steps[3].txid,
        revealTxid: deposit.steps[4].txid,
        initialCommitTxid: deposit.steps[0].txid,
        initialRevealTxid: deposit.steps[1].txid,
        transferToLockTxid: deposit.steps[2].txid,
        lockCommitTxid: deposit.steps[3].txid,
        lockRevealTxid: deposit.steps[4].txid,
        inscriptionTxid: deposit.steps[4].txid,
        inscriptionVout: 0,
        inscriptionSatoshi: deposit.inscriptionSatoshi,
        broadcastStep: 0,
        pendingPsbts: signedPsbts.map(normalizeSignedPsbtToHex),
      }, "pending");
      await broadcastPendingBrc20(pendingRecord);
    } catch (error) {
      const msg = getErrorMessage(error);
      setResult({ status: "error", message: msg });
      messageApi.error(msg);
    } finally {
      setLoadingText("");
    }
  };

  const handleResumeBrc20 = async (record: TimeLockRecord) => {
    if (!wallet.connected || !wallet.address || !wallet.pubKey) {
      messageApi.warning("Connect the wallet that created this time lock first.");
      return;
    }
    if (record.ownerAddress !== wallet.address || record.chain !== wallet.chain) {
      messageApi.error("Switch UniSat to the wallet and network that created this pending deposit before continuing.");
      return;
    }
    setResult({ status: "idle" });
    try {
      await broadcastPendingBrc20(record);
    } catch (error) {
      const msg = getErrorMessage(error);
      setResult({ status: "error", message: msg });
      messageApi.error(msg);
    } finally {
      setLoadingText("");
    }
  };

  const handleUnlock = async (record: TimeLockRecord) => {
    if (!wallet.connected || !wallet.address || !wallet.pubKey) {
      messageApi.warning(
        "Connect the wallet that created this time lock first.",
      );
      return;
    }
    if (wallet.address !== record.ownerAddress) {
      messageApi.error(
        "The connected wallet differs from the wallet that created this record, so it cannot unlock it.",
      );
      return;
    }
    if (record.chain && wallet.chain !== record.chain) {
      messageApi.error(
        `This lock was created on ${record.chain}. Switch UniSat back to that network before unlocking.`,
      );
      return;
    }
    if (!isSupportedWalletAddress(wallet.address)) {
      messageApi.error(
        "Only native SegWit (bc1q / tb1q) and Taproot (bc1p / tb1p) wallet addresses are supported. P2PKH and P2SH are not supported.",
      );
      return;
    }
    if (!hasOpenApiKey) {
      messageApi.warning("Enter your UniSat OpenAPI key first.");
      return;
    }
    setResult({ status: "idle" });
    const lockInscriptionUtxo: OpenApiUtxo = {
      txid: record.inscriptionTxid,
      vout: record.inscriptionVout,
      satoshi: record.inscriptionSatoshi,
      // The time-lock script is deterministically reconstructed from the
      // connected owner's public key and the saved block count in
      // buildTimeLockUnlockTx.
      scriptPk: "",
    };
    try {
      setLoadingText("Loading wallet UTXOs for the unlock fee...");
      const feeUtxos = await getAvailableUtxos(
        wallet.address,
        openApiKeyForRequests,
        500,
        wallet.chain,
      );
      setLoadingText("Building the time-lock unlock transaction...");
      const tx = buildTimeLockUnlockTx({
        userAddress: wallet.address,
        pubKey: wallet.pubKey,
        lockBlocks: record.lockBlocks,
        inscriptionUtxo: lockInscriptionUtxo,
        feeUtxos,
        feeRate,
        chain: wallet.chain,
      });
      setLoadingText(
        `Sign the ${record.lockBlocks}-block time-lock unlock transaction in your wallet...`,
      );
      const signed = await signPsbtCompat(tx.psbtHex, {
        autoFinalized: true,
        toSignInputs: toUniSatSignInputs(tx.toSignInputs),
      });
      setLoadingText("Broadcasting the unlock transaction...");
      const unlockTxid = await pushSignedPsbt(normalizeSignedPsbtToHex(signed));
      setRecords((current) =>
        current.map((item) =>
          item.id === record.id
            ? { ...item, status: "unlocked", unlockTxid }
            : item,
        ),
      );
      setResult({ status: "success", txid: unlockTxid, label: "Unlock" });
      messageApi.success(
        `The time lock was released. The ${record.assetKind === "runes" ? "Rune" : "BRC-20 transfer inscription"} is returning to your wallet.`,
      );
      void fetchWalletUtxos();
    } catch (error) {
      let msg = getErrorMessage(error);
      if (isBip68NotFinalError(error)) {
        msg = `Time lock not yet mature (non-BIP68-final). Wait for ${record.lockBlocks} confirmations before trying again.`;
      }
      setResult({ status: "error", message: msg });
      messageApi.error(msg);
    } finally {
      setLoadingText("");
    }
  };

  const walletStatus = wallet.connected ? (
    <Space wrap>
      <Button
        icon={<WalletOutlined />}
        onClick={() => handleCopy(wallet.address, "Wallet address copied")}
      >
        {shortAddress(wallet.address)}
      </Button>
      <Button icon={<DisconnectOutlined />} onClick={handleDisconnect}>
        Disconnect
      </Button>
    </Space>
  ) : (
    <Button type="primary" icon={<WalletOutlined />} onClick={handleConnect}>
      Connect UniSat Wallet
    </Button>
  );

  return (
    <main className="app-shell">
      {contextHolder}
      <Spin spinning={loading} tip={loadingText || undefined} fullscreen />
      <section className="tool-panel">
        <div className="topbar">
          <div>
            <Typography.Title level={2}>
              Bitcoin Asset Time Lock
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              Lock BRC-20 transfer inscriptions or Runes with a Taproot relative
              block time lock.
            </Typography.Paragraph>
          </div>
          {walletStatus}
        </div>
        <Alert
          type="warning"
          showIcon
          message="Review every parameter before signing"
          description="This tool supports native SegWit (bc1q / tb1q) and Taproot (bc1p / tb1p) addresses only; P2PKH and P2SH are not supported. Switch UniSat to the intended network before loading UTXOs. The lock period is measured in relative blocks after confirmation. LocalStorage records are not a backup."
        />
        {!wallet.walletDetected && (
          <Alert
            className="mt-16"
            type="info"
            showIcon
            message="UniSat Wallet was not detected"
            description="Install and unlock UniSat, then refresh this page."
            action={
              <Button
                href="https://unisat.io"
                target="_blank"
                icon={<LinkOutlined />}
              >
                Open UniSat
              </Button>
            }
          />
        )}
        <WalletInfoCard
          address={wallet.address}
          chain={wallet.chain}
          openApiKey={openApiKey}
          onOpenApiKeyChange={handleOpenApiKeyChange}
          onSwitchChain={handleSwitchChain}
        />
        <OperationPanel
          ticker={ticker}
          brc20Balances={brc20Balances}
          brc20BalancesLoading={brc20BalancesLoading}
          amount={amount}
          assetKind={assetKind}
          runeReference={runeReference}
          fractalNetwork={isFractalChain(String(wallet.chain))}
          lockBlocks={lockBlocks}
          feeRate={feeRate}
          timeLockAddress={timeLockAddress}
          hasOpenApiKey={hasOpenApiKey}
          canCreate={canCreate}
          result={result}
          records={records}
          onTickerChange={(value) => {
            setTicker(value);
            setAmount("");
            resetBuiltState();
          }}
          onAmountChange={(value) => {
            setAmount(value);
            resetBuiltState();
          }}
          onAssetKindChange={(value) => {
            setAssetKind(value);
            resetBuiltState();
          }}
          onRuneReferenceChange={(value) => {
            setRuneReference(value);
            resetBuiltState();
          }}
          onLockBlocksChange={(value) => {
            setLockBlocks(value);
            resetBuiltState();
          }}
          onFeeRateChange={(value) => {
            feeRateManuallySet.current = true;
            setFeeRate(value);
            resetBuiltState();
          }}
          onCreate={handleCreate}
          onResume={handleResumeBrc20}
          onUnlock={handleUnlock}
          onCopy={handleCopy}
        />
      </section>
    </main>
  );
}

export default App;
