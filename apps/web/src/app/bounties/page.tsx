"use client";

import { BountyTable } from "@/components/bounty/BountyTable";

export default function BountiesPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Bounties</h1>
        <p className="text-sm text-abyssal-ink/60">
          Live from the indexer. Polls every 8 seconds.
        </p>
      </header>
      <BountyTable />
    </main>
  );
}
