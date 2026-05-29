import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests deploy a fresh program per file (Phase A Decision 3 — D3:C). Each file
    // boots a node (or reuses one) in its own beforeAll. Run files serially to avoid
    // multiple suites racing for the single node + RPC connection.
    fileParallelism: false,
  },
});

