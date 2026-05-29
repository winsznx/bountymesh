"use client";

import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Agent } from "@/lib/queries/useAgents";

export function AgentCard({ agent }: { agent: Agent }) {
  const { chainSS58 } = useWallet();

  return (
    <div className="space-y-4 border-b border-slate-800/70 px-4 py-4 md:hidden">
      <div>
        <AddressChip address={agent.address} chainSS58={chainSS58} label="worker" />
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Claims" value={agent.claimCount} />
        <Stat label="Submits" value={agent.submitCount} />
        <Stat label="Bounties" value={agent.distinctBounties} />
      </dl>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-mono">last #{agent.lastActiveBlock.toLocaleString()}</span>
        <span className="font-mono text-slate-300">{agent.deliveryRatePct}% delivery</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1 rounded-md border border-slate-800 bg-slate-900/50 py-2">
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="font-mono text-lg text-slate-100">{value}</dd>
    </div>
  );
}
