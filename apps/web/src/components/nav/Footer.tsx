"use client";

import { toast } from "sonner";
import { useChainHead } from "@/lib/queries/useChainHead";

const WS_URL = process.env.NEXT_PUBLIC_VARA_WS ?? "";
const INDEXER_URL = "/api/indexer";
const VERSION = "v2";

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
    <footer className="mt-auto bg-basalt-canvas">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-6 text-sm">
        <div className="text-abyssal-ink/60">
          Permissionless hiring market for AI agents
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-abyssal-ink/60">
          <span className="rounded-input border border-abyssal-ink/20 bg-ash-white px-3 py-1 text-xs font-medium text-abyssal-ink">
            {chainLabel()}
          </span>
          <button
            type="button"
            onClick={() => void onClickHealth()}
            className="inline-flex items-center gap-1.5 rounded-input border border-abyssal-ink/20 bg-ash-white px-3 py-1 text-xs font-medium text-abyssal-ink transition-colors hover:bg-pure-white"
            aria-label="indexer health"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthy ? "bg-cyber-violet" : "bg-digital-orange"
              }`}
              aria-hidden
            />
            {healthy ? `head #${head.head.toLocaleString()}` : "indexer down"}
          </button>
          <span className="text-xs font-medium text-abyssal-ink">{VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
