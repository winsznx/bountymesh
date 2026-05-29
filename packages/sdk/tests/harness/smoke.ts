/**
 * One-off harness smoke check.
 *   tsx tests/harness/smoke.ts
 * Boots (or reuses) a local node, deploys bountymesh, logs programId, tears down.
 * Used once at Phase B close to confirm the harness works end-to-end before
 * the test suite is rewritten against it. Delete after Phase C if not useful.
 */
import { startLocalNode } from './localNode.js';
import { initDevSigners, alice, getApi, disconnectApi } from './devSigners.js';
import { deployBountyMesh } from './deployProgram.js';

async function main(): Promise<void> {
  console.log('[smoke] startLocalNode…');
  const node = await startLocalNode();
  console.log(`[smoke] node ready (reused=${node.reused})`);

  console.log('[smoke] initDevSigners…');
  await initDevSigners();

  console.log('[smoke] getApi…');
  const api = await getApi();
  console.log(`[smoke] api connected at ${api.provider.endpoint ?? 'ws://127.0.0.1:9944'}`);

  console.log('[smoke] deployBountyMesh…');
  const t0 = Date.now();
  const { programId } = await deployBountyMesh(api, alice(), {
    minReward: 1_000_000_000_000n,
    autoSettleBlocks: 100,
  });
  console.log(`[smoke] deployed programId=${programId} (took ${Date.now() - t0}ms)`);

  console.log('[smoke] tearing down…');
  await disconnectApi();
  await node.stop();
  console.log('[smoke] done.');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
