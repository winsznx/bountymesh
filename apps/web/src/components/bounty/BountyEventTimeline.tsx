"use client";

import { Check, Circle } from "lucide-react";
import { TxHashChip } from "@/components/primitives/TxHashChip";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { BountyEvent, BountyEventName } from "@/lib/graphql/types";

// Phase 7 polish: handle Cancelled/TimedOut/Revoked/Rejected terminal states.
// Currently 5 stages only — the happy path.
const STAGES: BountyEventName[] = [
  "BountyPosted",
  "BountyClaimed",
  "BountySubmitted",
  "BountyAccepted",
  "BountyWithdrawn",
];

const STAGE_LABELS: Record<BountyEventName, string> = {
  BountyPosted: "Posted",
  BountyClaimed: "Claimed",
  BountySubmitted: "Submitted",
  BountyAccepted: "Accepted",
  BountyWithdrawn: "Withdrawn",
};

function actorFromPayload(name: BountyEventName, p: Record<string, unknown>): string | null {
  if (name === "BountyPosted") return typeof p.poster === "string" ? p.poster : null;
  if (name === "BountyAccepted") return typeof p.poster === "string" ? p.poster : null;
  return typeof p.worker === "string" ? p.worker : null;
}

function actorLabel(name: BountyEventName): string {
  if (name === "BountyPosted" || name === "BountyAccepted") return "by poster";
  return "by worker";
}

export function BountyEventTimeline({ events }: { events: BountyEvent[] }) {
  const { chainSS58 } = useWallet();
  const eventsByStage = new Map<BountyEventName, BountyEvent>();
  for (const ev of events) {
    if (!eventsByStage.has(ev.eventName)) {
      eventsByStage.set(ev.eventName, ev);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
        Lifecycle
      </h2>
      <ol className="space-y-0">
        {STAGES.map((stage, idx) => {
          const ev = eventsByStage.get(stage);
          const completed = !!ev;
          const isLast = idx === STAGES.length - 1;
          return (
            <li key={stage} className="flex gap-4">
              <div className="flex shrink-0 flex-col items-center">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                    completed
                      ? "border-cyan-400 bg-cyan-400/10 text-cyan-400"
                      : "border-slate-700 bg-slate-900 text-slate-600"
                  }`}
                >
                  {completed ? <Check className="h-3 w-3" aria-hidden /> : <Circle className="h-2 w-2" aria-hidden />}
                </div>
                {!isLast && (
                  <div
                    className={`my-1 w-px flex-1 ${
                      completed ? "bg-cyan-400/30" : "bg-slate-800"
                    }`}
                  />
                )}
              </div>
              <div className={`flex-1 pb-6 ${completed ? "" : "opacity-50"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`text-sm font-medium ${
                      completed ? "text-slate-100" : "text-slate-500"
                    }`}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                  {ev && (
                    <span className="font-mono text-xs text-slate-500">
                      block #{ev.blockNumber.toLocaleString()}
                    </span>
                  )}
                </div>
                {ev && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {ev.txHash && <TxHashChip hash={ev.txHash} label="tx" />}
                    {(() => {
                      const actor = actorFromPayload(ev.eventName, ev.payload);
                      if (!actor) return null;
                      return (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          {actorLabel(ev.eventName)}
                          <AddressChip address={actor} chainSS58={chainSS58} />
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
