import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { BountyMeshClient } from '../src/client.js';
import { startLocalNode, type LocalNodeHandle } from './harness/localNode.js';
import { alice, bob, disconnectApi, getApi, initDevSigners } from './harness/devSigners.js';
import { deployBountyMesh } from './harness/deployProgram.js';
import { captureProgramEvents, rawPayloadToBytes } from './harness/captureEvents.js';
import type { SailsProgram } from '../src/generated/lib.js';

let node: LocalNodeHandle;
let api: GearApi;
let programId: HexString;
let program: SailsProgram;

describe('encoding — real chain', () => {
  beforeAll(async () => {
    node = await startLocalNode();
    await initDevSigners();
    api = await getApi();
    ({ programId, program } = await deployBountyMesh(api, alice(), {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 100,
    }));
  }, 60_000);

  afterAll(async () => {
    await disconnectApi();
    await node?.stop();
  });

  test('post: BountyPosted event payload matches the args we sent', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const reward = 2_000_000_000_000n;

    const { result, events } = await captureProgramEvents(api, programId, () =>
      client.post({
        title: 'enc',
        description: 'd',
        acceptance: 'a',
        reward,
        track: 'Economy',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const posted = events.filter((e) => e.eventName === 'BountyPosted');
    expect(posted.length).toBe(1);

    const decoded = program.registry.createType(
      '(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32"})',
      rawPayloadToBytes(posted[0].rawPayload),
    );
    const eventData = (decoded as unknown as { toJSON: () => [string, string, { id: string | number; poster: string; reward: string | number; track: string; posted_at: number }] }).toJSON()[2];

    expect(BigInt(eventData.id)).toBe(result.value.bountyId);
    expect(BigInt(eventData.reward)).toBe(reward);
    expect(eventData.track).toBe('Economy');
    expect(eventData.poster).toBe(`0x${Buffer.from(alice().publicKey).toString('hex')}`);
    expect(eventData.posted_at).toBeGreaterThanOrEqual(0);
  });

  test('claim: BountyClaimed event payload matches the args we sent', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });

    const posted = await poster.post({
      title: 'enc-claim',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Services',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    const { result, events } = await captureProgramEvents(api, programId, () =>
      worker.claim(bountyId),
    );

    expect(result.ok).toBe(true);

    const claimed = events.filter((e) => e.eventName === 'BountyClaimed');
    expect(claimed.length).toBe(1);

    const decoded = program.registry.createType(
      '(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})',
      rawPayloadToBytes(claimed[0].rawPayload),
    );
    const eventData = (decoded as unknown as { toJSON: () => [string, string, { id: string | number; worker: string; claimed_at: number }] }).toJSON()[2];

    expect(BigInt(eventData.id)).toBe(bountyId);
    expect(eventData.worker).toBe(`0x${Buffer.from(bob().publicKey).toString('hex')}`);
    expect(eventData.claimed_at).toBeGreaterThanOrEqual(0);
  });

  test('submit: BountySubmitted event payload matches the args we sent (incl. result_hash)', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });

    const posted = await poster.post({
      title: 'enc-submit',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Open',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    const claimRes = await worker.claim(bountyId);
    expect(claimRes.ok).toBe(true);

    const resultHash = `0x${'ab'.repeat(32)}` as `0x${string}`;
    const { result, events } = await captureProgramEvents(api, programId, () =>
      worker.submit(bountyId, 'result-payload', resultHash),
    );

    expect(result.ok).toBe(true);

    const submitted = events.filter((e) => e.eventName === 'BountySubmitted');
    expect(submitted.length).toBe(1);

    const decoded = program.registry.createType(
      '(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})',
      rawPayloadToBytes(submitted[0].rawPayload),
    );
    const eventData = (decoded as unknown as { toJSON: () => [string, string, { id: string | number; worker: string; result_hash: string; submitted_at: number }] }).toJSON()[2];

    expect(BigInt(eventData.id)).toBe(bountyId);
    expect(eventData.worker).toBe(`0x${Buffer.from(bob().publicKey).toString('hex')}`);
    expect(eventData.result_hash).toBe(resultHash);
    expect(eventData.submitted_at).toBeGreaterThanOrEqual(0);
  });
});
