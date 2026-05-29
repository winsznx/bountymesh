/**
 * Phase 3 Step 5e integration test — GraphQL surface + /health endpoint.
 *
 * Five tests, all real Postgres + real PostGraphile + real HTTP server.
 *   5e.1  end-to-end lifecycle via chain → ingest → GraphQL query (consumer demo)
 *   5e.2  connection-filter narrowing across track + status filters
 *   5e.3  Relay-style cursor pagination across 25 bounties
 *   5e.4  disableDefaultMutations prevents any write surface from being exposed
 *   5e.5  /health returns the locked JSON contract shape
 *
 * Test order is intentional: 5e.4 + 5e.5 require no specific data and run
 * first. Data-mutating tests (5e.1, 5e.2, 5e.3) use disjoint bounty ID
 * ranges so they don't trample each other.
 */

import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import pg from 'pg';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { TypeRegistry } from '@polkadot/types';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { initDevSigners, alice, bob } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  startPostgres,
  initIndexerState,
  type PostgresHandle,
  DEFAULT_READER_URL,
} from '../harness/postgres.js';
import { backfill } from '../../src/chain/backfill.js';
import { createProgramRegistry } from '../../src/chain/decode.js';
import { startHttpServer, type ServerHandle } from '../../src/graphql/server.js';
import { HealthState } from '../../src/lifecycle/health.js';
import type { IndexerConfig } from '../../src/config.js';
import { bounties } from '../../src/schema.js';

const silent = pino({ level: 'silent' });
const API_PORT = 4351; // distinct from default 4350 to avoid stepping on a dev process

function buildConfig(): IndexerConfig {
  return {
    databaseUrl: 'postgres://bountymesh:bountymesh@localhost:5432/bountymesh',
    databaseUrlReader: DEFAULT_READER_URL,
    vararRpcUrl: WS_URL,
    programId: ('0x' + '0'.repeat(64)) as `0x${string}`,
    startBlock: null,
    apiPort: API_PORT,
    apiCorsOrigin: '*',
    logLevel: 'silent',
    mode: 'all',
    backfillBatchSize: 50,
    finalityCheckIntervalMs: 6000,
  };
}

async function gqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data?: T; errors?: Array<{ message: string }> }>;
}

async function getFinalizedBlockNumber(api: GearApi): Promise<number> {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  return header.number.toNumber();
}

async function waitForFinalizedAtLeast(api: GearApi, target: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getFinalizedBlockNumber(api);
    if (current >= target) return current;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`waitForFinalizedAtLeast: chain did not reach ${target} within ${timeoutMs}ms`);
}

describe('Phase 3 — graphql + /health (real chain + real postgres + real HTTP)', () => {
  let pgHandle: PostgresHandle;
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let registry: TypeRegistry;
  let writerPool: pg.Pool;
  let readerPool: pg.Pool;
  let writerDb: NodePgDatabase;
  let aliceSigner: KeyringPair;
  let bobSigner: KeyringPair;
  let deployBlock: number;
  let server: ServerHandle;
  let health: HealthState;

  before(async () => {
    pgHandle = await startPostgres();
    node = await startLocalNode();
    api = await GearApi.create({ providerAddress: WS_URL });
    await api.isReady;
    await initDevSigners();
    aliceSigner = alice();
    bobSigner = bob();

    const deployed = await deployBountyMesh(api, aliceSigner, {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 50_400,
    });
    programId = deployed.programId;
    deployBlock = await getFinalizedBlockNumber(api);
    await initIndexerState(pgHandle.writerUrl, programId, deployBlock);

    writerPool = new pg.Pool({ connectionString: pgHandle.writerUrl, max: 2 });
    readerPool = new pg.Pool({ connectionString: pgHandle.readerUrl, max: 4 });
    writerDb = drizzle(writerPool);
    registry = createProgramRegistry(api, programId);

    health = new HealthState();
    health.setChainStatus('connected');
    health.setMode('live');
    health.setLastFinalizedBlock(deployBlock);
    health.setHeadBlock(deployBlock);

    const config = buildConfig();
    server = startHttpServer({
      config,
      readerPool,
      writerPool,
      writerDb,
      healthState: health,
      logger: silent,
    });
  });

  after(async () => {
    if (server) await server.close();
    if (api && api.isConnected) await api.disconnect();
    if (node) await node.stop();
    if (readerPool) await readerPool.end();
    if (writerPool) await writerPool.end();
    if (pgHandle) await pgHandle.stop();
  });

  it('5e.4 — disableDefaultMutations: mutation surface absent from schema', async () => {
    // Probe the introspection schema for any Mutation root field.
    const intro = await gqlQuery<{ __schema: { mutationType: { name: string } | null } }>(`
      query { __schema { mutationType { name } } }
    `);
    // Either mutationType is null (no mutations registered) OR mutationType
    // exists but exposes ZERO fields (empty schema). PostGraphile 4 may
    // return a mutation root that just contains no fields. Both are acceptable
    // proof that consumers can't write.
    if (intro.data?.__schema.mutationType !== null) {
      // Walk the mutation root and confirm no fields are exposed.
      const fields = await gqlQuery<{ __type: { fields: Array<{ name: string }> | null } }>(`
        query { __type(name: "Mutation") { fields { name } } }
      `);
      const fieldNames = fields.data?.__type?.fields?.map((f) => f.name) ?? [];
      assert.equal(
        fieldNames.length,
        0,
        `mutation root should have zero fields; got: ${fieldNames.join(', ')}`,
      );
    }

    // Also probe internal tables — must NOT appear as types.
    const types = await gqlQuery<{ __schema: { types: Array<{ name: string }> } }>(`
      query { __schema { types { name } } }
    `);
    const typeNames = new Set(types.data?.__schema.types.map((t) => t.name) ?? []);
    assert.ok(typeNames.size > 0, 'introspection returned some types');
    assert.ok(!typeNames.has('IndexerState'), 'indexer_state must not appear in schema');
    assert.ok(!typeNames.has('ParseError'), 'parse_errors must not appear in schema');
    // Sanity: domain tables ARE in the schema.
    assert.ok(typeNames.has('Bounty'), 'bounties must appear in schema');
    assert.ok(typeNames.has('BountyEvent'), 'bounty_events must appear in schema');
  });

  it('5e.5 — /health returns the locked JSON contract shape', async () => {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
    assert.equal(res.status, 200, '/health returns 200 when state is ok');
    const body = (await res.json()) as Record<string, unknown>;
    // Locked shape (Step 3 senior review concern #6)
    const expected = ['status', 'db', 'chain', 'mode', 'lastFinalizedBlock', 'headBlock', 'lagFromHead', 'wsReconnects1h', 'parseErrors1h', 'uptime'];
    for (const key of expected) {
      assert.ok(key in body, `field missing: ${key}`);
    }
    assert.equal(body.db, 'ok');
    assert.equal(body.chain, 'connected');
    assert.equal(body.mode, 'live');
    assert.equal(typeof body.lastFinalizedBlock, 'number');
    assert.ok((body.lastFinalizedBlock as number) > 0);
    assert.equal(typeof body.headBlock, 'number');
    assert.equal(typeof body.lagFromHead, 'number');
    assert.equal(typeof body.wsReconnects1h, 'number');
    assert.equal(typeof body.parseErrors1h, 'number');
    assert.equal(body.parseErrors1h, 0);
    assert.equal(body.wsReconnects1h, 0);
    assert.match(body.uptime as string, /^\d{2}:\d{2}:\d{2}$/);
    assert.equal(body.status, 'ok');
  });

  it('5e.1 — end-to-end lifecycle visible via GraphQL', async () => {
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const bobClient = new BountyMeshClient({ api, programId, signer: bobSigner });

    const posted = await aliceClient.post({
      title: '5e.1 graphql',
      description: 'end-to-end visibility',
      acceptance: 'criteria',
      reward: 4_000_000_000_000n,
      track: 'Open',
    });
    assert.ok(posted.ok);
    const bid = posted.ok ? posted.value.bountyId : 0n;

    const claim = await bobClient.claim(bid);
    assert.ok(claim.ok);
    const sha256 = ('0x' + 'd'.repeat(64)) as `0x${string}`;
    const submit = await bobClient.submit(bid, '5e.1 payload', sha256);
    assert.ok(submit.ok);
    const accept = await aliceClient.accept(bid);
    assert.ok(accept.ok);
    const withdraw = await bobClient.withdraw(bid);
    assert.ok(withdraw.ok);
    if (!withdraw.ok) throw new Error('withdraw must succeed');

    const withdrawHeader = await api.rpc.chain.getHeader(withdraw.blockHash);
    const lastEventBlock = withdrawHeader.number.toNumber();
    const finalizedAtLeast = await waitForFinalizedAtLeast(api, lastEventBlock, 180_000);

    // Ingest via backfill (no live subscriptions running in this test).
    await backfill(
      { db: writerDb, api, programId, registry, logger: silent, batchSize: 50 },
      deployBlock,
      finalizedAtLeast,
    );

    // Query via GraphQL.
    interface BountyGql {
      id: string;
      status: string;
      withdrawn: boolean;
      reward: string;
      track: string;
      poster: string;
      worker: string | null;
      resultHash: string | null;
      postTxHash: string | null;
      claimTxHash: string | null;
      submitTxHash: string | null;
      acceptTxHash: string | null;
      withdrawTxHash: string | null;
    }
    const result = await gqlQuery<{ bountyById: BountyGql }>(
      `query Q($id: BigInt!) {
        bountyById(id: $id) {
          id status withdrawn reward track poster worker resultHash
          postTxHash claimTxHash submitTxHash acceptTxHash withdrawTxHash
        }
      }`,
      { id: bid.toString() },
    );
    assert.deepEqual(result.errors, undefined, `query errors: ${JSON.stringify(result.errors)}`);
    const b = result.data?.bountyById;
    assert.ok(b, 'bountyById must return the bounty');
    if (!b) throw new Error('bounty missing');
    assert.equal(b.status, 'Accepted');
    assert.equal(b.withdrawn, true);
    assert.equal(b.reward, '4000000000000');
    assert.equal(b.track, 'Open');
    assert.match(b.poster, /^0x[0-9a-f]{64}$/);
    assert.match(b.worker ?? '', /^0x[0-9a-f]{64}$/);
    assert.equal(b.resultHash, sha256);
    for (const tx of [b.postTxHash, b.claimTxHash, b.submitTxHash, b.acceptTxHash, b.withdrawTxHash]) {
      assert.match(tx ?? '', /^0x[0-9a-f]{64}$/);
    }
  });

  it('5e.2 — connection-filter plugin narrows by track + status', async () => {
    // Three bounties with disjoint IDs (1000+) so we don't collide with 5e.1's
    // bountyId (chain-assigned, starts from 1).
    const tracks: Array<{ id: number; track: string }> = [
      { id: 1000, track: 'Economy' },
      { id: 1001, track: 'Open' },
      { id: 1002, track: 'Services' },
    ];
    for (const t of tracks) {
      await writerDb.insert(bounties).values({
        id: t.id,
        poster: ('0x' + 'aa'.repeat(32)) as HexString,
        worker: null,
        reward: '1000000000000',
        track: t.track,
        status: 'Open',
        postedAt: 1,
        claimedAt: null,
        submittedAt: null,
        acceptedAt: null,
        withdrawnAt: null,
        withdrawn: false,
        resultHash: null,
        postTxHash: null,
        claimTxHash: null,
        submitTxHash: null,
        acceptTxHash: null,
        withdrawTxHash: null,
        lastEventBlock: 1,
        title: null,
        description: null,
        acceptance: null,
      });
    }

    interface NodeShape { id: string; track: string; status: string }
    const economy = await gqlQuery<{ allBounties: { nodes: NodeShape[] } }>(
      `query { allBounties(filter: { track: { equalTo: "Economy" } }) { nodes { id track status } } }`,
    );
    assert.deepEqual(economy.errors, undefined, JSON.stringify(economy.errors));
    const economyNodes = economy.data?.allBounties.nodes ?? [];
    assert.ok(economyNodes.length >= 1, 'at least one Economy bounty');
    assert.ok(economyNodes.every((n) => n.track === 'Economy'), 'filter is strict');

    const openStatus = await gqlQuery<{ allBounties: { nodes: NodeShape[] } }>(
      `query { allBounties(filter: { status: { equalTo: "Open" }, track: { equalTo: "Open" } }) { nodes { id track status } } }`,
    );
    assert.deepEqual(openStatus.errors, undefined, JSON.stringify(openStatus.errors));
    const openNodes = openStatus.data?.allBounties.nodes ?? [];
    assert.ok(openNodes.length >= 1);
    assert.ok(openNodes.every((n) => n.status === 'Open' && n.track === 'Open'), 'compound filter narrows');
  });

  it('5e.3 — Relay cursor pagination across 25 inserted bounties', async () => {
    // Insert 25 with disjoint IDs (2000-2024). Track them with a unique poster
    // so we can isolate from 5e.1 + 5e.2 in the pagination query.
    const pagePoster = ('0x' + 'bb'.repeat(32)) as HexString;
    for (let i = 0; i < 25; i += 1) {
      await writerDb.insert(bounties).values({
        id: 2000 + i,
        poster: pagePoster,
        worker: null,
        reward: ((BigInt(i) + 1n) * 1_000_000_000_000n).toString(),
        track: 'Social',
        status: 'Open',
        postedAt: i + 1,
        claimedAt: null,
        submittedAt: null,
        acceptedAt: null,
        withdrawnAt: null,
        withdrawn: false,
        resultHash: null,
        postTxHash: null,
        claimTxHash: null,
        submitTxHash: null,
        acceptTxHash: null,
        withdrawTxHash: null,
        lastEventBlock: i + 1,
        title: null,
        description: null,
        acceptance: null,
      });
    }

    interface Page {
      nodes: Array<{ id: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    }
    const page1 = await gqlQuery<{ allBounties: Page }>(
      `query { allBounties(first: 10, filter: { poster: { equalTo: "${pagePoster}" } }) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      } }`,
    );
    assert.deepEqual(page1.errors, undefined, JSON.stringify(page1.errors));
    assert.equal(page1.data?.allBounties.nodes.length, 10);
    assert.equal(page1.data?.allBounties.pageInfo.hasNextPage, true);
    const cursor1 = page1.data?.allBounties.pageInfo.endCursor ?? '';
    assert.ok(cursor1.length > 0);

    const page2 = await gqlQuery<{ allBounties: Page }>(
      `query { allBounties(first: 10, after: "${cursor1}", filter: { poster: { equalTo: "${pagePoster}" } }) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      } }`,
    );
    assert.equal(page2.data?.allBounties.nodes.length, 10);
    assert.equal(page2.data?.allBounties.pageInfo.hasNextPage, true);

    const cursor2 = page2.data?.allBounties.pageInfo.endCursor ?? '';
    const page3 = await gqlQuery<{ allBounties: Page }>(
      `query { allBounties(first: 10, after: "${cursor2}", filter: { poster: { equalTo: "${pagePoster}" } }) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      } }`,
    );
    assert.equal(page3.data?.allBounties.nodes.length, 5);
    assert.equal(page3.data?.allBounties.pageInfo.hasNextPage, false);

    // All page node IDs are disjoint.
    const allPagedIds = new Set([
      ...page1.data!.allBounties.nodes.map((n) => n.id),
      ...page2.data!.allBounties.nodes.map((n) => n.id),
      ...page3.data!.allBounties.nodes.map((n) => n.id),
    ]);
    assert.equal(allPagedIds.size, 25, 'all 25 pages cover unique IDs');
  });

  it('F1 — BountyPosted strings + deadline projected via GraphQL', async () => {
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });

    // Distinctive fixtures: distinct from gtest's `phase-3-indexer-smoke` and
    // SDK's `sdk-decode-fixture-*`. Cross-suite contamination shows up as a
    // wrong-string assertion pointing at the swapping suite. deadline=3_000_000
    // exercises the Some arm and is distinct from gtest's 1_000_000 + SDK's
    // 2_000_000.
    const title = 'indexer-projection-title';
    const description = 'indexer-projection-description';
    const acceptance = 'indexer-projection-acceptance';
    const deadline = 3_000_000;

    const posted = await aliceClient.post({
      title,
      description,
      acceptance,
      reward: 1_000_000_000_000n,
      track: 'Open',
      deadline,
    });
    assert.ok(posted.ok);
    if (!posted.ok) throw new Error('post must succeed');
    const bid = posted.value.bountyId;

    const postedHeader = await api.rpc.chain.getHeader(posted.blockHash);
    const finalizedAtLeast = await waitForFinalizedAtLeast(
      api,
      postedHeader.number.toNumber(),
      180_000,
    );

    await backfill(
      { db: writerDb, api, programId, registry, logger: silent, batchSize: 50 },
      deployBlock,
      finalizedAtLeast,
    );

    interface BountyGqlF1 {
      id: string;
      title: string | null;
      description: string | null;
      acceptance: string | null;
      deadline: string | null;
    }
    const result = await gqlQuery<{ bountyById: BountyGqlF1 }>(
      `query Q($id: BigInt!) {
        bountyById(id: $id) {
          id title description acceptance deadline
        }
      }`,
      { id: bid.toString() },
    );
    assert.deepEqual(
      result.errors,
      undefined,
      `query errors: ${JSON.stringify(result.errors)}`,
    );
    const b = result.data?.bountyById;
    assert.ok(b, 'bountyById must return the bounty');
    if (!b) throw new Error('bounty missing');
    assert.equal(b.title, title);
    assert.equal(b.description, description);
    assert.equal(b.acceptance, acceptance);
    // PostGraphile's BigInt scalar serializes as STRING (CLAUDE.md Phase 3
    // contract). deadline column is bigint mode:'number' on the schema,
    // returned as string from the GraphQL surface.
    assert.equal(b.deadline, deadline.toString());
  });
});
