"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/lib/wallet/useWallet";

export function WalletConnectButton() {
  const { status, account, extensionName, connect, disconnect, error } = useWallet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status !== "connected" || !account) {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        disabled={status === "connecting"}
        title={error ?? undefined}
        className="inline-flex items-center gap-2 rounded-md border border-cyan-400/40 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Wallet className="h-3 w-3" aria-hidden />
        {status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const truncated = `${account.address.slice(0, 6)}…${account.address.slice(-6)}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Wallet menu for ${truncated}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-200 hover:border-slate-600"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
        {truncated}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Wallet actions"
          className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg"
        >
          <div className="border-b border-slate-800 px-3 py-2 text-xs text-slate-500">
            <div>{extensionName ?? "extension"}</div>
            {account.name && <div className="mt-0.5 text-slate-300">{account.name}</div>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
          >
            <LogOut className="h-3 w-3" aria-hidden />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
