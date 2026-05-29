import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { initDevSigners, alice } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  openSubscriptions,
  type CanonicalEventsHandler,
} from '../../src/chain/subscriptions.js';
import { createProgramRegistry } from '../../src/chain/decode.js';
import { PendingBuffer, type BufferedEvent } from '../../src/chain/buffer.js';

const silent = pino({ level: 'silent' });

/**
 * Real-chain integration test for the chain plumbing.
 *
 * Boot fresh gear --dev --tmp, deploy bountymesh, open subscriptions,
 * post a bounty via the SDK, then wait for finality and verify the event
 * was buffered AND dispatched to the canonical-events handler.
 *
 * Finality on gear --dev: ~6s/block × 2 blocks ≈ 12s. The 60s timeout is
 * a generous ceiling that covers cold-start + network jitter.
 */

describe('chain/subscriptions.ts (real chain + deployed program)', () => {
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let aliceSigner: KeyringPair;

  before(async () => {
    node = await startLocalNode();
    api = await GearApi.create({ providerAddress: WS_URL });
    await api.isReady;
    await initDevSigners();
    aliceSigner = alice();
    const deployed = await deployBountyMesh(api, aliceSigner, {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 50_400,
    });
    programId = deployed.programId;
  });

  after(async () => {
    if (api && api.isConnected) await api.disconnect();
    await node.stop();
  });

  it('SDK post → buffer push → finality → canonical dispatch', async () => {
    const buffer = new PendingBuffer();
    const captured: Array<{ blockHash: HexString; blockNumber: number; events: BufferedEvent[] }> =
      [];
    let resolveOnce: (() => void) | null = null;
    const dispatched = new Promise<void>((r) => {
      resolveOnce = r;
    });

    const onCanonical: CanonicalEventsHandler = async (blockHash, blockNumber, events) => {
      const hasOurEvent = events.some((e) => e.eventName === 'BountyPosted');
      if (!hasOurEvent) return;
      captured.push({ blockHash, blockNumber, events });
      if (resolveOnce) {
        resolveOnce();
        resolveOnce = null;
      }
    };

    const subs = await openSubscriptions({
      api,
      programId,
      registry: createProgramRegistry(api, programId),
      buffer,
      onCanonicalEvents: onCanonical,
      logger: silent,
    });

    try {
      // SDK client used as the EVENT SOURCE (alice posts a bounty).
      const sdkClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
      const posted = await sdkClient.post({
        title: 'indexer chain plumbing smoke test',
        description: 'verifies buffer push + finalized-head canonical dispatch',
        acceptance: 'no human review needed',
        reward: 2_000_000_000_000n,
        track: 'Services',
      });
      if (!posted.ok) {
        assert.fail(`post must succeed; got error: ${posted.error} (tx ${posted.txHash})`);
      }

      // Wait for finality + canonical-verify → dispatch.
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('timed out waiting for canonical dispatch (60s)')),
          60_000,
        ),
      );
      await Promise.race([dispatched, timeout]);

      assert.equal(captured.length, 1, 'exactly one canonical dispatch with our BountyPosted');
      const cap = captured[0]!;
      const postedEv = cap.events.find((e) => e.eventName === 'BountyPosted');
      assert(postedEv, 'BountyPosted must be in dispatched batch');
      assert.equal(postedEv.eventName, 'BountyPosted');
      if (postedEv.eventName === 'BountyPosted') {
        assert.equal(postedEv.id, posted.value.bountyId);
        assert.equal(postedEv.track, 'Services');
        assert.equal(postedEv.reward, 2_000_000_000_000n);
      }

      // Buffer should be empty for this block after take().
      assert.equal(buffer.peek(cap.blockHash).length, 0, 'buffer drained for our block');
    } finally {
      await subs.close();
    }
  });
});
