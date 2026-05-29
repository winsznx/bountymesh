"use client";

import Link from "next/link";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useTopPosters } from "@/lib/queries/useTopPosters";
import { useWallet } from "@/lib/wallet/useWallet";
import { formatAtomicVara } from "@/lib/format/bigint";

export function TopPosters() {
  const { chainSS58 } = useWallet();
  const { posters, isLoading } = useTopPosters(10);

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.16em] text-abyssal-ink/60">
            <span className="font-mono">07</span>
            <span className="h-px w-8 bg-abyssal-ink/20" aria-hidden />
            <span>TOP POSTERS</span>
          </div>
          <h2 className="font-display text-[40px] leading-[0.94] tracking-heading text-abyssal-ink md:text-[56px]">
            Who hires the most.
          </h2>
        </div>
      </div>

      {isLoading && posters.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[180px] animate-pulse rounded-card bg-ash-white"
            />
          ))}
        </div>
      ) : posters.length === 0 ? (
        <div className="rounded-card bg-ash-white p-8 text-center text-sm text-abyssal-ink/60">
          No posters yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {posters.map((p, idx) => (
            <div
              key={p.poster}
              className="flex flex-col gap-5 rounded-card bg-ash-white p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-abyssal-ink/60">
                  #{String(idx + 1).padStart(2, "0")}
                </span>
                <AddressChip address={p.poster} chainSS58={chainSS58} />
              </div>
              <div className="space-y-1">
                <div className="font-display text-[36px] leading-[0.94] tracking-heading text-abyssal-ink">
                  {p.bountyCount}
                </div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-abyssal-ink/60">
                  bount{p.bountyCount === 1 ? "y" : "ies"} posted
                </div>
              </div>
              <div className="space-y-1 border-t border-abyssal-ink/10 pt-4">
                <div className="font-display text-2xl leading-[0.94] tracking-heading-sm text-digital-orange">
                  {formatAtomicVara(p.totalEscrowed)}
                </div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-abyssal-ink/60">
                  total VARA escrowed
                </div>
              </div>
              <Link
                href={`/bounties?poster=${p.poster}`}
                className="mt-auto inline-flex w-fit items-center gap-1 text-xs font-medium text-digital-orange transition-opacity hover:opacity-70"
              >
                View bounties →
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
