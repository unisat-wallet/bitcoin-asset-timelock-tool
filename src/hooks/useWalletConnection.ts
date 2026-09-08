import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_WALLET_CHECK_ATTEMPTS,
  WALLET_CHECK_INTERVAL,
} from "../constants";
import type { ChainType } from "../types";
import { getErrorMessage } from "../lib/errors";

export function useWalletConnection(onError: (message: string) => void) {
  const [walletDetected, setWalletDetected] = useState(false);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [chain, setChain] = useState<ChainType | string>("");
  const accountsRef = useRef<string[]>([]);

  const refreshWalletInfo = useCallback(async () => {
    if (!window.unisat) return;
    const accounts = await window.unisat.getAccounts();
    accountsRef.current = accounts;
    setConnected(accounts.length > 0);
    setAddress(accounts[0] || "");
    if (accounts.length > 0) {
      const nextPubKey = await window.unisat.getPublicKey();
      setPubKey(nextPubKey.trim());
    } else {
      setPubKey("");
    }
    if (window.unisat.getChain) {
      try {
        const nextChain = await window.unisat.getChain();
        setChain(nextChain.enum);
      } catch {
        setChain("");
      }
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    async function initWallet() {
      for (let attempt = 0; attempt < MAX_WALLET_CHECK_ATTEMPTS; attempt += 1) {
        if (window.unisat) break;
        await new Promise((resolve) =>
          window.setTimeout(resolve, WALLET_CHECK_INTERVAL * (attempt + 1)),
        );
      }
      if (!window.unisat || cancelled) return;

      setWalletDetected(true);
      await refreshWalletInfo().catch(() => undefined);

      const onAccountsChanged = async (accounts: unknown) => {
        const nextAccounts = Array.isArray(accounts)
          ? accounts.filter((item): item is string => typeof item === "string")
          : [];
        if (accountsRef.current[0] === nextAccounts[0]) return;
        accountsRef.current = nextAccounts;
        await refreshWalletInfo().catch((error) =>
          onError(getErrorMessage(error)),
        );
      };
      const onChainChanged = async () => {
        await refreshWalletInfo().catch(() => undefined);
      };

      window.unisat.on?.("accountsChanged", onAccountsChanged);
      window.unisat.on?.("chainChanged", onChainChanged);
      cleanup = () => {
        window.unisat?.removeListener?.("accountsChanged", onAccountsChanged);
        window.unisat?.removeListener?.("chainChanged", onChainChanged);
      };
    }

    void initWallet();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [onError, refreshWalletInfo]);

  const connect = async () => {
    if (!window.unisat) {
      throw new Error("UniSat wallet was not detected.");
    }
    await window.unisat.requestAccounts();
    await refreshWalletInfo();
  };

  const disconnect = async () => {
    await window.unisat?.disconnect?.().catch(() => undefined);
    accountsRef.current = [];
    setConnected(false);
    setAddress("");
    setPubKey("");
  };

  const switchChain = async (nextChain: ChainType) => {
    if (!window.unisat?.switchChain) {
      throw new Error('This UniSat Wallet version does not support network switching.')
    }
    await window.unisat.switchChain(nextChain)
    await refreshWalletInfo()
  };

  return {
    walletDetected,
    connected,
    address,
    pubKey,
    chain,
    connect,
    disconnect,
    switchChain,
    refreshWalletInfo,
  };
}
