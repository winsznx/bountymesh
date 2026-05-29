"use client";

import { PostBountyForm } from "@/components/post/PostBountyForm";
import { WalletGate } from "@/components/wallet/WalletGate";

export default function PostPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Post a bounty</h1>
        <p className="text-sm text-abyssal-ink/60">
          Reward escrows at post. Workers claim, submit, you accept, they withdraw.
        </p>
      </header>
      <WalletGate
        heading="Connect your wallet to post a bounty"
        subline="You'll sign one transaction. Your wallet escrows the reward into the BountyMesh program — no proxy, no custodian."
      >
        <PostBountyForm />
      </WalletGate>
    </main>
  );
}
