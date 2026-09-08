import {
  DisconnectOutlined,
  LinkOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Alert, Button, Space, Spin, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AddressBalance,
  AssetKind,
  BuiltTimeLockTx,
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
  getAddressRuneUtxos,
  getAvailableUtxos,
  getBlockchainHeight,
  getRuneMetadata,
  getRuneUtxoBalances,
} from "./lib/openapi";
import { getRecommendedFeeRate } from "./lib/mempool";
import { copyText, shortAddress } from "./lib/format";
import { pushSignedPsbt, signPsbtCompat, signPsbtsCompat } from "./lib/wallet";
import { DEFAULT_FEE_RATE } from "./constants";
import { getErrorMessage } from "./lib/errors";
import { normalizeSignedPsbtToHex, toUniSatSignInputs } from "./lib/psbt";
import { useOpenApiKey } from "./hooks/useOpenApiKey";
import { useUtxoSelection } from "./hooks/useUtxoSelection";
import { useWalletConnection } from "./hooks/useWalletConnection";
import { WalletInfoCard } from "./components/WalletInfoCard";
import { OperationPanel } from "./components/OperationPanel";
import { isFractalChain } from "./lib/chain";

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

function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [ticker, setTicker] = useState("fractal");
  const [amount, setAmount] = useState("");
  const [assetKind, setAssetKind] = useState<AssetKind>("brc20");
  const [runeReference, setRuneReference] = useState("");
  const [lockBlocks, setLockBlocks] = useState<TimeLockBlocks>(3);
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [walletBalance, setWalletBalance] = useState<AddressBalance | null>(
    null,
  );
  const [builtTx, setBuiltTx] = useState<BuiltTimeLockTx | null>(null);
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const [loadingText, setLoadingText] = useState("");
  const [records, setRecords] = useState<TimeLockRecord[]>(readRecords);

  const resetBuiltState = useCallback(() => {
    setBuiltTx(null);
    setResult({ status: "idle" });
  }, []);
  const wallet = useWalletConnection((msg) => messageApi.error(msg));
  const walletUtxos = useUtxoSelection(resetBuiltState);
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
    let cancelled = false;
    void getRecommendedFeeRate(String(wallet.chain))
      .then((recommendedFeeRate) => {
        if (!cancelled) setFeeRate(recommendedFeeRate);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wallet.chain]);

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
        !!amount.trim() &&
        walletUtxos.selectedUtxos.length === 1
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
      await wallet.switchChain(chain);
      clearLoadedData();
      messageApi.success(
        `Switched to ${chain}. Load UTXOs for the new network.`,
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
  ) => {
    const id =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setRecords((current) => [
      { ...params, id, createdAt: new Date().toISOString(), status: "locked" },
      ...current,
    ]);
  };

  const handleCreate = async () => {
    if (!canCreate || !hasOpenApiKey) {
      messageApi.warning(
        "Enter the token, amount, select one UTXO, and configure an OpenAPI key.",
      );
      return;
    }
    setBuiltTx(null);
    setResult({ status: "idle" });
    try {
      if (!isSupportedWalletAddress(wallet.address)) {
        throw new Error(
          "Only native SegWit (bc1q / tb1q) and Taproot (bc1p / tb1p) wallet addresses are supported. P2PKH and P2SH are not supported.",
        );
      }
      const fundingUtxo = walletUtxos.selectedUtxos[0];
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
        const sourceKeys = new Set(
          source.utxos.map((utxo) => `${utxo.txid}:${utxo.vout}`),
        );
        const feeInputs = walletUtxos.selectedUtxos.filter(
          (utxo) => !sourceKeys.has(`${utxo.txid}:${utxo.vout}`),
        );
        const feeInputRuneBalances = await Promise.all(
          feeInputs.map((utxo) =>
            getRuneUtxoBalances(
              utxo.txid,
              utxo.vout,
              openApiKeyForRequests,
              wallet.chain,
            ),
          ),
        );
        const feeInputsCarryRunes = feeInputRuneBalances.some((balances) =>
          balances.some(
            (rune) => /^\d+$/.test(rune.amount) && BigInt(rune.amount) > 0n,
          ),
        );
        setLoadingText("Building the Runestone time-lock transaction...");
        const deposit = buildRuneTimeLockDeposit({
          userAddress: wallet.address,
          pubKey: wallet.pubKey,
          lockBlocks,
          runeId: metadata.runeid,
          runeName: metadata.rune,
          runeAmount: amount,
          runeBalance: source.balance,
          hasUnallocatedRunes:
            source.hasUnallocatedRunes || feeInputsCarryRunes,
          runeUtxos: source.utxos,
          feeUtxos: walletUtxos.selectedUtxos,
          feeRate,
          chain: wallet.chain,
        });
        setBuiltTx(deposit);
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
      setBuiltTx(deposit);
      setLoadingText("Review and sign all five transactions in UniSat...");
      const signedPsbts = await signPsbtsCompat(
        deposit.steps.map((step) => step.psbtHex),
        deposit.steps.map((step) => ({
          autoFinalized: true,
          toSignInputs: toUniSatSignInputs(step.toSignInputs),
        })),
      );
      const broadcast = async (step: number) => {
        const built = deposit.steps[step - 1];
        setLoadingText(`Broadcasting ${step}/5: ${built.label}...`);
        const txid = await pushSignedPsbt(
          normalizeSignedPsbtToHex(signedPsbts[step - 1]),
        );
        if (txid !== built.txid) {
          throw new Error(
            `Broadcast txid differs from the pre-built transaction. Stopped subsequent broadcasts: ${txid}`,
          );
        }
        return txid;
      };
      const initialCommitTxid = await broadcast(1);
      const initialRevealTxid = await broadcast(2);
      const transferToLockTxid = await broadcast(3);
      const lockCommitTxid = await broadcast(4);
      const lockRevealTxid = await broadcast(5);
      createRecord({
        ownerAddress: wallet.address,
        chain: wallet.chain,
        assetKind: "brc20",
        ticker: ticker.trim().toLowerCase(),
        amount: amount.trim(),
        lockBlocks,
        timeLockAddress: deposit.timeLockAddress,
        commitTxid: lockCommitTxid,
        revealTxid: lockRevealTxid,
        initialCommitTxid,
        initialRevealTxid,
        transferToLockTxid,
        lockCommitTxid,
        lockRevealTxid,
        inscriptionTxid: lockRevealTxid,
        inscriptionVout: 0,
        inscriptionSatoshi: deposit.inscriptionSatoshi,
      });
      setResult({
        status: "timelock_success",
        commitTxid: lockCommitTxid,
        revealTxid: lockRevealTxid,
        timeLockAddress: deposit.timeLockAddress,
      });
      messageApi.success(
        "All five deposit transactions were broadcast. The final transfer inscription is locked.",
      );
      void fetchWalletUtxos();
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
    setBuiltTx(null);
    setResult({ status: "idle" });
    let lockInscriptionUtxo: import("./types").OpenApiUtxo | undefined;
    try {
      setLoadingText("Looking up the locked transfer inscription UTXO...");
      const [lockedUtxos, feeUtxos] = await Promise.all([
        getAvailableUtxos(
          record.timeLockAddress,
          openApiKeyForRequests,
          500,
          wallet.chain,
        ),
        getAvailableUtxos(
          wallet.address,
          openApiKeyForRequests,
          500,
          wallet.chain,
        ),
      ]);
      lockInscriptionUtxo = lockedUtxos.find(
        (utxo) =>
          utxo.txid === record.inscriptionTxid &&
          utxo.vout === record.inscriptionVout,
      );
      if (
        !lockInscriptionUtxo ||
        lockInscriptionUtxo.isSpent ||
        lockInscriptionUtxo.isSpending
      ) {
        throw new Error(
          "The recorded transfer inscription UTXO was not found or is no longer spendable. It may be unindexed, already moved, or on another network.",
        );
      }
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
      setBuiltTx(tx);
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
        try {
          const currentHeight = await getBlockchainHeight(
            openApiKeyForRequests,
            wallet.chain,
          );
          const lockHeight = lockInscriptionUtxo?.height;
          if (typeof lockHeight === "number" && lockHeight > 0) {
            const confirmations = Math.max(0, currentHeight - lockHeight + 1);
            const remaining = Math.max(0, record.lockBlocks - confirmations);
            msg =
              remaining > 0
                ? `Time lock not yet mature: ${confirmations}/${record.lockBlocks} confirmations. Wait ${remaining} more block${remaining === 1 ? "" : "s"} before unlocking.`
                : `The node still considers the time lock immature. Wait for the next block and try again (${confirmations}/${record.lockBlocks} confirmations).`;
          } else {
            msg = `Time lock not yet mature (non-BIP68-final). Wait for ${record.lockBlocks} confirmations before trying again.`;
          }
        } catch {
          msg = `Time lock not yet mature (non-BIP68-final). Wait for ${record.lockBlocks} confirmations before trying again.`;
        }
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
          pubKey={wallet.pubKey}
          chain={wallet.chain}
          walletBalance={walletBalance}
          totalWalletSatoshi={walletUtxos.totalSatoshi}
          walletUtxoCount={walletUtxos.utxos.length}
          openApiKey={openApiKey}
          onOpenApiKeyChange={handleOpenApiKeyChange}
          onSwitchChain={handleSwitchChain}
        />
        <OperationPanel
          ticker={ticker}
          amount={amount}
          assetKind={assetKind}
          runeReference={runeReference}
          fractalNetwork={isFractalChain(String(wallet.chain))}
          lockBlocks={lockBlocks}
          feeRate={feeRate}
          timeLockAddress={timeLockAddress}
          walletBalance={walletBalance}
          walletUtxos={walletUtxos}
          hasOpenApiKey={hasOpenApiKey}
          canFetchUtxos={canFetchUtxos}
          canCreate={canCreate}
          builtTx={builtTx}
          result={result}
          records={records}
          onTickerChange={(value) => {
            setTicker(value);
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
            setFeeRate(value);
            resetBuiltState();
          }}
          onFetchUtxos={fetchWalletUtxos}
          onCreate={handleCreate}
          onUnlock={handleUnlock}
          onCopy={handleCopy}
        />
      </section>
    </main>
  );
}

export default App;
