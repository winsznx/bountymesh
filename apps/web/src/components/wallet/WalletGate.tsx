"use client";

import { Wallet } from "lucide-react";
import { useWallet } from "@/lib/wallet/useWallet";
import { WalletConnectButton } from "./WalletConnectButton";

type Props = {
  heading: string;
  subline: string;
  children: React.ReactNode;
};

export function WalletGate({ heading, subline, children }: Props) {
  const { status, account, extensionName, error } = useWallet();

  if (status === "connected") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/50 px-4 py-2 text-xs text-slate-400">
          <span>
            Connected via <span className="text-slate-200">{extensionName}</span>
          </span>
          <span className="font-mono">
            {account?.name ? `${account.name} · ` : ""}
            {account?.address.slice(0, 6)}…{account?.address.slice(-6)}
          </span>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-md border border-slate-800 bg-slate-900/50 p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-400">
        <Wallet className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-slate-100">{heading}</h2>
      <p className="mt-2 text-sm text-slate-400">{subline}</p>
      <div className="mt-6 inline-flex">
        <WalletConnectButton />
      </div>
      {error && (
        <p className="mt-4 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
