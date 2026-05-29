/**
 * Manual smoke run — boots the indexer as a SEPARATE child process via
 * `node dist/main.js`, drives a real lifecycle, queries /health + GraphQL,
 * then sends SIGTERM and prints the captured log.
 *
 * Proves the actual binary entry point (main.ts → boot → ... → shutdown)
 * works the same way it would on Railway/Vercel/anywhere it's deployed.
 * Distinct from the in-process orchestrator test (5f.*) which calls boot()
 * directly inside the test runner.
 *
 * Run: cd services/indexer && npx tsx tests/smoke/manual-smoke.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GearApi } from '@gear-js/api';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode } from '../harness/localNode.js';
import { initDevSigners, alice, bob } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import { startPostgres, DEFAULT_WRITER_URL } from '../harness/postgres.js';

const SMOKE_PORT = 4353;
const INDEXER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WS_URL = 'ws://127.0.0.1:9944';

async function pollHealth(timeoutMs: number, expected: 'live'): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${SMOKE_PORT}/health`);
      const j = (await r.json()) as Record<string, unknown>;
      if (j.mode === expected) return j;
    } catch {
      /* indexer not yet listening */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

async function gqlPoll(bid: bigint, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${SMOKE_PORT}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query { bountyById(id: "${bid.toString()}") { id status withdrawn reward } }`,
        }),
      });
      const j = (await r.json()) as { data?: { bountyById?: { withdrawn?: boolean } } };
      if (j.data?.bountyById?.withdrawn === true) {
        return j as unknown as Record<string, unknown>;
      }
    } catch {
      /* server may have stopped */
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return null;
}

async function main(): Promise<void> {
  console.log('[smoke] ─── stage 1: postgres + gear node + deploy ───────────');
  const pgH = await startPostgres();
  const nodeH = await startLocalNode();
  const api = await GearApi.create({ providerAddress: WS_URL });
  await api.isReady;
  await initDevSigners();
  const aliceSig = alice();
  const bobSig = bob();
  const deployed = await deployBountyMesh(api, aliceSig, {
    minReward: 1_000_000_000_000n,
    autoSettleBlocks: 50_400,
  });
  const programId = deployed.programId;
  const header = await api.rpc.chain.getHeader();
  const deployBlock = header.number.toNumber();
  console.log(`[smoke] deployed programId=${programId.slice(0, 18)}... deployBlock=${deployBlock}`);

  console.log('[smoke] ─── stage 2: spawn `node dist/main.js` ──────────────');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: DEFAULT_WRITER_URL,
    DATABASE_URL_READER: 'postgres://bountymesh_readonly:readonly@localhost:5432/bountymesh',
    BOUNTYMESH_PROGRAM_ID: programId,
    BOUNTYMESH_START_BLOCK: String(deployBlock),
    VARA_RPC_URL: WS_URL,
    API_PORT: String(SMOKE_PORT),
    LOG_LEVEL: 'info',
    INDEXER_MODE: 'all',
  };
  const child: ChildProcess = spawn('node', ['dist/main.js'], {
    cwd: INDEXER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const indexerLog: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    const s = chunk.toString();
    indexerLog.push(s);
    process.stdout.write('[indexer] ' + s);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const s = chunk.toString();
    indexerLog.push(s);
    process.stderr.write('[indexer ERR] ' + s);
  });

  console.log('[smoke] ─── stage 3: poll /health until mode=live ──────────');
  const healthLive = await pollHealth(60_000, 'live');
  if (!healthLive) {
    child.kill('SIGTERM');
    throw new Error('indexer never reached mode=live within 60s');
  }
  console.log(`[smoke] /health (initial) = ${JSON.stringify(healthLive)}`);

  console.log('[smoke] ─── stage 4: SDK lifecycle (5 calls) ─────────────────');
  const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSig });
  const bobClient = new BountyMeshClient({ api, programId, signer: bobSig });
  const posted = await aliceClient.post({
    title: 'manual smoke bounty',
    description: 'end-to-end binary smoke',
    acceptance: 'graphql shows withdrawn=true',
    reward: 2_000_000_000_000n,
    track: 'Services',
  });
  if (!posted.ok) {
    child.kill('SIGTERM');
    throw new Error(`post failed: ${posted.error}`);
  }
  const bid = posted.value.bountyId;
  console.log(`[smoke] posted bountyId=${bid}`);

  const claim = await bobClient.claim(bid);
  if (!claim.ok) throw new Error('claim failed');
  const submit = await bobClient.submit(bid, 'smoke payload', ('0x' + 'f'.repeat(64)) as `0x${string}`);
  if (!submit.ok) throw new Error('submit failed');
  const accept = await aliceClient.accept(bid);
  if (!accept.ok) throw new Error('accept failed');
  const withdraw = await bobClient.withdraw(bid);
  if (!withdraw.ok) throw new Error('withdraw failed');
  console.log('[smoke] all 5 calls landed');

  console.log('[smoke] ─── stage 5: GraphQL poll for withdrawn=true ───────');
  const gqlResult = await gqlPoll(bid, 180_000);
  if (!gqlResult) {
    child.kill('SIGTERM');
    throw new Error('GraphQL never showed withdrawn=true within 180s');
  }
  console.log(`[smoke] GraphQL bountyById = ${JSON.stringify(gqlResult)}`);

  console.log('[smoke] ─── stage 6: /health (post-lifecycle) ──────────────');
  const healthAfter = await fetch(`http://127.0.0.1:${SMOKE_PORT}/health`).then((r) => r.json());
  console.log(`[smoke] /health (after lifecycle) = ${JSON.stringify(healthAfter)}`);

  console.log('[smoke] ─── stage 7: SIGTERM + wait for clean exit ─────────');
  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? -1));
  });
  child.kill('SIGTERM');
  const exitCode = await exited;
  console.log(`[smoke] indexer exited with code ${exitCode}`);

  console.log('[smoke] ─── stage 8: cleanup ──────────────────────────────');
  await api.disconnect();
  await nodeH.stop();
  await pgH.stop();
  console.log('[smoke] ───── DONE ─────');
}

main().catch((err: unknown) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
