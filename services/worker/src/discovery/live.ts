/**
 * Live-channel adapter: SDK onBountyPosted → BootBuffer.push.
 *
 * Boot stage B-2: this opens BEFORE the indexer probe + catch-up so any
 * BountyPosted events arriving during the boot window land in the buffer
 * rather than getting silently dropped (P2 §1 boot race fix).
 */

import type { BountyMeshClient, BountyPostedEvent, Unsubscribe } from '@bountymesh/sdk';
import type { BootBuffer } from './buffer.js';
import type { Candidate } from './types.js';

export async function startLiveDiscovery(
  client: BountyMeshClient,
  buffer: BootBuffer,
): Promise<Unsubscribe> {
  return client.onBountyPosted(null, (e: BountyPostedEvent) => {
    const candidate: Candidate = {
      id: e.id,
      poster: e.poster,
      reward: e.reward,
      track: e.track,
      postedAt: e.postedAt,
      title: e.title,
      description: e.description,
      acceptance: e.acceptance,
      deadline: e.deadline,
      blockHash: e.blockHash,
      txHash: e.txHash,
      phase: 'live',
    };
    buffer.push(candidate);
  });
}
