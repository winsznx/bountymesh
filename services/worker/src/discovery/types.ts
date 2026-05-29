/**
 * Discovery surface — types shared across live.ts, catchup.ts, buffer.ts,
 * and the consumer (P3.5 filter pipeline).
 *
 * `phase` is observability-only — gets logged in the op vocabulary but
 * NOT filtered on. Same structural rules apply regardless of source.
 */

import type { Track } from '../config/index.js';

export interface Candidate {
  id: bigint;
  poster: `0x${string}`;
  reward: bigint;
  track: Track;
  postedAt: number;
  title: string;
  description: string;
  acceptance: string;
  deadline: number | null;
  // Catchup-sourced candidates carry null blockHash — the bounties projection
  // doesn't include the post-block-hash (only postTxHash). Live-sourced from
  // the SDK carry the actual blockHash. Schema gap: either add post_block_hash
  // column or accept null + log.
  blockHash: `0x${string}` | null;
  txHash: `0x${string}` | null;
  phase: 'live' | 'catchup' | 'resume';
}

export type CandidateConsumer = (c: Candidate) => void | Promise<void>;

export interface DiscoveryHandle {
  unsub: () => Promise<void>;
  candidatesDispatched: () => number;
}
