"use client";

import { Check, Circle, X, AlertTriangle, Clock, Ban } from "lucide-react";
import { TxHashChip } from "@/components/primitives/TxHashChip";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { BountyEvent, BountyEventName } from "@/lib/graphql/types";

type LucideIcon = typeof Check;

/**
 * Lifecycle timeline. Renders the 5-stage happy path AND surfaces any v2
 * terminal-state event (Cancel/Reject/Timeout/Revoke) as a distinct closing
 * stage when it occurs. Order of precedence: happy path completion → if no
 * Withdrawn yet, show whichever terminal event landed.
 */
const HAPPY_STAGES: BountyEventName[] = [
  "BountyPosted",
  "BountyClaimed",
  "BountySubmitted",
  "BountyAccepted",
  "BountyWithdrawn",
];

const TERMINAL_STAGES: BountyEventName[] = [
  "BountyCancelled",
  "BountyRejected",
  "BountyTimedOut",
  "BountyRevoked",
];

const STAGE_LABELS: Record<BountyEventName, string> = {
  BountyPosted: "Posted",
  BountyClaimed: "Claimed",
  BountySubmitted: "Submitted",
  BountyAccepted: "Accepted",
  BountyWithdrawn: "Withdrawn",
  BountyCancelled: "Cancelled",
  BountyRejected: "Rejected",
  BountyTimedOut: "Timed out",
  BountyRevoked: "Revoked",
};

const TERMINAL_ICONS: Record<string, LucideIcon> = {
  BountyCancelled: X,
  BountyRejected: AlertTriangle,
  BountyTimedOut: Clock,
  BountyRevoked: Ban,
};

const TERMINAL_BG: Record<string, string> = {
  BountyCancelled: "border-abyssal-ink/30 bg-basalt-canvas text-abyssal-ink",
  BountyRejected: "border-digital-orange bg-pure-white text-digital-orange",
  BountyTimedOut: "border-abyssal-ink/30 bg-pure-white text-abyssal-ink/60",
  BountyRevoked: "border-abyssal-ink bg-abyssal-ink text-pixel-glare",
};

function actorFromPayload(
  name: BountyEventName,
  p: Record<string, unknown>,
): string | null {
  if (name === "BountyPosted" || name === "BountyAccepted") {
    return typeof p.poster === "string" ? p.poster : null;
  }
  if (name === "BountyCancelled" || name === "BountyRevoked") {
    return typeof p.by === "string" ? p.by : null;
  }
  if (name === "BountyRejected") {
    return typeof p.by === "string" ? p.by : null;
  }
  if (name === "BountyTimedOut") {
    return typeof p.called_by === "string" ? p.called_by : null;
  }
  return typeof p.worker === "string" ? p.worker : null;
}

function actorLabel(name: BountyEventName): string {
  if (name === "BountyPosted" || name === "BountyAccepted") return "by poster";
  if (name === "BountyCancelled") return "by poster";
  if (name === "BountyRejected") return "by poster";
  if (name === "BountyTimedOut") return "by watchdog";
  if (name === "BountyRevoked") return "by owner";
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

  // Find the first terminal-state event that landed (if any). The contract
  // guarantees only one terminal flip per bounty, so first-match is canonical.
  const terminalEvent = TERMINAL_STAGES.map((s) => eventsByStage.get(s)).find(
    (e): e is BountyEvent => e !== undefined,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
        Lifecycle
      </h2>
      <ol className="space-y-0">
        {HAPPY_STAGES.map((stage, idx) => {
          const ev = eventsByStage.get(stage);
          const completed = !!ev;
          const isLast = idx === HAPPY_STAGES.length - 1 && !terminalEvent;
          return (
            <li key={stage} className="flex gap-4">
              <div className="flex shrink-0 flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                    completed
                      ? "border-digital-orange bg-digital-orange text-pure-white"
                      : "border-abyssal-ink/20 bg-pure-white text-abyssal-ink/40"
                  }`}
                >
                  {completed ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Circle className="h-2 w-2" aria-hidden />
                  )}
                </div>
                {!isLast && (
                  <div
                    className={`my-1 w-0.5 flex-1 ${
                      completed ? "bg-digital-orange/40" : "bg-abyssal-ink/10"
                    }`}
                  />
                )}
              </div>
              <div className={`flex-1 pb-6 ${completed ? "" : "opacity-50"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`font-display text-xl tracking-heading-sm ${
                      completed ? "text-abyssal-ink" : "text-abyssal-ink/40"
                    }`}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                  {ev && (
                    <span className="font-mono text-xs text-abyssal-ink/60">
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
                        <span className="inline-flex items-center gap-1 text-abyssal-ink/60">
                          {actorLabel(ev.eventName)}
                          <AddressChip
                            address={actor}
                            chainSS58={chainSS58}
                          />
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {terminalEvent && (
          <li key={terminalEvent.eventName} className="flex gap-4">
            <div className="flex shrink-0 flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                  TERMINAL_BG[terminalEvent.eventName] ?? ""
                }`}
              >
                {(() => {
                  const Icon =
                    TERMINAL_ICONS[terminalEvent.eventName] ?? X;
                  return <Icon className="h-3.5 w-3.5" aria-hidden />;
                })()}
              </div>
            </div>
            <div className="flex-1 pb-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-xl tracking-heading-sm text-abyssal-ink">
                  {STAGE_LABELS[terminalEvent.eventName]}
                </span>
                <span className="font-mono text-xs text-abyssal-ink/60">
                  block #{terminalEvent.blockNumber.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {terminalEvent.txHash && (
                  <TxHashChip hash={terminalEvent.txHash} label="tx" />
                )}
                {(() => {
                  const actor = actorFromPayload(
                    terminalEvent.eventName,
                    terminalEvent.payload,
                  );
                  if (!actor) return null;
                  return (
                    <span className="inline-flex items-center gap-1 text-abyssal-ink/60">
                      {actorLabel(terminalEvent.eventName)}
                      <AddressChip address={actor} chainSS58={chainSS58} />
                    </span>
                  );
                })()}
                {terminalEvent.eventName === "BountyRejected" &&
                  typeof terminalEvent.payload.reason === "string" && (
                    <span className="inline-flex items-start text-abyssal-ink/70">
                      reason: &ldquo;{terminalEvent.payload.reason}&rdquo;
                    </span>
                  )}
                {terminalEvent.eventName === "BountyTimedOut" &&
                  typeof terminalEvent.payload.last_state === "number" && (
                    <span className="inline-flex items-start text-abyssal-ink/70">
                      last state: discriminant {terminalEvent.payload.last_state}
                    </span>
                  )}
              </div>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
