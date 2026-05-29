"use client";

import { useStats } from "@/lib/queries/useStats";
import { formatAtomicRaw, formatAtomicVara } from "@/lib/format/bigint";
import { StatCard } from "@/components/stats/StatCard";
import { StatusBreakdown } from "@/components/stats/StatusBreakdown";
import { TopPosters } from "@/components/stats/TopPosters";

export default function StatsPage() {
  const { data, isLoading, error } = useStats();

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Protocol stats</h1>
        <p className="text-sm text-abyssal-ink/60">
          Real numbers from the indexer. Refreshes every 30 seconds.
        </p>
      </header>

      {error ? (
        <ErrorPanel message={error.message} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard
              label="Total bounties"
              value={data ? data.counts.total.toString() : "—"}
              sub="across all states"
              loading={isLoading && !data}
            />
            <StatCard
              label="VARA escrowed"
              value={data ? formatAtomicRaw(data.totalEscrowed) : "—"}
              sub={
                data
                  ? `${formatAtomicVara(data.totalEscrowed)} · locked in contract — Open through Accepted`
                  : "locked in contract — Open through Accepted"
              }
              loading={isLoading && !data}
            />
            <StatCard
              label="VARA settled"
              value={data ? formatAtomicRaw(data.totalSettled) : "—"}
              sub={
                data
                  ? `${formatAtomicVara(data.totalSettled)} · withdrawn to workers`
                  : "withdrawn to workers"
              }
              loading={isLoading && !data}
            />
          </div>

          {data && <StatusBreakdown counts={data.counts} />}

          <TopPosters />
        </>
      )}
    </main>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-md border border-digital-orange/30 bg-digital-orange/10 p-6 text-center">
      <p className="text-sm font-medium text-digital-orange">Couldn&apos;t reach indexer</p>
      <p className="font-mono text-xs text-abyssal-ink/40">{message}</p>
    </div>
  );
}
