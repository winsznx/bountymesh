"use client";

import Link from "next/link";
import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Agent } from "@/lib/queries/useAgents";

export function AgentCard({ agent }: { agent: Agent }) {
  const { chainSS58 } = useWallet();

  return (
    <Link
      href={`/workers/${agent.address}`}
      className="block space-y-4 border-b border-abyssal-ink/10 px-4 py-4 transition-colors hover:bg-pure-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-digital-orange md:hidden"
    >
      <div>
        <AddressChip
          address={agent.address}
          chainSS58={chainSS58}
          label="worker"
          copyable={false}
        />
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Claims" value={agent.claimCount} />
        <Stat label="Submits" value={agent.submitCount} />
        <Stat label="Bounties" value={agent.distinctBounties} />
      </dl>

      <div className="flex items-center justify-between text-xs text-abyssal-ink/40">
        <span className="font-mono">last #{agent.lastActiveBlock.toLocaleString()}</span>
        <span className="font-mono text-abyssal-ink/80">{agent.deliveryRatePct}% delivery</span>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1 rounded-md border border-ash-white bg-ash-white py-2">
      <dt className="text-xs uppercase tracking-wider text-abyssal-ink/40">{label}</dt>
      <dd className="font-mono text-lg text-abyssal-ink">{value}</dd>
    </div>
  );
}
