import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { BountyMeshClient } from '../src/client.js';
import type {
  BountyAcceptedEvent,
  BountyClaimedEvent,
  BountyPostedEvent,
} from '../src/types.js';
import { startLocalNode, type LocalNodeHandle } from './harness/localNode.js';
import { alice, bob, disconnectApi, getApi, initDevSigners } from './harness/devSigners.js';
import { deployBountyMesh } from './harness/deployProgram.js';

const ONE_VARA = 1_000_000_000_000n;
const DISPATCH_WAIT_MS = 8_000; // ~2-3 dev-chain blocks to ensure event has flowed through subscribeNewHeads

let node: LocalNodeHandle;
let api: GearApi;
let programId: HexString;

describe('event multiplexer — real chain', () => {
  beforeAll(async () => {
    node = await startLocalNode();
    await initDevSigners();
    api = await getApi();
    ({ programId } = await deployBountyMesh(api, alice(), {
      minReward: ONE_VARA,
      autoSettleBlocks: 100,
    }));
  }, 60_000);

  afterAll(async () => {
    await disconnectApi();
    await node?.stop();
  });

  test('onBountyPosted receives a typed BountyPostedEvent payload from a real on-chain post', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const received: BountyPostedEvent[] = [];
    const unsub = await client.onBountyPosted(null, (e) => {
      received.push(e);
    });

    const reward = 2n * ONE_VARA;
    const posted = await client.post({
      title: 'sdk-decode-fixture-title',
      description: 'sdk-decode-fixture-description',
      acceptance: 'sdk-decode-fixture-acceptance',
      reward,
      // F1 SCALE roundtrip fixture: distinct from gtest's 1_000_000 so any
      // cross-suite contamination surfaces as a wrong-value assertion.
      deadline: 2_000_000,
      track: 'Economy',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    await new Promise((r) => setTimeout(r, DISPATCH_WAIT_MS));
    unsub();

    expect(received.length).toBeGreaterThanOrEqual(1);
    const matched = received.find((e) => e.id === posted.value.bountyId);
    expect(matched).toBeDefined();
    if (!matched) return;
    expect(typeof matched.id).toBe('bigint');
    expect(matched.track).toBe('Economy');
    expect(matched.reward).toBe(reward);
    expect(typeof matched.postedAt).toBe('number');
    expect(matched.poster).toBe(`0x${Buffer.from(alice().publicKey).toString('hex')}`);
    // F1 SCALE roundtrip: the 4 new fields decode back to alice's inputs.
    // Pre-F1 fields (id/track/reward/postedAt/poster) already covered above.
    expect(matched.title).toBe('sdk-decode-fixture-title');
    expect(matched.description).toBe('sdk-decode-fixture-description');
    expect(matched.acceptance).toBe('sdk-decode-fixture-acceptance');
    expect(matched.deadline).toBe(2_000_000);
    expect(matched.blockHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(matched.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  }, 60_000);

  test('track filter narrows dispatch: Open post is suppressed, Economy post fires', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const received: BountyPostedEvent[] = [];
    const unsub = await client.onBountyPosted({ track: 'Economy' }, (e) => {
      received.push(e);
    });

    const openPost = await client.post({
      title: 'mux-2-open',
      description: 'd',
      acceptance: 'a',
      reward: ONE_VARA + ONE_VARA / 2n,
      track: 'Open',
    });
    expect(openPost.ok).toBe(true);

    const economyPost = await client.post({
      title: 'mux-2-eco',
      description: 'd',
      acceptance: 'a',
      reward: ONE_VARA + ONE_VARA / 2n,
      track: 'Economy',
    });
    expect(economyPost.ok).toBe(true);
    if (!economyPost.ok) return;

    await new Promise((r) => setTimeout(r, DISPATCH_WAIT_MS));
    unsub();

    // Only the Economy post should have fired the filtered callback.
    const filteredToTest = received.filter(
      (e) =>
        e.id === economyPost.value.bountyId ||
        (openPost.ok && e.id === openPost.value.bountyId),
    );
    expect(filteredToTest.length).toBe(1);
    expect(filteredToTest[0].track).toBe('Economy');
    expect(filteredToTest[0].id).toBe(economyPost.value.bountyId);
  }, 60_000);

  test('unsubscribe stops dispatch before the event fires', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const received: BountyPostedEvent[] = [];
    const unsub = await client.onBountyPosted(null, (e) => {
      received.push(e);
    });
    unsub(); // immediate

    const posted = await client.post({
      title: 'mux-3',
      description: 'd',
      acceptance: 'a',
      reward: ONE_VARA + ONE_VARA / 2n,
      track: 'Services',
    });
    expect(posted.ok).toBe(true);

    await new Promise((r) => setTimeout(r, DISPATCH_WAIT_MS));

    expect(received.length).toBe(0);
  }, 60_000);

  test('single underlying chain-head subscription regardless of N onBountyX callbacks', async () => {
    // subscribeNewHeads is also called internally by sails-js / @gear-js/api tx tracking
    // (~1 call per signed extrinsic). To isolate the SubscriptionManager's own usage,
    // we snapshot the baseline count and assert the DELTA across the 3 registrations.
    const spy = vi.spyOn(api.rpc.chain, 'subscribeNewHeads');

    try {
      const poster = new BountyMeshClient({ api, programId, signer: alice() });
      const worker = new BountyMeshClient({ api, programId, signer: bob() });

      const posted: BountyPostedEvent[] = [];
      const claimed: BountyClaimedEvent[] = [];
      const accepted: BountyAcceptedEvent[] = [];

      const baselineCalls = spy.mock.calls.length;

      // Three independent subscriptions on the SAME client instance (poster).
      // Per design: ONE underlying subscribeNewHeads call total across all three.
      const u1 = await poster.onBountyPosted(null, (e) => {
        posted.push(e);
      });
      const u2 = await poster.onBountyClaimed(null, (e) => {
        claimed.push(e);
      });
      const u3 = await poster.onBountyAccepted(null, (e) => {
        accepted.push(e);
      });

      // Load-bearing: 3 registrations → 1 underlying subscription (delta = 1).
      expect(spy.mock.calls.length - baselineCalls).toBe(1);

      // Drive a full happy-path slice through the chain. Each tx triggers its
      // own subscribeNewHeads (sails-js finalization tracking) — those don't
      // count against our SubscriptionManager's invariant.
      const post = await poster.post({
        title: 'mux-4',
        description: 'd',
        acceptance: 'a',
        reward: 2n * ONE_VARA,
        track: 'Economy',
      });
      expect(post.ok).toBe(true);
      if (!post.ok) return;

      expect((await worker.claim(post.value.bountyId)).ok).toBe(true);
      expect(
        (await worker.submit(post.value.bountyId, 'r', `0x${'ab'.repeat(32)}` as `0x${string}`)).ok,
      ).toBe(true);
      expect((await poster.accept(post.value.bountyId)).ok).toBe(true);

      await new Promise((r) => setTimeout(r, DISPATCH_WAIT_MS));

      u1();
      u2();
      u3();

      // All 3 event types dispatched through the single underlying subscription.
      expect(posted.find((e) => e.id === post.value.bountyId)).toBeDefined();
      expect(claimed.find((e) => e.id === post.value.bountyId)).toBeDefined();
      expect(accepted.find((e) => e.id === post.value.bountyId)).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  }, 90_000);
});
