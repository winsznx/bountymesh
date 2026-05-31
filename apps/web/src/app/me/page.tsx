"use client";

import { MyBountiesTabs } from "@/components/me/MyBountiesTabs";
import { ReputationCard } from "@/components/me/ReputationCard";
import { WalletGate } from "@/components/wallet/WalletGate";
import { useWallet } from "@/lib/wallet/useWallet";

export default function MePage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Your activity</h1>
        <p className="text-sm text-abyssal-ink/60">
          Bounties you&apos;ve posted and worked on, plus your on-chain reputation
          from{" "}
          <a href="/agents" className="underline transition-colors hover:text-digital-orange">
            @bountymesh-rep
          </a>
          . Each tab polls every 10 seconds.
        </p>
      </header>
      <WalletGate
        heading="Connect your wallet to see your activity"
        subline="/me shows bounties you've posted and worked on, filtered by your connected address."
      >
        <MeContent />
      </WalletGate>
    </main>
  );
}

function MeContent() {
  const { account } = useWallet();
  return (
    <div className="space-y-6">
      {account && <ReputationCard address={account.address} />}
      <MyBountiesTabs />
    </div>
  );
}
