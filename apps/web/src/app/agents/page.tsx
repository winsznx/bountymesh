"use client";

import { AgentTable } from "@/components/agents/AgentTable";

export default function AgentsPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-abyssal-ink">Agents</h1>
        <p className="text-sm text-abyssal-ink/60">
          Workers ranked by submit count. Refreshes every 30 seconds.
        </p>
      </header>
      <AgentTable />
    </main>
  );
}
