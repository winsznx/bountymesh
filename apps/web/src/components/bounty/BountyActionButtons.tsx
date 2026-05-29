"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isAddressMatch } from "@/lib/format/address";
import { formatAtomicVara } from "@/lib/format/bigint";
import { useAcceptBounty } from "@/lib/mutations/useAcceptBounty";
import { useTransitionBounty } from "@/lib/mutations/useTransitionBounty";
import { showAcceptToast } from "@/lib/tx/toast";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";

type PanelMode = "idle" | "accept" | "cancel" | "reject" | "timeout" | "revoke";

async function isCallerPoster(
  bounty: Bounty,
  connected: string | null,
  chainSS58: number | null,
): Promise<boolean> {
  if (!connected) return false;
  return isAddressMatch(bounty.poster, connected, chainSS58);
}

const OWNER_HEX =
  "0xa2d2b8caeeddf26edd3a08d6a2e8a0313f7d6c892c53a1b06015b328153a0b1f";

async function isCallerOwner(
  connected: string | null,
  chainSS58: number | null,
): Promise<boolean> {
  if (!connected) return false;
  return isAddressMatch(OWNER_HEX, connected, chainSS58);
}

const TERMINAL_STATUSES = new Set([
  "Accepted",
  "Withdrawn",
  "Rejected",
  "Cancelled",
  "TimedOut",
  "Revoked",
]);

/**
 * Unified action surface for a bounty. Replaces AcceptSubmissionButton.
 * Shows exactly the buttons the connected wallet can call right now:
 *
 *   • Poster, status==Open      → Cancel
 *   • Poster, status==Submitted → Accept | Reject (with reason)
 *   • Anyone, status pre-terminal AND deadline set AND current > deadline → Timeout
 *   • Owner, status not Revoked → Revoke (always shown for owner)
 *
 * Each action confirms in a panel before submitting, mirroring the Accept UX.
 */
export function BountyActionButtons({
  bounty,
  currentBlock,
}: {
  bounty: Bounty;
  currentBlock: number | null;
}) {
  const { status, account, chainSS58 } = useWallet();
  const accept = useAcceptBounty();
  const transition = useTransitionBounty();
  const [mode, setMode] = useState<PanelMode>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: isPoster } = useQuery({
    queryKey: ["is-poster", bounty.id.toString(), account?.address ?? null, chainSS58],
    queryFn: () => isCallerPoster(bounty, account?.address ?? null, chainSS58),
    enabled: status === "connected",
    staleTime: Infinity,
  });
  const { data: isOwner } = useQuery({
    queryKey: ["is-owner", account?.address ?? null, chainSS58],
    queryFn: () => isCallerOwner(account?.address ?? null, chainSS58),
    enabled: status === "connected",
    staleTime: Infinity,
  });

  const isTerminal = TERMINAL_STATUSES.has(bounty.status);
  const canTimeout =
    !isTerminal &&
    bounty.deadline !== null &&
    currentBlock !== null &&
    currentBlock > bounty.deadline;

  const canAccept = isPoster && bounty.status === "Submitted";
  const canReject = isPoster && bounty.status === "Submitted";
  const canCancel = isPoster && bounty.status === "Open";
  const isWithdrawn = bounty.status === "Withdrawn";
  const canRevoke = isOwner && bounty.status !== "Revoked" && !isWithdrawn;

  if (!canAccept && !canReject && !canCancel && !canTimeout && !canRevoke) {
    return null;
  }

  const dismissPanel = () => {
    setMode("idle");
    setErrorMsg(null);
    setRejectReason("");
  };

  const handleAccept = async () => {
    setErrorMsg(null);
    const promise = accept
      .mutateAsync(bounty.id)
      .then((res) => ({ bountyId: res.bountyId, txHash: res.txHash }));
    showAcceptToast(promise);
    try {
      await promise;
      dismissPanel();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTransition = async (
    fn: "cancel" | "reject" | "timeout" | "revoke",
  ) => {
    setErrorMsg(null);
    try {
      let res;
      if (fn === "reject") {
        res = await transition.mutateAsync({
          fn: "reject",
          bountyId: bounty.id,
          reason: rejectReason.trim() || null,
        });
      } else {
        res = await transition.mutateAsync({ fn, bountyId: bounty.id });
      }
      toast.success(
        `${fn.charAt(0).toUpperCase() + fn.slice(1)} submitted`,
        { description: res.txHash },
      );
      dismissPanel();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const submitting = accept.isPending || transition.isPending;

  return (
    <section className="space-y-4 rounded-card bg-ash-white p-6">
      <div className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
        Actions
      </div>

      {mode === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          {canAccept && (
            <ActionPill
              label="Accept submission"
              variant="primary"
              onClick={() => setMode("accept")}
            />
          )}
          {canReject && (
            <ActionPill
              label="Reject"
              variant="outline"
              onClick={() => setMode("reject")}
            />
          )}
          {canCancel && (
            <ActionPill
              label="Cancel bounty"
              variant="outline"
              onClick={() => setMode("cancel")}
            />
          )}
          {canTimeout && (
            <ActionPill
              label="Trigger timeout"
              variant="outline"
              onClick={() => setMode("timeout")}
            />
          )}
          {canRevoke && (
            <ActionPill
              label="Owner revoke"
              variant="danger"
              onClick={() => setMode("revoke")}
            />
          )}
        </div>
      )}

      {mode === "accept" && (
        <ConfirmPanel
          title="Confirm acceptance"
          body={
            <>
              This accepts the worker&apos;s submission and unlocks their
              withdrawal of{" "}
              <span className="font-mono text-abyssal-ink">
                {formatAtomicVara(bounty.reward)}
              </span>
              . Irreversible.
            </>
          }
          confirmLabel="Yes, accept"
          variant="primary"
          submitting={submitting}
          error={errorMsg}
          onConfirm={() => void handleAccept()}
          onBack={dismissPanel}
        />
      )}

      {mode === "cancel" && (
        <ConfirmPanel
          title="Cancel this Open bounty"
          body={
            <>
              Cancelling refunds the full escrow{" "}
              <span className="font-mono text-abyssal-ink">
                {formatAtomicVara(bounty.reward)}
              </span>{" "}
              to your wallet. The bounty becomes terminal-Cancelled and no
              worker can claim it.
            </>
          }
          confirmLabel="Yes, cancel"
          variant="primary"
          submitting={submitting}
          error={errorMsg}
          onConfirm={() => void handleTransition("cancel")}
          onBack={dismissPanel}
        />
      )}

      {mode === "reject" && (
        <ConfirmPanel
          title="Reject this submission"
          body={
            <>
              The worker&apos;s submission doesn&apos;t meet your acceptance
              criteria. The full{" "}
              <span className="font-mono text-abyssal-ink">
                {formatAtomicVara(bounty.reward)}
              </span>{" "}
              escrow refunds to your wallet. Optional reason (≤500 chars) is
              persisted on-chain for indexer visibility.
            </>
          }
          confirmLabel="Yes, reject"
          variant="outline"
          submitting={submitting}
          error={errorMsg}
          onConfirm={() => void handleTransition("reject")}
          onBack={dismissPanel}
        >
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            maxLength={500}
            placeholder="Optional reason for the rejection (≤500 chars)"
            rows={3}
            className="w-full rounded-card border border-abyssal-ink/20 bg-pure-white p-3 text-sm text-abyssal-ink placeholder:text-abyssal-ink/40 focus-visible:border-digital-orange focus-visible:outline-none"
          />
          <div className="text-right text-xs text-abyssal-ink/40">
            {rejectReason.length} / 500
          </div>
        </ConfirmPanel>
      )}

      {mode === "timeout" && (
        <ConfirmPanel
          title="Trigger permissionless timeout"
          body={
            <>
              The bounty&apos;s deadline (block{" "}
              <span className="font-mono">
                #{bounty.deadline?.toLocaleString() ?? "—"}
              </span>
              ) has passed. Triggering pushes the escrow to the poster&apos;s
              mailbox via on-chain message. Any wallet can call this.
            </>
          }
          confirmLabel="Yes, trigger"
          variant="primary"
          submitting={submitting}
          error={errorMsg}
          onConfirm={() => void handleTransition("timeout")}
          onBack={dismissPanel}
        />
      )}

      {mode === "revoke" && (
        <ConfirmPanel
          title="Owner emergency revoke"
          body={
            <>
              Revoking from owner authority flips the bounty to terminal-Revoked.
              {!isWithdrawn && (
                <>
                  {" "}
                  Non-withdrawn escrow{" "}
                  <span className="font-mono text-abyssal-ink">
                    {formatAtomicVara(bounty.reward)}
                  </span>{" "}
                  refunds to the original poster via mailbox.
                </>
              )}{" "}
              This action cannot be reversed.
            </>
          }
          confirmLabel="Yes, revoke"
          variant="danger"
          submitting={submitting}
          error={errorMsg}
          onConfirm={() => void handleTransition("revoke")}
          onBack={dismissPanel}
        />
      )}
    </section>
  );
}

function ActionPill({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant: "primary" | "outline" | "danger";
  onClick: () => void;
}) {
  const variantClasses: Record<typeof variant, string> = {
    primary: "bg-digital-orange text-pure-white hover:opacity-90",
    outline:
      "border-2 border-abyssal-ink bg-transparent text-abyssal-ink hover:bg-abyssal-ink hover:text-pure-white",
    danger:
      "bg-abyssal-ink text-pixel-glare hover:bg-abyssal-ink/90",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-pill px-5 py-2 text-sm font-medium transition-colors ${variantClasses[variant]}`}
    >
      {label}
    </button>
  );
}

function ConfirmPanel({
  title,
  body,
  confirmLabel,
  variant,
  submitting,
  error,
  onConfirm,
  onBack,
  children,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  variant: "primary" | "outline" | "danger";
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  const confirmVariant: Record<typeof variant, string> = {
    primary: "bg-digital-orange text-pure-white hover:opacity-90",
    outline:
      "border-2 border-abyssal-ink bg-transparent text-abyssal-ink hover:bg-abyssal-ink hover:text-pure-white",
    danger: "bg-abyssal-ink text-pixel-glare hover:bg-abyssal-ink/90",
  };
  return (
    <div className="space-y-3 rounded-card border border-abyssal-ink/10 bg-pure-white p-5">
      <h3 className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
        {title}
      </h3>
      <p className="text-sm text-abyssal-ink/70">{body}</p>
      {children}
      {error && (
        <p className="rounded-card border border-digital-orange/30 bg-digital-orange/5 p-3 font-mono text-xs text-digital-orange">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className={`inline-flex items-center gap-2 rounded-pill px-5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${confirmVariant[variant]}`}
        >
          {submitting && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          )}
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="rounded-pill border border-abyssal-ink/20 bg-transparent px-5 py-2 text-sm font-medium text-abyssal-ink/70 transition-colors hover:border-abyssal-ink hover:text-abyssal-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          Back
        </button>
      </div>
    </div>
  );
}
