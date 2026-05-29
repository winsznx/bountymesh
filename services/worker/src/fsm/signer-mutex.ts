/**
 * Per-signer nonce mutex (P2 §A lock).
 *
 * Serializes sign-and-send calls across the Main FSM and the Pending-Accept
 * Monitor. Without this, @polkadot/api's signer would race nonce lookups —
 * two parallel signAndSend calls could read the same nonce and the second
 * tx would fail with `1014: priority too low` (the CLAUDE.md indexer rule
 * applied to the worker context).
 *
 * Design: chained-promise lock. Each acquire awaits the prior holder's
 * release before running its critical section. Hold time ~10ms per chain
 * call. No fairness guarantees beyond FIFO-by-await-order, which is what
 * the polkadot signer needs.
 *
 * API: `runExclusive(fn)` (no manual acquire/release per discipline note A).
 * The try/finally inside guarantees release even if `fn` throws, so callers
 * cannot leak the lock by forgetting to release in a catch.
 */

export class SignerMutex {
  private chain: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release: () => void = () => undefined;
    this.chain = new Promise<void>((r) => {
      release = r;
    });

    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }
}
