"use client";

import { use } from "react";
import Link from "next/link";
import { useBounty } from "@/lib/queries/useBounty";
import { useBountyEvents } from "@/lib/queries/useBountyEvents";
import { BountyHeader } from "@/components/bounty/BountyHeader";
import { BountyAcceptanceCriteria } from "@/components/bounty/BountyAcceptanceCriteria";
import { BountyEventTimeline } from "@/components/bounty/BountyEventTimeline";
import { EnvelopeViewer } from "@/components/bounty/EnvelopeViewer";
import { AcceptSubmissionButton } from "@/components/bounty/AcceptSubmissionButton";

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

  if (id === null) return <NotFound idStr={idStr} reason="invalid" />;

  const isLoading = bountyLoading || eventsLoading;
  const error = bountyError ?? eventsError;

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-8">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : !bounty ? (
        <NotFound idStr={idStr} reason="not-found" />
      ) : (
        <>
          <BountyHeader bounty={bounty} />
          <AcceptSubmissionButton bounty={bounty} />
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
      <div className="h-6 w-32 animate-pulse rounded-sm bg-slate-800" />
      <div className="h-10 w-2/3 animate-pulse rounded-sm bg-slate-800" />
      <div className="h-32 animate-pulse rounded-md bg-slate-800/40" />
    </div>
  );
}

function NotFound({ idStr, reason }: { idStr: string; reason: "invalid" | "not-found" }) {
  return (
    <div className="space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold text-slate-200">
        {reason === "invalid" ? "Invalid bounty ID" : `Bounty #${idStr} doesn't exist`}
      </h1>
      <p className="text-sm text-slate-500">
        {reason === "invalid"
          ? `"${idStr}" is not a valid bounty ID.`
          : "This bounty isn't on this indexer."}
      </p>
      <Link href="/bounties" className="inline-block text-sm text-cyan-400 hover:text-cyan-300">
        ← Back to bounties
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="space-y-3 py-12 text-center">
      <h1 className="text-xl font-semibold text-red-400">Couldn&apos;t reach indexer</h1>
      <p className="font-mono text-xs text-slate-500">{message}</p>
    </div>
  );
}
