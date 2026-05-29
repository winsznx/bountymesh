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
        className="inline-flex items-center gap-2 rounded-pill border-2 border-abyssal-ink bg-transparent px-5 py-2 text-sm font-medium text-abyssal-ink transition-colors hover:bg-abyssal-ink hover:text-pure-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Wallet className="h-4 w-4" aria-hidden />
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
        className="inline-flex items-center gap-2 rounded-pill bg-digital-orange px-5 py-2 font-mono text-sm font-medium text-pure-white transition-opacity hover:opacity-90"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-pure-white" aria-hidden />
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
          className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-card border border-abyssal-ink/10 bg-ash-white shadow-lg"
        >
          <div className="border-b border-abyssal-ink/10 px-4 py-3 text-xs text-abyssal-ink/60">
            <div>{extensionName ?? "extension"}</div>
            {account.name && (
              <div className="mt-0.5 font-medium text-abyssal-ink">
                {account.name}
              </div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-abyssal-ink transition-colors hover:bg-basalt-canvas"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
