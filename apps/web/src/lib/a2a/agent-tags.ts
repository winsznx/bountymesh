/**
 * Frontend mirror of services/chat-poster/src/agent-tags.ts.
 *
 * Deliberately duplicated (small, pure, no Node deps) so the browser-side
 * Ping Agents modal can pick the same agents the cron service would pick
 * for a given bounty. Keep the AGENT_CAPABILITIES map in sync.
 */

export const AGENT_CAPABILITIES: Record<string, string[]> = {
  oltking: ["oracle", "price-feed", "data", "defi"],
  zeeast: ["casino", "gaming", "economy", "markets"],
  "hy4-agent": ["prediction", "markets", "binary", "economy"],
  "aan-tv": ["analytics", "aggregation", "social"],
  varabridge: ["oracle", "bridge", "price-feed"],
  "infinite-bounty-v3": ["services", "tasks", "bounties"],
  "hy4-predict-app": ["prediction", "markets"],
  varanest: ["portfolio", "analytics"],
  "a2a-radar": ["economy", "subscriptions", "metrics"],
  "luisa-builder": ["agent-tooling", "services", "social"],
  dev: ["dex", "orderbook", "amm"],
  "skopos-bridge": ["defi", "cross-chain", "tooling"],
  "agent-arena-op": ["rewards", "missions", "zero-cost"],
  dirac: ["gaming", "colosseum"],
  "agent-trust-layer-v2": ["trust", "escrow", "reputation"],
  "trust-marketplace": ["marketplace", "trust"],
};

const TRACK_TO_TAGS: Record<string, string[]> = {
  Services: ["services", "tasks", "bounties", "tooling", "agent-tooling"],
  Economy: ["economy", "markets", "defi", "oracle", "price-feed", "prediction", "dex"],
  Social: ["social", "aggregation", "analytics"],
  Open: [],
};

const FALLBACK_HANDLES = ["oltking", "dev", "luisa-builder", "infinite-bounty-v3"];

export function matchAgents(bounty: {
  track: string;
  title: string;
  description: string;
}): string[] {
  const trackTags = TRACK_TO_TAGS[bounty.track] ?? [];
  const title = bounty.title.toLowerCase();
  const description = bounty.description.toLowerCase();

  const scored: Array<{ handle: string; score: number }> = [];
  for (const [handle, caps] of Object.entries(AGENT_CAPABILITIES)) {
    let score = 0;
    for (const tag of caps) {
      if (trackTags.includes(tag)) score += 5;
      if (title.includes(tag)) score += 3;
      if (description.includes(tag)) score += 1;
    }
    if (score > 0) scored.push({ handle, score });
  }
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.handle.localeCompare(b.handle)));
  if (scored.length === 0) return [...FALLBACK_HANDLES];
  return scored.slice(0, 5).map((x) => x.handle);
}
