"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useBounties } from "@/lib/queries/useBounties";
import type { BountyOrderBy } from "@/lib/graphql/types";
import { BountyRow } from "./BountyRow";
import { BountyCard } from "./BountyCard";

export const GRID_TEMPLATE =
  "70px minmax(0, 1fr) 130px 110px 200px 210px 110px";

const PAGE_SIZE = 25;

type SortKey = "id" | "reward" | "postedAt";

function sortKeyToOrderBy(key: SortKey, dir: "asc" | "desc"): BountyOrderBy {
  if (key === "id") return dir === "desc" ? "ID_DESC" : "ID_ASC";
  if (key === "reward") return dir === "desc" ? "REWARD_DESC" : "REWARD_ASC";
  return dir === "desc" ? "POSTED_AT_DESC" : "POSTED_AT_ASC";
}

export function BountyTable() {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("postedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { bounties, totalCount, isLoading, error, refetch } = useBounties({
    first: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    orderBy: sortKeyToOrderBy(sortKey, sortDir),
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="space-y-4">
      <div
        role="row"
        className="hidden items-center gap-4 px-6 py-3 text-xs font-medium uppercase tracking-wider text-abyssal-ink/60 md:grid"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        <SortHeader label="ID" sortKey="id" active={sortKey} dir={sortDir} onClick={toggleSort} />
        <div>Title</div>
        <div>Status</div>
        <div>Track</div>
        <SortHeader label="Reward" sortKey="reward" active={sortKey} dir={sortDir} onClick={toggleSort} />
        <div>Poster</div>
        <SortHeader label="Posted" sortKey="postedAt" active={sortKey} dir={sortDir} onClick={toggleSort} />
      </div>

      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <SkeletonRows count={6} />
      ) : bounties.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {bounties.map((b) => (
            <Fragment key={b.id.toString()}>
              <BountyRow bounty={b} />
              <BountyCard bounty={b} />
            </Fragment>
          ))}
        </div>
      )}

      {!error && !isLoading && bounties.length > 0 && (
        <div className="flex items-center justify-between rounded-card bg-ash-white px-6 py-4 text-xs text-abyssal-ink/60">
          <div>
            Showing <span className="font-medium text-abyssal-ink">{showingFrom}</span>–
            <span className="font-medium text-abyssal-ink">{showingTo}</span> of{" "}
            <span className="font-medium text-abyssal-ink">{totalCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 rounded-pill border border-abyssal-ink/20 px-3 py-1 font-medium text-abyssal-ink transition-colors hover:bg-pure-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <span className="font-mono">
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center gap-1 rounded-pill border border-abyssal-ink/20 px-3 py-1 font-medium text-abyssal-ink transition-colors hover:bg-pure-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const isActive = sortKey === active;
  const Icon = isActive ? (dir === "desc" ? ChevronDown : ChevronUp) : ChevronsUpDown;
  const ariaSort: "ascending" | "descending" | "none" = isActive
    ? dir === "desc"
      ? "descending"
      : "ascending"
    : "none";
  return (
    <div role="columnheader" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        aria-label={`Sort by ${label}, ${
          isActive ? `currently ${ariaSort}` : "not sorted"
        }`}
        className={`inline-flex items-center gap-1 text-left transition-colors hover:text-abyssal-ink ${
          isActive ? "text-digital-orange" : "text-abyssal-ink/60"
        }`}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          role="row"
          aria-busy="true"
          className="hidden items-center gap-4 rounded-card bg-ash-white px-6 py-5 md:grid"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          <div className="h-6 w-12 animate-pulse rounded-sm bg-basalt-canvas" />
          <div className="h-4 w-3/4 animate-pulse rounded-sm bg-basalt-canvas" />
          <div className="h-7 w-24 animate-pulse rounded-input bg-basalt-canvas" />
          <div className="h-6 w-20 animate-pulse rounded-input bg-basalt-canvas" />
          <div className="h-8 w-32 animate-pulse rounded-sm bg-basalt-canvas" />
          <div className="h-6 w-28 animate-pulse rounded-sm bg-basalt-canvas" />
          <div className="h-3 w-20 animate-pulse rounded-sm bg-basalt-canvas" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-card bg-ash-white px-8 py-16 text-center">
      <div className="font-display text-heading-sm tracking-heading-sm text-abyssal-ink">
        No bounties posted yet.
      </div>
      <div className="text-sm text-abyssal-ink/60">Be the first.</div>
      <Link
        href="/post"
        className="mt-2 inline-flex items-center rounded-pill bg-digital-orange px-5 py-2 text-sm font-medium text-pure-white transition-opacity hover:opacity-90"
      >
        Post a bounty
      </Link>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card bg-ash-white px-8 py-12 text-center">
      <div className="font-display text-heading-sm tracking-heading-sm text-digital-orange">
        Couldn&apos;t reach indexer
      </div>
      <div className="max-w-lg wrap-break-word font-mono text-xs text-abyssal-ink/60">
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center rounded-pill border-2 border-digital-orange bg-pure-white px-5 py-2 text-sm font-medium text-digital-orange transition-colors hover:bg-digital-orange hover:text-pure-white"
      >
        Retry
      </button>
    </div>
  );
}
