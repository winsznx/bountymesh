"use client";

import { useContext } from "react";
import { WalletContext, type WalletState } from "./WalletProvider";

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
