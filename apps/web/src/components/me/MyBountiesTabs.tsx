"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useMyBounties, type MyBountiesRole } from "@/lib/queries/useMyBounties";
import { useWallet } from "@/lib/wallet/useWallet";
import { BountyRow } from "@/components/bounty/BountyRow";
import { BountyCard } from "@/components/bounty/BountyCard";
import { GRID_TEMPLATE } from "@/components/bounty/BountyTable";
import { SkeletonTableRows } from "@/components/primitives/Skeleton";

const TABS: { role: MyBountiesRole; label: string }[] = [
  { role: "poster", label: "Posted" },
  { role: "worker", label: "Working" },
];

export function MyBountiesTabs() {
  const { account } = useWallet();
  const [active, setActive] = useState<MyBountiesRole>("poster");

  // Both queries mount immediately + poll independently every 10s so the
  // inactive-tab count stays live (Lock E).
  const poster = useMyBounties("poster", account?.address ?? null);
  const worker = useMyBounties("worker", account?.address ?? null);

  const counts: Record<MyBountiesRole, number> = {
    poster: poster.totalCount,
    worker: worker.totalCount,
  };
  const data = active === "poster" ? poster : worker;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="My bounties" className="flex items-center gap-1 border-b border-ash-white">
        {TABS.map(({ role, label }) => {
          const isActive = role === active;
          return (
            <button
              key={role}
              id={`my-bounties-tab-${role}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`my-bounties-panel-${role}`}
              onClick={() => setActive(role)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${
                isActive
                  ? "border-digital-orange text-digital-orange"
                  : "border-transparent text-abyssal-ink/60 hover:text-abyssal-ink"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  isActive
                    ? "bg-digital-orange/10 text-digital-orange"
                    : "bg-ash-white text-abyssal-ink/40"
                }`}
              >
                {counts[role]}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-labelledby={`my-bounties-tab-${active}`}
        className="rounded-md border border-ash-white bg-ash-white"
      >
        <div
          role="row"
          className="hidden items-center gap-4 border-b border-ash-white px-4 py-3 text-xs font-medium uppercase tracking-wider text-abyssal-ink/60 md:grid"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          <div>ID</div>
          <div>Title</div>
          <div>Status</div>
          <div>Track</div>
          <div>Reward</div>
          <div>Poster</div>
          <div>Posted</div>
        </div>

        {data.isLoading ? (
          <SkeletonTableRows count={5} columns={7} gridTemplate={GRID_TEMPLATE} />
        ) : data.error ? (
          <ErrorRow message={data.error.message} />
        ) : data.bounties.length === 0 ? (
          active === "poster" ? <EmptyPosted /> : <EmptyWorker />
        ) : (
          data.bounties.map((b) => (
            <Fragment key={b.id.toString()}>
              <BountyRow bounty={b} />
              <BountyCard bounty={b} />
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-digital-orange">Couldn&apos;t reach indexer</p>
      <p className="mt-1 font-mono text-xs text-abyssal-ink/40">{message}</p>
    </div>
  );
}

function EmptyPosted() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="text-base text-abyssal-ink/80">You haven&apos;t posted any bounties yet.</div>
      <div className="text-sm text-abyssal-ink/40">Hit /post to start.</div>
      <Link
        href="/post"
        className="mt-2 rounded-md bg-digital-orange px-4 py-2 text-sm font-medium text-pure-white transition-opacity hover:opacity-90"
      >
        Post a bounty
      </Link>
    </div>
  );
}

function EmptyWorker() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="text-base text-abyssal-ink/80">You haven&apos;t claimed any bounties yet.</div>
      <div className="text-sm text-abyssal-ink/40">Browse /bounties to find one.</div>
      <Link
        href="/bounties"
        className="mt-2 rounded-md bg-digital-orange px-4 py-2 text-sm font-medium text-pure-white transition-opacity hover:opacity-90"
      >
        Browse open bounties
      </Link>
    </div>
  );
}
