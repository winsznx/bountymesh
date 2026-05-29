"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useAgents, type Agent } from "@/lib/queries/useAgents";
import { AgentRow } from "./AgentRow";
import { AgentCard } from "./AgentCard";

export const GRID_TEMPLATE =
  "220px 100px 100px 110px 130px 110px";

type SortKey =
  | "address"
  | "claimCount"
  | "submitCount"
  | "distinctBounties"
  | "lastActiveBlock"
  | "deliveryRatePct";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "address", label: "Worker" },
  { key: "claimCount", label: "Claims" },
  { key: "submitCount", label: "Submits" },
  { key: "distinctBounties", label: "Bounties" },
  { key: "lastActiveBlock", label: "Last active" },
  { key: "deliveryRatePct", label: "Delivery" },
];

function compare(a: Agent, b: Agent, key: SortKey): number {
  if (key === "address") return a.address.localeCompare(b.address);
  if (key === "claimCount") return a.claimCount - b.claimCount;
  if (key === "submitCount") return a.submitCount - b.submitCount;
  if (key === "distinctBounties") return a.distinctBounties - b.distinctBounties;
  if (key === "lastActiveBlock") return a.lastActiveBlock - b.lastActiveBlock;
  return a.deliveryRatePct - b.deliveryRatePct;
}

export function AgentTable() {
  const { agents, totalEvents, totalBounties, isLoading, error } = useAgents();

  const [sortKey, setSortKey] = useState<SortKey>("submitCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...agents];
    arr.sort((a, b) => {
      const cmp = compare(a, b, sortKey);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [agents, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-3">
      {error ? null : (
        <div className="flex items-center justify-between text-xs text-abyssal-ink/60">
          <span>
            <span className="text-abyssal-ink">{sorted.length}</span>{" "}
            {sorted.length === 1 ? "agent" : "agents"}
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
          {COLUMNS.map((col) => {
            const isActive = sortKey === col.key;
            const Icon = isActive
              ? sortDir === "desc"
                ? ChevronDown
                : ChevronUp
              : ChevronsUpDown;
            const ariaSort: "ascending" | "descending" | "none" = isActive
              ? sortDir === "desc"
                ? "descending"
                : "ascending"
              : "none";
            return (
              <div key={col.key} role="columnheader" aria-sort={ariaSort}>
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  aria-label={`Sort by ${col.label}, ${
                    isActive ? `currently ${ariaSort}` : "not sorted"
                  }`}
                  className={`inline-flex items-center gap-1 text-left transition-colors hover:text-abyssal-ink ${
                    isActive ? "text-digital-orange" : "text-abyssal-ink/60"
                  }`}
                >
                  {col.label}
                  <Icon className="h-3 w-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>

        {error ? (
          <ErrorState message={error.message} />
        ) : isLoading && sorted.length === 0 ? (
          <LoadingState />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          sorted.map((a) => (
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
        className="mt-2 rounded-md bg-digital-orange px-4 py-2 text-sm font-medium text-pure-white transition-opacity hover:opacity-90"
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
