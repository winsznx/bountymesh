"use client";

import Link from "next/link";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { RewardCell } from "@/components/primitives/RewardCell";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";

export function BountyCard({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <Link
      href={`/bounties/${bounty.id.toString()}`}
      role="link"
      aria-label={`Bounty ${bounty.id.toString()}: ${bounty.title}`}
      className="block space-y-4 border-b border-slate-800/70 px-4 py-4 transition-colors hover:bg-slate-900/50 focus-visible:bg-slate-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-sm text-slate-400">#{bounty.id.toString()}</span>
        <StatusPill status={bounty.status} />
      </div>

      <div className="text-sm leading-snug text-slate-100">{bounty.title}</div>

      <RewardCell atomic={bounty.reward} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
        <TrackPill track={bounty.track} />
        <span className="inline-flex items-center gap-1">
          <span>poster</span>
          <AddressChip address={bounty.poster} chainSS58={chainSS58} />
        </span>
        <span className="font-mono">#{bounty.postedAt.toLocaleString()}</span>
      </div>
    </Link>
  );
}
