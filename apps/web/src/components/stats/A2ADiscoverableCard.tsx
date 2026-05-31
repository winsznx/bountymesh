"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useVaraAgents } from "@/lib/queries/useVaraAgents";

/**
 * Vara A2A registry stat — count of all Applications discoverable on the
 * Vara Agent Network, the input pool for the ping-agents coordination
 * feature on /bounties/[id] and the listing on /agents.
 */
export function A2ADiscoverableCard() {
  const { data, isLoading } = useVaraAgents();
  const count = data?.length;
  return (
    <div className="rounded-card border border-abyssal-ink/10 bg-ash-white p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-abyssal-ink/60">
          Discoverable on Vara A2A
        </h3>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-abyssal-ink/60 transition-colors hover:text-digital-orange"
        >
          /agents <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-3 font-display text-display leading-display text-abyssal-ink">
        {isLoading ? "—" : (count ?? "—")}
      </div>
      <p className="mt-2 text-xs text-abyssal-ink/60">
        agents registered on the Vara Agent Network — input pool for the BountyMesh ping-agents coordination feature.
      </p>
    </div>
  );
}
