"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

export type WalletAccount = { address: string; name?: string };

export type WalletState = {
  status: WalletStatus;
  account: WalletAccount | null;
  signer: unknown | null;
  chainSS58: number | null;
  extensionName: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  error: string | null;
};

const LS_KEY = "bountymesh:last-account";

// chainSS58 is a property of the chain, not the wallet. Derive it once at
// provider construction from env so AddressChip renders SS58 across all
// pages from page load — even before any wallet connects.
function deriveChainSS58(): number {
  const override = process.env.NEXT_PUBLIC_CHAIN_SS58_PREFIX;
  if (override) {
    const n = Number.parseInt(override, 10);
    if (Number.isFinite(n)) return n;
  }
  const ws = process.env.NEXT_PUBLIC_VARA_WS ?? "";
  if (ws.includes("localhost") || ws.includes("127.0.0.1")) return 42;
  return 137;
}

export const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [signer, setSigner] = useState<unknown | null>(null);
  const [extensionName, setExtensionName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainSS58] = useState<number | null>(() => deriveChainSS58());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const remembered = window.localStorage.getItem(LS_KEY);
    if (!remembered) return;
    let cancelled = false;
    void (async () => {
      try {
        const { web3Enable, web3Accounts, web3FromAddress } = await import(
          "@polkadot/extension-dapp"
        );
        const exts = await web3Enable("BountyMesh");
        if (cancelled || exts.length === 0) return;
        const accounts = await web3Accounts();
        const match = accounts.find((a) => a.address === remembered);
        if (cancelled || !match) return;
        const injector = await web3FromAddress(match.address);
        if (cancelled) return;
        setExtensionName(exts[0].name);
        setAccount({ address: match.address, name: match.meta.name });
        setSigner(injector.signer);
        setStatus("connected");
      } catch {
        // silent — user can click connect manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");

    // web3Enable can hang indefinitely when the extension's authorization
    // popup is dismissed/hidden or the extension is unresponsive. Without a
    // timeout the button stays "Connecting…" forever. Race every async step
    // against a deadline so we always resolve to a connected or error state.
    const TIMEOUT_MS = 20_000;
    const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`${label} timed out — is your wallet extension unlocked? Look for an approval popup.`)),
            TIMEOUT_MS,
          ),
        ),
      ]);

    try {
      const { web3Enable, web3Accounts, web3FromAddress } = await import(
        "@polkadot/extension-dapp"
      );
      const exts = await withTimeout(web3Enable("BountyMesh"), "Wallet authorization");
      if (exts.length === 0) {
        setStatus("error");
        setError("No Polkadot-compatible extension found. Install polkadot{.js}, Talisman, or SubWallet, then reload.");
        return;
      }
      const accounts = await withTimeout(web3Accounts(), "Reading accounts");
      if (accounts.length === 0) {
        setStatus("error");
        setError("Extension reports zero accounts. Unlock it and authorize this site in the extension popup.");
        return;
      }
      const selected = accounts[0];
      const injector = await withTimeout(
        web3FromAddress(selected.address),
        "Loading signer",
      );
      setExtensionName(exts[0].name);
      setAccount({ address: selected.address, name: selected.meta.name });
      setSigner(injector.signer);
      setStatus("connected");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY, selected.address);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const disconnect = useCallback(() => {
    setStatus("disconnected");
    setAccount(null);
    setSigner(null);
    setExtensionName(null);
    setError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LS_KEY);
    }
  }, []);

  const value: WalletState = {
    status,
    account,
    signer,
    chainSS58,
    extensionName,
    connect,
    disconnect,
    error,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
