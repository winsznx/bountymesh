import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { BountyMeshClient } from '../src/client.js';
import { startLocalNode, type LocalNodeHandle } from './harness/localNode.js';
import { alice, balanceOf, bob, charlie, disconnectApi, fund, getApi, initDevSigners } from './harness/devSigners.js';
import { deployBountyMesh } from './harness/deployProgram.js';
import { captureProgramEvents, rawPayloadToBytes } from './harness/captureEvents.js';
import type { SailsProgram } from '../src/generated/lib.js';

let node: LocalNodeHandle;
let api: GearApi;
let programId: HexString;
let program: SailsProgram;
const MIN_REWARD = 1_000_000_000_000n;

const HEX_32_BYTE = /^0x[0-9a-fA-F]{64}$/;

describe('decoding — real chain', () => {
  beforeAll(async () => {
    node = await startLocalNode();
    await initDevSigners();
    api = await getApi();
    ({ programId, program } = await deployBountyMesh(api, alice(), {
      minReward: MIN_REWARD,
      autoSettleBlocks: 100,
    }));
    // `gear --dev` pre-funds //Alice + //Bob only; fund //Charlie from Alice
    // so three-party tests (second-claimer, imposter-submitter) can pay fees.
    await fund(alice(), charlie().address, 10_000_000_000_000n);
  }, 60_000);

  afterAll(async () => {
    await disconnectApi();
    await node?.stop();
  });

  test('post Ok: real Ok(bountyId) → TxResult { ok: true, value.bountyId: bigint }', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const result = await client.post({
      title: 'dec-ok',
      description: 'd',
      acceptance: 'a',
      reward: 2_000_000_000_000n,
      track: 'Economy',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.bountyId).toBe('bigint');
    expect(result.value.bountyId).toBeGreaterThanOrEqual(0n);
    expect(result.txHash).toMatch(HEX_32_BYTE);
    expect(result.blockHash).toMatch(HEX_32_BYTE);
  });

  test('post Err: reward below min_reward → TxResult { ok: false, error: "RewardBelowMinimum" }', async () => {
    const client = new BountyMeshClient({ api, programId, signer: alice() });
    const result = await client.post({
      title: 'dec-err',
      description: 'd',
      acceptance: 'a',
      reward: MIN_REWARD - 1n,
      track: 'Services',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('RewardBelowMinimum');
    expect(result.txHash).toMatch(HEX_32_BYTE);
    expect(result.blockHash).toMatch(HEX_32_BYTE);
  });

  test('claim Ok: bob claims a bounty alice posted → TxResult { ok: true, value: null }', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });

    const posted = await poster.post({
      title: 'dec-claim-ok',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Social',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const result = await worker.claim(posted.value.bountyId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
    expect(result.txHash).toMatch(HEX_32_BYTE);
    expect(result.blockHash).toMatch(HEX_32_BYTE);
  });

  test('claim Err: second claim of the same bounty → TxResult { ok: false, error: "BountyNotOpen" }', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker1 = new BountyMeshClient({ api, programId, signer: bob() });
    const worker2 = new BountyMeshClient({ api, programId, signer: charlie() });

    const posted = await poster.post({
      title: 'dec-claim-err',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Open',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const first = await worker1.claim(posted.value.bountyId);
    expect(first.ok).toBe(true);

    const second = await worker2.claim(posted.value.bountyId);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('BountyNotOpen');
  });

  test('submit Ok: worker submits after claim → TxResult { ok: true, value: null }', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });

    const posted = await poster.post({
      title: 'dec-submit-ok',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Economy',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const claimRes = await worker.claim(posted.value.bountyId);
    expect(claimRes.ok).toBe(true);

    const hash = `0x${'cd'.repeat(32)}` as `0x${string}`;
    const result = await worker.submit(posted.value.bountyId, 'result', hash);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
    expect(result.txHash).toMatch(HEX_32_BYTE);
  });

  test('submit Err: non-worker tries to submit → TxResult { ok: false, error: "Unauthorized" }', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });
    const imposter = new BountyMeshClient({ api, programId, signer: charlie() });

    const posted = await poster.post({
      title: 'dec-submit-err',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Services',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const claimRes = await worker.claim(posted.value.bountyId);
    expect(claimRes.ok).toBe(true);

    const hash = `0x${'ef'.repeat(32)}` as `0x${string}`;
    const result = await imposter.submit(posted.value.bountyId, 'result', hash);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Unauthorized');
  });

  test('accept Ok: poster accepts after worker submits → TxResult { ok: true, value: null } + BountyAccepted event', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });

    const reward = 2_000_000_000_000n;
    const posted = await poster.post({
      title: 'dec-accept-ok',
      description: 'd',
      acceptance: 'a',
      reward,
      track: 'Economy',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    expect((await worker.claim(bountyId)).ok).toBe(true);
    expect((await worker.submit(bountyId, 'work-product', `0x${'ab'.repeat(32)}` as `0x${string}`)).ok).toBe(true);

    const { result, events } = await captureProgramEvents(api, programId, () =>
      poster.accept(bountyId),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
    expect(result.txHash).toMatch(HEX_32_BYTE);
    expect(result.blockHash).toMatch(HEX_32_BYTE);

    const accepted = events.filter((e) => e.eventName === 'BountyAccepted');
    expect(accepted.length).toBe(1);

    const decoded = program.registry.createType(
      '(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})',
      rawPayloadToBytes(accepted[0].rawPayload),
    );
    const eventData = (decoded as unknown as { toJSON: () => [string, string, { id: string | number; poster: string; worker: string; reward: string | number; settled_at: number }] }).toJSON()[2];

    expect(BigInt(eventData.id)).toBe(bountyId);
    expect(eventData.poster).toBe(`0x${Buffer.from(alice().publicKey).toString('hex')}`);
    expect(eventData.worker).toBe(`0x${Buffer.from(bob().publicKey).toString('hex')}`);
    expect(BigInt(eventData.reward)).toBe(reward);
    expect(eventData.settled_at).toBeGreaterThanOrEqual(0);
  });

  test('accept Err: non-poster tries to accept → Unauthorized; state unchanged (proof-by-recovery)', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });
    const imposter = new BountyMeshClient({ api, programId, signer: charlie() });

    const posted = await poster.post({
      title: 'dec-accept-err',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Open',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    expect((await worker.claim(bountyId)).ok).toBe(true);
    expect((await worker.submit(bountyId, 'work', `0x${'cd'.repeat(32)}` as `0x${string}`)).ok).toBe(true);

    // Charlie (non-poster) tries to accept — chain returns Err(Unauthorized).
    const badAccept = await imposter.accept(bountyId);
    expect(badAccept.ok).toBe(false);
    if (badAccept.ok) return;
    expect(badAccept.error).toBe('Unauthorized');

    // Proof-by-recovery: if charlie's failed accept had somehow mutated state,
    // alice's legitimate accept would now error BountyNotSubmitted. Asserting
    // it still succeeds proves state is still Submitted (unchanged).
    const recoveryAccept = await poster.accept(bountyId);
    expect(recoveryAccept.ok).toBe(true);
  });

  test('withdraw Ok — FULL CYCLE BALANCE PROOF (escrow-neutral end state on real chain)', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });
    const reward = 2_000_000_000_000n; // 2 VARA
    const ONE_VARA = 1_000_000_000_000n;

    // === Step 0: Baseline (before any tx in this test) ===
    const programBaseline = await balanceOf(api, programId);
    const aliceBaseline = await balanceOf(api, alice().address);
    const bobBaseline = await balanceOf(api, bob().address);

    // === Step 1: Post (alice locks `reward` into program escrow) ===
    const posted = await poster.post({
      title: 'full-cycle',
      description: 'd',
      acceptance: 'a',
      reward,
      track: 'Economy',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    expect(await balanceOf(api, programId)).toBe(programBaseline + reward);
    const aliceAfterPost = await balanceOf(api, alice().address);
    const aliceDelta = aliceBaseline - aliceAfterPost;
    expect(aliceDelta).toBeGreaterThanOrEqual(reward);
    expect(aliceDelta).toBeLessThan(reward + ONE_VARA); // gas dust < 1 VARA

    // === Step 2: Claim (bob; state-only — escrow unchanged, bob pays only gas) ===
    expect((await worker.claim(bountyId)).ok).toBe(true);
    expect(await balanceOf(api, programId)).toBe(programBaseline + reward);
    const bobAfterClaim = await balanceOf(api, bob().address);
    expect(bobBaseline - bobAfterClaim).toBeLessThan(ONE_VARA);

    // === Step 3: Submit (bob; state-only — escrow unchanged) ===
    expect(
      (await worker.submit(bountyId, 'result', `0x${'ab'.repeat(32)}` as `0x${string}`)).ok,
    ).toBe(true);
    expect(await balanceOf(api, programId)).toBe(programBaseline + reward);

    // === Step 4: Accept (alice; state-flip-only per §5.2 — escrow unchanged) ===
    expect((await poster.accept(bountyId)).ok).toBe(true);
    expect(await balanceOf(api, programId)).toBe(programBaseline + reward);

    // === Step 5: Withdraw (bob pulls reward via CommandReply::with_value per §8) ===
    const withdrawRes = await worker.withdraw(bountyId);
    expect(withdrawRes.ok).toBe(true);

    // Escrow-neutral end state: program balance returns to its baseline.
    expect(await balanceOf(api, programId)).toBe(programBaseline);

    // Worker net delta = +reward (minus gas dust on claim + submit + withdraw).
    const bobFinal = await balanceOf(api, bob().address);
    const bobDelta = bobFinal - bobBaseline;
    expect(bobDelta).toBeGreaterThan(reward - ONE_VARA);
    expect(bobDelta).toBeLessThanOrEqual(reward);
  });

  test('withdraw Err idempotent: second withdraw → AlreadyWithdrawn, no double-payment', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });
    const ONE_VARA = 1_000_000_000_000n;

    const posted = await poster.post({
      title: 'dec-withdraw-idem',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Services',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    expect((await worker.claim(bountyId)).ok).toBe(true);
    expect(
      (await worker.submit(bountyId, 'r', `0x${'aa'.repeat(32)}` as `0x${string}`)).ok,
    ).toBe(true);
    expect((await poster.accept(bountyId)).ok).toBe(true);
    expect((await worker.withdraw(bountyId)).ok).toBe(true); // first: Ok

    const programBefore = await balanceOf(api, programId);
    const bobBefore = await balanceOf(api, bob().address);

    const second = await worker.withdraw(bountyId);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('AlreadyWithdrawn');

    // No double-payment: program escrow unchanged, bob loses only gas dust.
    expect(await balanceOf(api, programId)).toBe(programBefore);
    const bobAfter = await balanceOf(api, bob().address);
    expect(bobBefore - bobAfter).toBeLessThan(ONE_VARA);
  });

  test('withdraw Err: non-worker tries to withdraw → Unauthorized; bob still recovers reward', async () => {
    const poster = new BountyMeshClient({ api, programId, signer: alice() });
    const worker = new BountyMeshClient({ api, programId, signer: bob() });
    const imposter = new BountyMeshClient({ api, programId, signer: charlie() });

    const posted = await poster.post({
      title: 'dec-withdraw-unauth',
      description: 'd',
      acceptance: 'a',
      reward: 1_500_000_000_000n,
      track: 'Open',
    });
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const bountyId = posted.value.bountyId;

    expect((await worker.claim(bountyId)).ok).toBe(true);
    expect(
      (await worker.submit(bountyId, 'r', `0x${'bb'.repeat(32)}` as `0x${string}`)).ok,
    ).toBe(true);
    expect((await poster.accept(bountyId)).ok).toBe(true);

    const badWithdraw = await imposter.withdraw(bountyId);
    expect(badWithdraw.ok).toBe(false);
    if (badWithdraw.ok) return;
    expect(badWithdraw.error).toBe('Unauthorized');

    // Proof-by-recovery: bob's legitimate withdraw must still succeed.
    const recovery = await worker.withdraw(bountyId);
    expect(recovery.ok).toBe(true);
  });
});
