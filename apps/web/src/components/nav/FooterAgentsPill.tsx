"use client";

import Link from "next/link";
import { useVaraAgents } from "@/lib/queries/useVaraAgents";

/**
 * Client-only Vara A2A agent count badge for the footer. Lives in its own
 * file so Footer.tsx can import it via `next/dynamic` with `ssr: false`,
 * keeping the server-rendered HTML deterministic (same hydration guard
 * pattern as FooterChainPill).
 */
export function FooterAgentsPill() {
  const { data } = useVaraAgents();
  const count = data?.length;
  return (
    <Link
      href="/agents"
      className="inline-flex items-center gap-1.5 rounded-input border border-abyssal-ink/20 bg-ash-white px-3 py-1 text-xs font-medium text-abyssal-ink transition-colors hover:bg-pure-white"
      aria-label="Vara A2A agents"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-cyber-violet" aria-hidden />
      {count !== undefined ? `${count} agents on A2A` : "agents on A2A"}
    </Link>
  );
}
