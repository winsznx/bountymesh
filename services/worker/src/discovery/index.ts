/**
 * Discovery orchestrator — boot stages B-2 through B-7 of the worker.
 *
 * Sequence (per P2 §1 boot race fix):
 *   B-2: open SDK live subscription (BootBuffer in 'buffering' state).
 *        Any BountyPosted from now on lands in the buffer.
 *   B-3: probe indexer /health with retry. Fails-fast on acceptance miss
 *        (chain-disconnected / mode-not-live / lag-too-high).
 *   B-4: catch-up query — fetch currently-Open bounties from indexer
 *        GraphQL. Dispatched to consumer in returned order.
 *   B-6: drain BootBuffer with dedup against catch-up IDs, then atomic
 *        flip to 'hot'. Subsequent live pushes dispatch directly.
 *
 * On any failure between B-3 and B-6, the live subscription is torn down
 * before the error propagates — no dangling WS handles.
 */

import type { BountyMeshClient } from '@bountymesh/sdk';
import type { WorkerConfig } from '../config/index.js';
import { BootBuffer } from './buffer.js';
import { fetchOpenBountiesForCatchup } from './catchup.js';
import { probeIndexerHealth } from './health-probe.js';
import { startLiveDiscovery } from './live.js';
import type { CandidateConsumer, DiscoveryHandle } from './types.js';

export interface SetupDiscoveryOptions {
  client: BountyMeshClient;
  config: WorkerConfig;
  chainHeadAtBootStart: number;
  consumer: CandidateConsumer;
}

export async function setupDiscovery(
  opts: SetupDiscoveryOptions,
): Promise<DiscoveryHandle> {
  const buffer = new BootBuffer();
  let dispatched = 0;

  const countingConsumer: CandidateConsumer = async (c) => {
    dispatched++;
    await opts.consumer(c);
  };

  // B-2: open live BEFORE any other boot work. Buffer absorbs events
  // until the atomic flip at the end of B-6.
  const liveUnsub = await startLiveDiscovery(opts.client, buffer);

  try {
    // B-3: indexer health probe (retry transport; immediate-throw on
    // acceptance miss — chain-disconnected / mode-not-live / lag-too-high).
    await probeIndexerHealth({
      indexerBaseUrl: opts.config.indexerBaseUrl,
      chainHeadAtBootStart: opts.chainHeadAtBootStart,
      maxLagBlocks: opts.config.indexerHealthMaxLagBlocks,
    });

    // B-4: catch-up query. Single page, no pagination (overflow throws).
    const catchupCandidates = await fetchOpenBountiesForCatchup({
      indexerBaseUrl: opts.config.indexerBaseUrl,
    });

    // Dispatch catch-up candidates in the order returned by the indexer.
    for (const c of catchupCandidates) {
      await countingConsumer(c);
    }

    // B-6: drain buffer with dedup against catch-up IDs, atomic flip to hot.
    const dedupIds = new Set(catchupCandidates.map((c) => c.id));
    await buffer.drainAndGoHot(countingConsumer, dedupIds);
  } catch (err) {
    // Tear down the live subscription before propagating.
    try {
      liveUnsub();
    } catch {
      /* defensive */
    }
    throw err;
  }

  return {
    unsub: async () => {
      liveUnsub();
    },
    candidatesDispatched: () => dispatched,
  };
}
