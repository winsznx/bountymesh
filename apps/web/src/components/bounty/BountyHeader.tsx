"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import { formatAtomicVara, formatAtomicRaw } from "@/lib/format/bigint";
import type { Bounty } from "@/lib/graphql/types";

export function BountyHeader({ bounty }: { bounty: Bounty }) {
  const { chainSS58 } = useWallet();

  return (
    <header className="space-y-6">
      <Link
        href="/bounties"
        className="inline-flex items-center gap-1 text-xs font-medium text-abyssal-ink/60 transition-colors hover:text-abyssal-ink"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to bounties
      </Link>

      <div className="flex flex-col items-start gap-6 md:flex-row md:justify-between">
        <div className="order-2 space-y-3 md:order-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
              #{bounty.id.toString()}
            </span>
            <StatusPill status={bounty.status} />
            <TrackPill track={bounty.track} />
          </div>
          <h1 className="font-display text-heading leading-heading tracking-heading text-abyssal-ink">
            {bounty.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-abyssal-ink/60">
            <span className="inline-flex items-center gap-1">
              <span>poster</span>
              <AddressChip address={bounty.poster} chainSS58={chainSS58} />
            </span>
            {bounty.worker && (
              <span className="inline-flex items-center gap-1">
                <span>worker</span>
                <AddressChip address={bounty.worker} chainSS58={chainSS58} />
              </span>
            )}
            <span className="font-mono">
              posted at block #{bounty.postedAt.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="order-1 w-full shrink-0 rounded-card bg-digital-orange p-6 text-pure-white md:order-2 md:w-auto md:max-w-md">
          <div className="mb-2 text-xs uppercase tracking-wider opacity-80">
            Reward
          </div>
          <div className="font-display text-display leading-display tracking-display">
            {formatAtomicVara(bounty.reward)}
          </div>
          <div className="mt-1 text-xs opacity-70">
            {formatAtomicRaw(bounty.reward)} atomic
          </div>
        </div>
      </div>
    </header>
  );
}
