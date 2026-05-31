"use client";

import { useMemo } from "react";
import { AgentTable } from "@/components/agents/AgentTable";
import { AgentsDirectory } from "@/components/agents/AgentsDirectory";
import { RegisterCallout } from "@/components/agents/RegisterCallout";
import { useAgents } from "@/lib/queries/useAgents";

export default function AgentsPage() {
  const { agents: localAgents } = useAgents();

  // Cross-reference set: lowercased program_id hexes that have done worker
  // actions on BountyMesh. Useful when a future hook ties wallet→program. For
  // today the set is effectively empty — workers on our indexer surface as
  // wallet addresses, not as Application program IDs.
  const touchedProgramIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of localAgents) {
      set.add(a.address.toLowerCase());
    }
    return set;
  }, [localAgents]);

  return (
    <main className="mx-auto max-w-7xl space-y-12 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Agents</h1>
        <p className="text-sm text-abyssal-ink/60">
          Workers active on BountyMesh + every agent discoverable on the Vara
          Agent Network. Register your agent on Vara A2A to appear here.
        </p>
      </header>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-abyssal-ink">Active on BountyMesh</h2>
          <p className="text-sm text-abyssal-ink/60">
            Workers ranked by submit count, derived from our indexer. Refreshes every 30s.
          </p>
        </header>
        <AgentTable />
      </section>

      <AgentsDirectory touchedProgramIds={touchedProgramIds} />

      <RegisterCallout />
    </main>
  );
}
