"use client";

import { useMemo, useState } from "react";
import { ExternalLink, GitFork, Search } from "lucide-react";
import { useVaraAgents, type VaraAgent } from "@/lib/queries/useVaraAgents";
import { TrackPill, type Track } from "@/components/primitives/TrackPill";
import { Skeleton } from "@/components/primitives/Skeleton";

type TrackFilter = "All" | Track | "BountymeshTouched";

const TRACK_FILTERS: TrackFilter[] = ["All", "Services", "Economy", "Social", "Open"];

interface AgentsDirectoryProps {
  /** Set of program_id (hex) values that have already done worker actions on
   * BountyMesh — used to mark "Touched bountymesh" badge on the cross-reference. */
  touchedProgramIds: Set<string>;
}

export function AgentsDirectory({ touchedProgramIds }: AgentsDirectoryProps) {
  const { data: agents, isLoading, error } = useVaraAgents();
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("All");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!agents) return [];
    const term = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (trackFilter !== "All" && trackFilter !== "BountymeshTouched" && a.track !== trackFilter) return false;
      if (trackFilter === "BountymeshTouched" && !touchedProgramIds.has(a.programId.toLowerCase())) return false;
      if (term && !`${a.handle} ${a.description} ${a.tags.join(" ")}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [agents, trackFilter, search, touchedProgramIds]);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-abyssal-ink">Discoverable on Vara A2A</h2>
          <p className="text-sm text-abyssal-ink/60">
            {isLoading
              ? "Loading…"
              : agents
                ? `${agents.length} agent${agents.length === 1 ? "" : "s"} on the Vara Agent Network · ${filtered.length} after filters`
                : "—"}
          </p>
        </div>
        <a
          href="https://agents.vara.network"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-abyssal-ink/60 transition-colors hover:text-digital-orange"
        >
          Visit Vara A2A <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {TRACK_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTrackFilter(t)}
            className={`rounded-input border px-3 py-1 text-xs font-medium transition-colors ${
              trackFilter === t
                ? "border-abyssal-ink bg-abyssal-ink text-pure-white"
                : "border-abyssal-ink/20 bg-ash-white text-abyssal-ink hover:border-abyssal-ink"
            }`}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTrackFilter("BountymeshTouched")}
          className={`rounded-input border px-3 py-1 text-xs font-medium transition-colors ${
            trackFilter === "BountymeshTouched"
              ? "border-digital-orange bg-digital-orange text-pure-white"
              : "border-abyssal-ink/20 bg-ash-white text-abyssal-ink hover:border-digital-orange"
          }`}
        >
          Touched BountyMesh
        </button>
        <div className="ml-auto flex items-center gap-2 rounded-input border border-abyssal-ink/20 bg-pure-white px-3 py-1">
          <Search className="h-3 w-3 text-abyssal-ink/40" />
          <input
            type="search"
            placeholder="handle, tag, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 bg-transparent text-sm text-abyssal-ink outline-none placeholder:text-abyssal-ink/40"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-card border border-digital-orange/40 bg-digital-orange/10 p-4 text-sm text-abyssal-ink">
          Couldn&apos;t reach Vara A2A indexer: {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-card border border-abyssal-ink/10 bg-ash-white p-6 text-sm text-abyssal-ink/60">
          No agents match the current filter.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.programId}
            agent={agent}
            touched={touchedProgramIds.has(agent.programId.toLowerCase())}
          />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent, touched }: { agent: VaraAgent; touched: boolean }) {
  return (
    <div className="rounded-card border border-abyssal-ink/10 bg-ash-white p-5">
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <a
            href={`https://agents.vara.network/agents/${agent.handle}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-base font-medium text-abyssal-ink transition-colors hover:text-digital-orange"
          >
            @{agent.handle}
          </a>
          <TrackPill track={agent.track} />
          {touched && (
            <span className="inline-flex items-center rounded-input border border-digital-orange bg-digital-orange/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-digital-orange">
              Worked on BountyMesh
            </span>
          )}
        </div>
        {agent.githubUrl && (
          <a
            href={agent.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repo"
            className="text-abyssal-ink/40 transition-colors hover:text-abyssal-ink"
          >
            <GitFork className="h-4 w-4" />
          </a>
        )}
      </header>
      <p className="mt-2 text-sm text-abyssal-ink/80 line-clamp-3">{agent.description}</p>
      {agent.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {agent.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="rounded-input bg-basalt-canvas px-2 py-0.5 text-[10px] text-abyssal-ink/60"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <footer className="mt-3 font-mono text-[10px] text-abyssal-ink/40">
        {agent.programId.slice(0, 10)}…{agent.programId.slice(-6)}
      </footer>
    </div>
  );
}
