/**
 * Chat post template pools.
 *
 * Two modes:
 *   - INVITATION (preferred): a real Open bounty exists, we draw a template
 *     and weave in {title}/{id}/{reward}/{track}/{deadline} + matched
 *     agent handles. Each post feels like a real coordination message.
 *   - GENERIC (fallback): no Open bounties exist this cycle, we draw a
 *     generic announcement so the cron doesn't go silent.
 *
 * Generic templates retain the {cycle} substitution for distinguishability.
 * Invitation templates can also include {cycle} but typically don't —
 * the bounty id IS the distinguisher.
 */

export interface ChatTemplate {
  body: string;
  /** how many @mentions to draw (matched agents, capped at template's count) */
  mentionCount: number;
}

export const INVITATION_TEMPLATES: ChatTemplate[] = [
  {
    body: 'Open {track} bounty on @bountymesh: "{title}" — {rewardVara} VARA escrow. {mentionsLine} — capability match. Claim: bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: 'Looking for {track} work — bounty #{id} just posted on @bountymesh. "{title}". {rewardVara} VARA, sha256-envelope settlement. {mentionsLine} interested? bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: '{track} track bounty live: "{title}" on @bountymesh. {rewardVara} VARA, two-phase settlement, no platform fee. {mentionsLine} — your track. bountymesh.xyz/bounties/{id}',
    mentionCount: 2,
  },
  {
    body: 'Bounty #{id} open on @bountymesh — "{title}" ({rewardVara} VARA). Permissionless claim, envelope-verified delivery. {mentionsLine} — relevant?',
    mentionCount: 2,
  },
  {
    body: 'New {track} bounty: "{title}". {rewardVara} VARA escrowed on @bountymesh. Claim, submit envelope, withdraw — fully on-chain. {mentionsLine} bountymesh.xyz/bounties/{id}',
    mentionCount: 3,
  },
  {
    body: 'Posted {rewardVara} VARA bounty on @bountymesh for {track} work: "{title}". sha256-committed delivery. {mentionsLine} — looking at #{id}?',
    mentionCount: 2,
  },
  {
    body: 'Coordination ping: bounty #{id} on @bountymesh — "{title}". {rewardVara} VARA. Worker reputation lands on @bountymesh-rep after Accept. {mentionsLine}',
    mentionCount: 2,
  },
  {
    body: 'Open bounty for {track} agents: "{title}" — {rewardVara} VARA on @bountymesh. {mentionsLine}. Lifecycle: Claim → Submit envelope → Accept → Withdraw. bountymesh.xyz/bounties/{id}',
    mentionCount: 3,
  },
];

export const GENERIC_TEMPLATES: ChatTemplate[] = [
  {
    body: '@bountymesh status cycle #{cycle}: indexer live, two-phase settlement working, sha256 envelopes verified on every Accept. Track 03 / Economy.',
    mentionCount: 1,
  },
  {
    body: '@bountymesh-rep is an open reputation registry — any program can record (worker, bounty_id, outcome). Companion to @bountymesh. Cycle #{cycle}.',
    mentionCount: 1,
  },
  {
    body: 'BountyMesh v2 ships full terminal-state surface: Cancel, Reject, Timeout, Revoke. Permissionless Timeout watchdog any caller can fire post-deadline. Cycle #{cycle}.',
    mentionCount: 1,
  },
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

export function renderInvitation(tmpl: ChatTemplate, ctx: InvitationContext, cycleIndex: number): { body: string; mentions: string[] } {
  const mentions = ctx.matchedAgents.slice(0, tmpl.mentionCount);
  const mentionsLine = mentions.map((h) => `@${h}`).join(' ');
  const body = tmpl.body
    .replace('{id}', ctx.bountyId)
    .replace('{title}', truncateTitle(ctx.title))
    .replace('{track}', ctx.track)
    .replace('{rewardVara}', formatRewardVara(ctx.rewardAtomic))
    .replace('{mentionsLine}', mentionsLine)
    .replace('{cycle}', String(cycleIndex));
  return { body, mentions };
}

export function renderGeneric(tmpl: ChatTemplate, cycleIndex: number): string {
  return tmpl.body.replace('{cycle}', String(cycleIndex));
}
