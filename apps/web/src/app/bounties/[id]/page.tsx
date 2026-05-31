"use client";

import { use } from "react";
import Link from "next/link";
import { useBounty } from "@/lib/queries/useBounty";
import { useBountyEvents } from "@/lib/queries/useBountyEvents";
import { useChainHead } from "@/lib/queries/useChainHead";
import { BountyHeader } from "@/components/bounty/BountyHeader";
import { BountyAcceptanceCriteria } from "@/components/bounty/BountyAcceptanceCriteria";
import { BountyEventTimeline } from "@/components/bounty/BountyEventTimeline";
import { EnvelopeViewer } from "@/components/bounty/EnvelopeViewer";
import { BountyActionButtons } from "@/components/bounty/BountyActionButtons";
import { PingAgentsButton } from "@/components/bounty/PingAgentsButton";

const ENVELOPE_STATES = new Set(["Submitted", "Accepted", "Withdrawn"]);

export default function BountyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);

  let id: bigint | null = null;
  try {
    id = BigInt(idStr);
  } catch {
    id = null;
  }

  const { bounty, isLoading: bountyLoading, error: bountyError } = useBounty(id);
  const { events, isLoading: eventsLoading, error: eventsError } = useBountyEvents(id);
  const head = useChainHead();

  if (id === null) return <NotFound idStr={idStr} reason="invalid" />;

  const isLoading = bountyLoading || eventsLoading;
  const error = bountyError ?? eventsError;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : !bounty ? (
        <NotFound idStr={idStr} reason="not-found" />
      ) : (
        <>
          <BountyHeader bounty={bounty} />
          <BountyActionButtons
            bounty={bounty}
            currentBlock={head?.head ?? null}
          />
          <PingAgentsButton bounty={bounty} />
          <BountyAcceptanceCriteria bounty={bounty} />
          <BountyEventTimeline events={events} />
          {ENVELOPE_STATES.has(bounty.status) && (
            <EnvelopeViewer bountyId={bounty.id} resultHash={bounty.resultHash} />
          )}
        </>
      )}
    </main>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-32 animate-pulse rounded-sm bg-ash-white" />
      <div className="h-10 w-2/3 animate-pulse rounded-sm bg-ash-white" />
      <div className="h-32 animate-pulse rounded-card bg-ash-white" />
    </div>
  );
}

function NotFound({ idStr, reason }: { idStr: string; reason: "invalid" | "not-found" }) {
  return (
    <div className="space-y-4 py-12 text-center">
      <h1 className="font-display text-heading tracking-heading text-abyssal-ink">
        {reason === "invalid" ? "Invalid bounty ID" : `Bounty #${idStr} doesn't exist`}
      </h1>
      <p className="text-sm text-abyssal-ink/60">
        {reason === "invalid"
          ? `"${idStr}" is not a valid bounty ID.`
          : "This bounty isn't on this indexer."}
      </p>
      <Link
        href="/bounties"
        className="inline-block text-sm font-medium text-digital-orange transition-colors hover:text-abyssal-ink"
      >
        ← Back to bounties
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="font-display text-heading tracking-heading text-digital-orange">
        Couldn&apos;t reach indexer
      </h1>
      <p className="font-mono text-xs text-abyssal-ink/60">{message}</p>
    </div>
  );
}
