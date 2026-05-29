import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { createChainApi, type ChainApiHandle } from '../../src/chain/api.js';
import type { IndexerConfig } from '../../src/config.js';

const silent = pino({ level: 'silent' });

const baseConfig: IndexerConfig = {
  databaseUrl: 'unused-for-api-test',
  databaseUrlReader: 'unused-for-api-test',
  vararRpcUrl: WS_URL,
  programId: ('0x' + '0'.repeat(64)) as `0x${string}`,
  startBlock: null,
  apiPort: 0,
  apiCorsOrigin: '*',
  logLevel: 'silent',
  mode: 'all',
  backfillBatchSize: 50,
  finalityCheckIntervalMs: 6000,
};

describe('chain/api.ts (real local node)', () => {
  let node: LocalNodeHandle;

  before(async () => {
    node = await startLocalNode();
  });

  after(async () => {
    await node.stop();
  });

  it('createChainApi connects, awaits isReady, queries the chain', async () => {
    const handle: ChainApiHandle = await createChainApi({
      config: baseConfig,
      logger: silent,
      onDisconnect: () => {},
      onReconnect: () => {},
    });
    try {
      // Confirm we can actually query — proves isReady worked.
      const finalizedHead = await handle.api.rpc.chain.getFinalizedHead();
      assert.match(finalizedHead.toHex(), /^0x[0-9a-f]{64}$/);
    } finally {
      await handle.disconnect();
    }
  });

  it('disconnect detaches listeners and tears down cleanly', async () => {
    let disconnectFires = 0;
    const handle = await createChainApi({
      config: baseConfig,
      logger: silent,
      onDisconnect: () => {
        disconnectFires += 1;
      },
      onReconnect: () => {},
    });
    await handle.disconnect();
    // After explicit disconnect(), listeners are detached. Any subsequent
    // synthetic 'disconnected' event on the api should NOT fire the handler.
    // (The api is already torn down anyway — this is a smoke check that
    // listener detachment didn't throw mid-way.)
    assert.equal(disconnectFires, 0, 'onDisconnect must NOT fire on explicit disconnect');
  });

  it('connecting twice in sequence works (no shared global state leaks)', async () => {
    const h1 = await createChainApi({
      config: baseConfig,
      logger: silent,
      onDisconnect: () => {},
      onReconnect: () => {},
    });
    await h1.disconnect();
    const h2 = await createChainApi({
      config: baseConfig,
      logger: silent,
      onDisconnect: () => {},
      onReconnect: () => {},
    });
    const head = await h2.api.rpc.chain.getFinalizedHead();
    assert.match(head.toHex(), /^0x[0-9a-f]{64}$/);
    await h2.disconnect();
  });
});
