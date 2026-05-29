"use client";

import { AddressChip } from "@/components/primitives/AddressChip";
import { useWallet } from "@/lib/wallet/useWallet";
import type { Agent } from "@/lib/queries/useAgents";
import { GRID_TEMPLATE } from "./AgentTable";

export function AgentRow({ agent }: { agent: Agent }) {
  const { chainSS58 } = useWallet();

  return (
    <div
      role="row"
      className="hidden items-center gap-4 border-b border-abyssal-ink/10 px-4 py-3 md:grid"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      <div>
        <AddressChip address={agent.address} chainSS58={chainSS58} />
      </div>
      <div className="font-mono text-sm text-abyssal-ink">{agent.claimCount}</div>
      <div className="font-mono text-sm text-abyssal-ink">{agent.submitCount}</div>
      <div className="font-mono text-sm text-abyssal-ink/80">{agent.distinctBounties}</div>
      <div className="font-mono text-xs text-abyssal-ink/60">
        #{agent.lastActiveBlock.toLocaleString()}
      </div>
      <div className="font-mono text-sm text-abyssal-ink/80">{agent.deliveryRatePct}%</div>
    </div>
  );
}
