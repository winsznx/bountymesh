"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { isAddressMatch } from "@/lib/format/address";
import { formatAtomicVara } from "@/lib/format/bigint";
import { useAcceptBounty } from "@/lib/mutations/useAcceptBounty";
import { showAcceptToast } from "@/lib/tx/toast";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";

type PanelState = "idle" | "confirming" | "submitting" | "error";

/**
 * Async visibility check — returns true iff the connected wallet is the
 * bounty's poster. Lifted to module scope so the useQuery queryFn can
 * reference it without a re-render-creating closure.
 */
async function shouldRenderAcceptButton(
  bounty: Bounty,
  connectedAddress: string | null,
  chainSS58: number | null,
): Promise<boolean> {
  if (bounty.status !== "Submitted") return false;
  if (!connectedAddress) return false;
  return isAddressMatch(bounty.poster, connectedAddress, chainSS58);
}

export function AcceptSubmissionButton({ bounty }: { bounty: Bounty }) {
  const { status, account, chainSS58 } = useWallet();
  const accept = useAcceptBounty();
  const [panel, setPanel] = useState<PanelState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lock A: binary visibility. Hidden entirely unless poster+connected+Submitted.
  // The async check caches via useQuery (P3.1 pattern) so the button doesn't
  // flicker on re-renders.
  const { data: shouldRender } = useQuery({
    queryKey: [
      "poster-check",
      bounty.id.toString(),
      account?.address ?? null,
      chainSS58,
    ],
    queryFn: () =>
      shouldRenderAcceptButton(bounty, account?.address ?? null, chainSS58),
    enabled: status === "connected",
    staleTime: Infinity,
  });

  if (!shouldRender) return null;

  const onAccept = async () => {
    setPanel("submitting");
    setErrorMsg(null);
    const promise = accept
      .mutateAsync(bounty.id)
      .then((res) => ({ bountyId: res.bountyId, txHash: res.txHash }));
    showAcceptToast(promise);
    try {
      await promise;
      // panel unmounts naturally: shouldRender becomes false once status flips
      // to Accepted via the invalidated bounty query
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPanel("error");
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-emerald-400">
        Poster action
      </div>

      {panel === "idle" && (
        <button
          type="button"
          onClick={() => setPanel("confirming")}
          className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-300"
        >
          Accept submission
        </button>
      )}

      {(panel === "confirming" || panel === "submitting" || panel === "error") && (
        <div className="space-y-3 rounded-md border border-slate-700 bg-slate-900/70 p-4">
          <h3 className="text-sm font-medium text-slate-100">Confirm acceptance</h3>
          <p className="text-sm text-slate-400">
            This will accept the worker&apos;s submission and unlock their withdrawal
            of <span className="font-mono text-slate-200">{formatAtomicVara(bounty.reward)}</span>.
            The bounty cycle closes after they withdraw. This action cannot be reversed.
          </p>
          {panel === "error" && errorMsg && (
            <p className="font-mono text-xs text-red-400">{errorMsg}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void onAccept()}
              disabled={panel === "submitting"}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {panel === "submitting" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              {panel === "error" ? "Retry" : "Yes, accept"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPanel("idle");
                setErrorMsg(null);
              }}
              disabled={panel === "submitting"}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
