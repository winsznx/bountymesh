"use client";

import Link from "next/link";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { RewardCell } from "@/components/primitives/RewardCell";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";
import { GRID_TEMPLATE } from "./BountyTable";

export function BountyRow({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <Link
      href={`/bounties/${bounty.id.toString()}`}
      role="link"
      aria-label={`Bounty ${bounty.id.toString()}: ${bounty.title}`}
      className="hidden items-center gap-4 border-b border-slate-800/70 px-4 py-3 transition-colors hover:bg-slate-900/50 focus-visible:bg-slate-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:grid"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      <div className="font-mono text-sm text-slate-400">#{bounty.id.toString()}</div>
      <div className="truncate text-sm text-slate-100">{bounty.title}</div>
      <div>
        <StatusPill status={bounty.status} />
      </div>
      <div>
        <TrackPill track={bounty.track} />
      </div>
      <div>
        <RewardCell atomic={bounty.reward} />
      </div>
      <div>
        <AddressChip address={bounty.poster} chainSS58={chainSS58} />
      </div>
      <div className="font-mono text-xs text-slate-400">#{bounty.postedAt.toLocaleString()}</div>
    </Link>
  );
}
