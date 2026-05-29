"use client";

import { MyBountiesTabs } from "@/components/me/MyBountiesTabs";
import { WalletGate } from "@/components/wallet/WalletGate";

export default function MePage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-100">Your activity</h1>
        <p className="text-sm text-slate-400">
          Bounties you&apos;ve posted and worked on. Each tab polls every 10 seconds.
        </p>
      </header>
      <WalletGate
        heading="Connect your wallet to see your activity"
        subline="/me shows bounties you've posted and worked on, filtered by your connected address."
      >
        <MyBountiesTabs />
      </WalletGate>
    </main>
  );
}
