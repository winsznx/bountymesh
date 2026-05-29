"use client";

import Link from "next/link";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { RewardCell } from "@/components/primitives/RewardCell";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";
import { GRID_TEMPLATE } from "./BountyTable";

/**
 * Desktop bounty card — laid out as a grid row INSIDE a card surface.
 * Renders on md+; BountyCard handles mobile.
 */
export function BountyRow({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <Link
      href={`/bounties/${bounty.id.toString()}`}
      role="link"
      aria-label={`Bounty ${bounty.id.toString()}: ${bounty.title}`}
      className="hidden items-center gap-4 rounded-card bg-ash-white px-6 py-5 transition-colors hover:bg-pure-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-digital-orange md:grid"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      <div className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
        #{bounty.id.toString()}
      </div>
      <div className="truncate text-base font-medium text-abyssal-ink">
        {bounty.title}
      </div>
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
      <div className="font-mono text-xs text-abyssal-ink/60">
        #{bounty.postedAt.toLocaleString()}
      </div>
    </Link>
  );
}
