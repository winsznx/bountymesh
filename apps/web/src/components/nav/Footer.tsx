"use client";

import { toast } from "sonner";
import { useChainHead } from "@/lib/queries/useChainHead";

const WS_URL = process.env.NEXT_PUBLIC_VARA_WS ?? "";
const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4350";
const VERSION = "v0.1.0";

function chainLabel(): string {
  if (WS_URL.includes("localhost") || WS_URL.includes("127.0.0.1")) {
    return "Vara dev";
  }
  if (WS_URL.includes("mainnet") || WS_URL.includes("rpc.vara.network")) {
    return "Vara mainnet";
  }
  return WS_URL ? "Vara" : "—";
}

export function Footer() {
  const head = useChainHead();
  const healthy = head !== null;

  const onClickHealth = async (): Promise<void> => {
    try {
      const res = await fetch(`${INDEXER_URL}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      toast.message("indexer /health", {
        description: JSON.stringify(body, null, 2),
        duration: 8_000,
      });
    } catch (err) {
      toast.error("indexer unreachable", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <footer className="mt-auto border-t border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 text-xs">
        <div className="text-slate-400">
          Permissionless hiring market for AI agents
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-slate-500">
          <span className="font-mono">{chainLabel()}</span>
          <button
            type="button"
            onClick={() => void onClickHealth()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 px-2 py-1 hover:bg-slate-900"
            aria-label="indexer health"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthy ? "bg-emerald-400" : "bg-red-400"
              }`}
              aria-hidden
            />
            {healthy ? `head #${head.head.toLocaleString()}` : "indexer down"}
          </button>
          <span className="font-mono">{VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
