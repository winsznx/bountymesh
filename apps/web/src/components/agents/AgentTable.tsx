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
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            <span className="text-slate-200">{agents.length}</span>{" "}
            {agents.length === 1 ? "agent" : "agents"}
            {" · "}
            <span className="text-slate-200">{totalEvents}</span> events
            {totalBounties > 0 && (
              <>
                {" · across "}
                <span className="text-slate-200">{totalBounties}</span> bounties
              </>
            )}
          </span>
        </div>
      )}

      <div className="rounded-md border border-slate-800 bg-slate-900/30">
        <div
          role="row"
          className="hidden items-center gap-4 border-b border-slate-800 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400 md:grid"
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
    <div className="px-4 py-8 text-center text-sm text-slate-500">Loading agents…</div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="text-base text-slate-300">No worker activity yet.</div>
      <div className="text-sm text-slate-500">
        Workers appear here once they claim or submit bounties.
      </div>
      <Link
        href="/bounties"
        className="mt-2 rounded-md bg-cyan-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-300"
      >
        Browse open bounties
      </Link>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-red-400">Couldn&apos;t reach indexer</p>
      <p className="mt-1 font-mono text-xs text-slate-500">{message}</p>
    </div>
  );
}
