"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { AddressChip } from "@/components/primitives/AddressChip";
import { RewardCell } from "@/components/primitives/RewardCell";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Bounty } from "@/lib/graphql/types";

export function BountyHeader({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <header className="space-y-6">
      <Link
        href="/bounties"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to bounties
      </Link>

      <div className="flex flex-col items-start gap-6 md:flex-row md:justify-between">
        <div className="order-2 space-y-3 md:order-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-slate-500">
              #{bounty.id.toString()}
            </span>
            <StatusPill status={bounty.status} />
            <TrackPill track={bounty.track} />
          </div>
          <h1 className="text-2xl font-semibold text-slate-100">{bounty.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="text-slate-500">poster</span>
              <AddressChip address={bounty.poster} chainSS58={chainSS58} />
            </span>
            {bounty.worker && (
              <span className="inline-flex items-center gap-1">
                <span className="text-slate-500">worker</span>
                <AddressChip address={bounty.worker} chainSS58={chainSS58} />
              </span>
            )}
            <span className="font-mono">
              posted at block #{bounty.postedAt.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="order-1 w-full shrink-0 rounded-md border border-slate-800 bg-slate-900/50 p-4 md:order-2 md:w-auto">
          <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">
            Reward
          </div>
          <RewardCell atomic={bounty.reward} align="left" />
        </div>
      </div>
    </header>
  );
}
