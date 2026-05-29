import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { BountyMeshClient } from '../src/client.js';
import { startLocalNode, type LocalNodeHandle } from './harness/localNode.js';
import { alice, bob, disconnectApi, getApi, initDevSigners } from './harness/devSigners.js';
import { deployBountyMesh } from './harness/deployProgram.js';

const ALL_ZERO_HASH = `0x${'00'.repeat(32)}` as `0x${string}`;
const NON_ZERO_HASH = `0x${'00'.repeat(31)}01` as `0x${string}`;

let node: LocalNodeHandle;
let api: GearApi;
let programId: HexString;

describe('BountyMeshClient.submit — pre-validation (client-side, no chain interaction)', () => {
  beforeAll(async () => {
    node = await startLocalNode();
    await initDevSigners();
    api = await getApi();
    ({ programId } = await deployBountyMesh(api, alice(), {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 100,
    }));
  }, 60_000);

  afterAll(async () => {
    await disconnectApi();
    await node?.stop();
  });

  test('rejects all-zero hash with TypeError /zero[- ]?hash/i BEFORE any chain interaction', async () => {
    const client = new BountyMeshClient({ api, programId, signer: bob() });
    const submitSpy = vi.spyOn(client.program.bountyService, 'submit');

    await expect(client.submit(0n, 'payload', ALL_ZERO_HASH)).rejects.toThrow(TypeError);
    await expect(client.submit(0n, 'payload', ALL_ZERO_HASH)).rejects.toThrow(/zero[- ]?hash/i);

    expect(submitSpy).not.toHaveBeenCalled();
  });

  test('accepts a non-zero 32-byte hash and proceeds to chain (bountyService.submit IS called)', async () => {
    const client = new BountyMeshClient({ api, programId, signer: bob() });
    const submitSpy = vi.spyOn(client.program.bountyService, 'submit');

    // Call with a bountyId that doesn't exist — chain returns Err(BountyNotFound).
    // We don't assert the result; we assert pre-validation passed and the spy was hit.
    await client.submit(9999n, 'payload', NON_ZERO_HASH);

    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy).toHaveBeenCalledWith(9999n, 'payload', NON_ZERO_HASH);
  });
});
