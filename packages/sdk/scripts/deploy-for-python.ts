/**
 * One-off deploy entry point for the Python smoke test.
 *
 * Spawns (or reuses) a local gear --dev --tmp node, deploys bountymesh,
 * prints the programId on stdout as the final line, and exits.
 * Does NOT stop the node — the Python smoke test owns its lifecycle from
 * here and is responsible for teardown.
 *
 * Usage:
 *   npx tsx scripts/deploy-for-python.ts
 *   # → ... logs ... → programId on final line
 */
import { startLocalNode } from '../tests/harness/localNode.js';
import {
  alice,
  disconnectApi,
  getApi,
  initDevSigners,
} from '../tests/harness/devSigners.js';
import { deployBountyMesh } from '../tests/harness/deployProgram.js';

async function main(): Promise<void> {
  await startLocalNode(); // node lifecycle owned by the caller (Python smoke); not stopped here
  await initDevSigners();
  const api = await getApi();
  const { programId } = await deployBountyMesh(api, alice(), {
    minReward: 1_000_000_000_000n,
    autoSettleBlocks: 100,
  });
  await disconnectApi();
  process.stdout.write(`PROGRAM_ID=${programId}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[deploy-for-python] FAILED:', err);
  process.exit(1);
});
