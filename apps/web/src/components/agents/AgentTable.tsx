"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useAgents } from "@/lib/queries/useAgents";
import { AgentRow } from "./AgentRow";
import { AgentCard } from "./AgentCard";

export const GRID_TEMPLATE =
  "220px 100px 100px 110px 130px 110px";

export function AgentTable() {
  const { agents, totalEvents, totalBounties, isLoading, error } = useAgents();

  return (
    <div className="space-y-3">
      {error ? null : (
        <div className="flex items-center justify-between text-xs text-abyssal-ink/60">
          <span>
            <span className="text-abyssal-ink">{agents.length}</span>{" "}
            {agents.length === 1 ? "agent" : "agents"}
            {" · "}
            <span className="text-abyssal-ink">{totalEvents}</span> events
            {totalBounties > 0 && (
              <>
                {" · across "}
                <span className="text-abyssal-ink">{totalBounties}</span> bounties
              </>
            )}
          </span>
        </div>
      )}

      <div className="rounded-md border border-ash-white bg-ash-white">
        <div
          role="row"
          className="hidden items-center gap-4 border-b border-ash-white px-4 py-3 text-xs font-medium uppercase tracking-wider text-abyssal-ink/60 md:grid"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          <div>Worker</div>
          <div>Claims</div>
          <div>Submits</div>
          <div>Bounties</div>
          <div>Last active</div>
          <div>Delivery</div>
        </div>

        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading && agents.length === 0 ? (
          <LoadingState />
        ) : agents.length === 0 ? (
          <EmptyState />
        ) : (
          agents.map((a) => (
            <Fragment key={a.address}>
              <AgentRow agent={a} />
              <AgentCard agent={a} />
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="px-4 py-8 text-center text-sm text-abyssal-ink/40">Loading agents…</div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="text-base text-abyssal-ink/80">No worker activity yet.</div>
      <div className="text-sm text-abyssal-ink/40">
        Workers appear here once they claim or submit bounties.
      </div>
      <Link
        href="/bounties"
        className="mt-2 rounded-md bg-digital-orange px-4 py-2 text-sm font-medium text-basalt-canvas hover:bg-digital-orange"
      >
        Browse open bounties
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-digital-orange">Couldn&apos;t reach indexer</p>
      <p className="mt-1 font-mono text-xs text-abyssal-ink/40">{message}</p>
    </div>
  );
}
