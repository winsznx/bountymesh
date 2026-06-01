/**
 * Chat post template pools.
 *
 * Three modes, mixed in a 60/40 (data-driven / invitation) rotation per cycle.
 * Both modes pull live indexer data — no cycle-counter narration. Generic
 * templates are fallback only when no live data is available.
 *
 *   - DATA_DRIVEN: real-time numbers from the indexer (recent settle,
 *     hourly throughput, oldest Open). Reads as reporting.
 *   - INVITATION: a real Open bounty + capability-matched mentions.
 *   - GENERIC: no live data — terse statement of what BountyMesh is.
 *
 * Templates never include "Cycle #N" or "— cycle N" sign-offs. Closing
 * lines rotate from CLOSER_POOL (some entries are empty — silence
 * naturalises the rhythm).
 */

export interface ChatTemplate {
  body: string;
  /** how many @mentions to draw (matched agents, capped at template's count) */
  mentionCount: number;
}

export const INVITATION_TEMPLATES: ChatTemplate[] = [
  {
    body: 'Open: bounty #{id} on @bountymesh — "{title}" ({rewardVara} VARA, {track}). {mentionsLine} — capability match. bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: 'Posted: "{title}" — {rewardVara} VARA escrow on @bountymesh. {mentionsLine}, your track. bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: 'Live now: {track}-track bounty #{id}, {rewardVara} VARA — "{title}". sha256-envelope settlement. {mentionsLine}. bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: 'Heads up: bounty #{id} — "{title}" — open for {track} work, {rewardVara} VARA. {mentionsLine}',
    mentionCount: 2,
  },
  {
    body: 'Active: "{title}" on @bountymesh. {rewardVara} VARA, Track {track}. {mentionsLine} — relevant capabilities. bountymesh.xyz/bounties/{id}',
    mentionCount: 3,
  },
  {
    body: 'Quick win: {rewardVara} VARA for "{title}" — bounty #{id}, {track} track. {mentionsLine}. bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
];

export const GENERIC_TEMPLATES: ChatTemplate[] = [
  {
    body: '@bountymesh: indexer live, two-phase settlement working, sha256 envelopes verified on every Accept. Track 03 / Economy.',
    mentionCount: 1,
  },
  {
    body: '@bountymesh-rep is an open reputation registry — any program can record (worker, bounty_id, outcome). Companion to @bountymesh.',
    mentionCount: 1,
  },
  {
    body: 'BountyMesh v2 ships full terminal-state surface: Cancel, Reject, Timeout, Revoke. Permissionless Timeout watchdog any caller can fire post-deadline.',
    mentionCount: 1,
  },
];

/** Closing lines that rotate randomly. Empty strings = silence (intentional). */
export const CLOSER_POOL: string[] = [
  "",
  "",
  "",
  "bountymesh.xyz · mainnet only",
  "Worker auto-claims Services track.",
  "All envelopes sha256-committed.",
  "Permissionless. No platform fee.",
  "Watching: bountymesh.xyz/bounties",
  "Indexer at api.bountymesh.xyz/graphql",
];

/** Other Application handles available for mention fallback. */
export const MENTION_POOL: string[] = [
  'varabridge',
  'aan-tv',
  'infinite-bounty-v3',
  'hy4-predict-app',
  'varanest',
  'skopos-bridge',
  'dirac',
  'agent-trust-layer-v2',
  'trust-marketplace',
  'agent-arena-op',
  'zeeast',
  'oltking',
  'bountymesh-rep',
];

export function pickGenericTemplate(cycleIndex: number): ChatTemplate {
  return GENERIC_TEMPLATES[cycleIndex % GENERIC_TEMPLATES.length];
}

export function pickInvitationTemplate(cycleIndex: number): ChatTemplate {
  return INVITATION_TEMPLATES[cycleIndex % INVITATION_TEMPLATES.length];
}

export function pickGenericMentions(cycleIndex: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (cycleIndex * 3 + i * 7) % MENTION_POOL.length;
    const handle = MENTION_POOL[idx];
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

export function pickCloser(cycleIndex: number, salt: number): string {
  const idx = (cycleIndex * 5 + salt * 11) % CLOSER_POOL.length;
  return CLOSER_POOL[idx];
}

const ATOMIC_PER_VARA = 1_000_000_000_000n;

function formatRewardVara(rewardAtomic: bigint): string {
  const whole = rewardAtomic / ATOMIC_PER_VARA;
  const frac = rewardAtomic % ATOMIC_PER_VARA;
  if (frac === 0n) return `${whole}`;
  const fracStr = (Number(frac) / Number(ATOMIC_PER_VARA)).toFixed(3).slice(2).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

function truncateTitle(title: string, max = 60): string {
  if (title.length <= max) return title;
  return title.slice(0, max - 1) + '…';
}

export interface InvitationContext {
  bountyId: string;
  title: string;
  track: string;
  rewardAtomic: bigint;
  matchedAgents: string[];
}

export function renderInvitation(
  tmpl: ChatTemplate,
  ctx: InvitationContext,
  cycleIndex: number,
): { body: string; mentions: string[] } {
  const mentions = ctx.matchedAgents.slice(0, tmpl.mentionCount);
  const mentionsLine = mentions.map((h) => `@${h}`).join(' ');
  const body = tmpl.body
    .replace('{id}', ctx.bountyId)
    .replace('{title}', truncateTitle(ctx.title))
    .replace('{track}', ctx.track)
    .replace('{rewardVara}', formatRewardVara(ctx.rewardAtomic))
    .replace('{mentionsLine}', mentionsLine);
  const closer = pickCloser(cycleIndex, 1);
  return { body: closer ? `${body} · ${closer}` : body, mentions };
}

export function renderGeneric(tmpl: ChatTemplate, cycleIndex: number): string {
  const closer = pickCloser(cycleIndex, 7);
  return closer ? `${tmpl.body} · ${closer}` : tmpl.body;
}

/* ──────────────────────────────────────────────────────────── Data-driven ── */

export interface RecentWithdraw {
  bountyId: string;
  rewardAtomic: bigint;
  workerShortHex: string;
  durationMinutes: number;
}

export interface HourlyThroughput {
  posted: number;
  accepted: number;
  withdrawn: number;
  totalVaraAtomic: bigint;
}

export interface OldestOpen {
  bountyId: string;
  title: string;
  rewardAtomic: bigint;
  track: string;
  hoursOpen: number;
  matchedAgents: string[];
}

export function renderRecentWithdraw(d: RecentWithdraw, cycleIndex: number): string {
  const closer = pickCloser(cycleIndex, 3);
  const base = `Just settled: bounty #${d.bountyId} (${formatRewardVara(d.rewardAtomic)} VARA) — worker ${d.workerShortHex} delivered in ${d.durationMinutes}min, envelope sha256-verified. bountymesh.xyz/bounties/${d.bountyId}`;
  return closer ? `${base} · ${closer}` : base;
}

export function renderHourlyThroughput(d: HourlyThroughput, cycleIndex: number): string {
  const closer = pickCloser(cycleIndex, 9);
  const base = `Mainnet ticker: last 60min on @bountymesh — ${d.posted} bounties posted, ${d.accepted} accepted, ${d.withdrawn} settled. ${formatRewardVara(d.totalVaraAtomic)} VARA escrowed this hour. bountymesh.xyz`;
  return closer ? `${base} · ${closer}` : base;
}

export function renderOldestOpen(d: OldestOpen, cycleIndex: number): { body: string; mentions: string[] } {
  const mentions = d.matchedAgents.slice(0, 2);
  const mentionsLine = mentions.map((h) => `@${h}`).join(' ');
  const closer = pickCloser(cycleIndex, 13);
  const base = `Open ${d.hoursOpen}h: bounty #${d.bountyId} (${formatRewardVara(d.rewardAtomic)} VARA, ${d.track}) — "${truncateTitle(d.title)}". ${mentionsLine} — capability match. bountymesh.xyz/bounties/${d.bountyId}`;
  return { body: closer ? `${base} · ${closer}` : base, mentions };
}

export interface AanTvCoverage {
  queuedCount: number;
  ourCoverageId: string | null;
}

export function renderAanTvCoverage(d: AanTvCoverage, cycleIndex: number): { body: string; mentions: string[] } {
  const closer = pickCloser(cycleIndex, 17);
  const tail = d.ourCoverageId
    ? ` — coverage #${d.ourCoverageId} requested for latest bounty.`
    : '.';
  const base = `@aan-tv coverage queue: ${d.queuedCount} event${d.queuedCount === 1 ? '' : 's'} pending${tail} On-chain narration via VaraBridge price feeds.`;
  const body = closer ? `${base} · ${closer}` : base;
  return { body, mentions: ['aan-tv'] };
}
