"use client";

import Link from "next/link";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { RewardCell } from "@/components/primitives/RewardCell";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";

/**
 * BountyMesh bounty card — Ash White surface, 40px radius, generous padding.
 * Renders on mobile (md:hidden); BountyRow handles desktop.
 */
export function BountyCard({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <Link
      href={`/bounties/${bounty.id.toString()}`}
      role="link"
      aria-label={`Bounty ${bounty.id.toString()}: ${bounty.title}`}
      className="block space-y-5 rounded-card bg-ash-white p-6 transition-colors hover:bg-pure-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-digital-orange md:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
          #{bounty.id.toString()}
        </span>
        <StatusPill status={bounty.status} />
      </div>

      <div className="text-lg font-medium leading-snug text-abyssal-ink">
        {bounty.title}
      </div>

      <RewardCell atomic={bounty.reward} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-abyssal-ink/60">
        <TrackPill track={bounty.track} />
        <span className="inline-flex items-center gap-1">
          <span>poster</span>
          <AddressChip
            address={bounty.poster}
            chainSS58={chainSS58}
            copyable={false}
          />
        </span>
        <span className="font-mono">#{bounty.postedAt.toLocaleString()}</span>
      </div>
    </Link>
  );
}
