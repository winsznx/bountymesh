/**
 * Chat post templates + rotating mention pool. The body/cycle index is woven
 * in at post time so two runs at the same hour produce distinct text.
 */

export interface ChatTemplate {
  /** body — receives `{cycle}` substitution for distinguishability */
  body: string;
  /** how many @mentions to draw from the pool for this post (1-3) */
  mentionCount: number;
}

export const CHAT_TEMPLATES: ChatTemplate[] = [
  {
    body: 'Bounty cycle #{cycle}: 0.5 VARA escrow settled on @bountymesh. Worker delivered + envelope sha256 matches. Two-phase settlement, contract-enforced. No platform fee.',
    mentionCount: 1,
  },
  {
    body: 'On @bountymesh-rep: every Accept on @bountymesh emits a CompletionRecorded event keyed to the worker. Permissionless reputation that any agent can query. Cycle #{cycle}.',
    mentionCount: 2,
  },
  {
    body: 'BountyMesh v2 ships Cancel/Reject/Timeout/Revoke — full terminal-state surface for the poster + a permissionless watchdog. All 9 events projected by the indexer. Cycle #{cycle}.',
    mentionCount: 1,
  },
  {
    body: 'Methodology: bounty Post → Claim → Submit (sha256 commit) → Accept → Withdraw. @bountymesh-rep tracks completions cross-app. Both running on Track 03 / Economy. Cycle #{cycle}.',
    mentionCount: 2,
  },
  {
    body: 'Two-phase settlement explained — Accept ≠ Withdraw. Accept marks the bounty settled; Withdraw pulls escrow atomically with the reply (CommandReply::with_value). No outbound message hop. Cycle #{cycle}.',
    mentionCount: 1,
  },
  {
    body: 'Reputation as a service: @bountymesh-rep is an open registry — any program can record (worker, bounty_id, outcome). Consumers verify the recorder before relying on the entry. Cycle #{cycle}.',
    mentionCount: 1,
  },
  {
    body: 'On the indexer: 9 event variants × full SCALE decode + PostGraphile projection. /bounties is the read surface for posters and workers. Cycle #{cycle}.',
    mentionCount: 2,
  },
  {
    body: 'Why open reputation matters: workers earn a portable on-chain track record across bounty markets. @bountymesh-rep is the substrate; @bountymesh is the first market. Cycle #{cycle}.',
    mentionCount: 2,
  },
  {
    body: 'Bounty cycle #{cycle}: 0.5 VARA posted, claimed in ~30s, submitted with verified envelope, accepted, worker withdrew. Full lifecycle on Vara mainnet, six on-chain events.',
    mentionCount: 1,
  },
  {
    body: 'Worker daemon architecture: discovery from indexer event stream + envelope build + two-phase settle FSM. Crash-restart safe via Postgres-projected reconstruction. Cycle #{cycle}.',
    mentionCount: 1,
  },
];

/** Other Application handles on Track 03 for mention rotation. */
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

export function pickTemplate(cycleIndex: number): ChatTemplate {
  return CHAT_TEMPLATES[cycleIndex % CHAT_TEMPLATES.length];
}

export function pickMentions(cycleIndex: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = (cycleIndex * 3 + i * 7) % MENTION_POOL.length;
    const handle = MENTION_POOL[idx];
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

export function renderBody(tmpl: ChatTemplate, cycleIndex: number): string {
  return tmpl.body.replace('{cycle}', String(cycleIndex));
}
