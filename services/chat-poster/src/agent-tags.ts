/**
 * Capability mapping from Vara A2A handle → tag set. Used by the matcher
 * to pick 1-3 agents whose declared capabilities overlap a given bounty's
 * track + title keywords. Single source of truth for invitation targeting.
 *
 * Edit when a new peer Application registers that's worth inviting.
 * Per-bounty mention count caps at 3 in the templates regardless of how
 * many agents score the same; the score-tie sorter takes the first 3
 * by registry order (handle alphabetical).
 */

export const AGENT_CAPABILITIES: Record<string, string[]> = {
  oltking: ['oracle', 'price-feed', 'data', 'defi'],
  zeeast: ['casino', 'gaming', 'economy', 'markets'],
  'hy4-agent': ['prediction', 'markets', 'binary', 'economy'],
  'aan-tv': ['analytics', 'aggregation', 'social'],
  varabridge: ['oracle', 'bridge', 'price-feed'],
  'infinite-bounty-v3': ['services', 'tasks', 'bounties'],
  'hy4-predict-app': ['prediction', 'markets'],
  varanest: ['portfolio', 'analytics'],
  'a2a-radar': ['economy', 'subscriptions', 'metrics'],
  'luisa-builder': ['agent-tooling', 'services', 'social'],
  dev: ['dex', 'orderbook', 'amm'],
  'skopos-bridge': ['defi', 'cross-chain', 'tooling'],
  'agent-arena-op': ['rewards', 'missions', 'zero-cost'],
  dirac: ['gaming', 'colosseum'],
  'agent-trust-layer-v2': ['trust', 'escrow', 'reputation'],
  'trust-marketplace': ['marketplace', 'trust'],
};

const TRACK_TO_TAGS: Record<string, string[]> = {
  Services: ['services', 'tasks', 'bounties', 'tooling', 'agent-tooling'],
  Economy: ['economy', 'markets', 'defi', 'oracle', 'price-feed', 'prediction', 'dex'],
  Social: ['social', 'aggregation', 'analytics'],
  Open: [],
};

const FALLBACK_HANDLES = ['oltking', 'dev', 'luisa-builder', 'infinite-bounty-v3'];

/**
 * Score = sum of tag overlaps × weight.
 *   - Track match (the bounty's track maps to a tag-set; any of those tags
 *     in the agent's capability list scores +5)
 *   - Title keyword match (each tag found in the lowercased title scores +3)
 *   - Description keyword match (each tag found in lowercased description scores +1)
 *
 * Top-3 by score with stable handle-alphabetical tie-break. Returns at
 * least the FALLBACK_HANDLES when no agent scores anything.
 */
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

  if (scored.length === 0) {
    return [...FALLBACK_HANDLES];
  }
  return scored.slice(0, 3).map((x) => x.handle);
}
