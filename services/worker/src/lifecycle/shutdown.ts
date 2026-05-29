/**
 * ShutdownSequence — operator-locked teardown order (P2 §A / P3.9).
 *
 * Distinct from the boot rollback stack:
 *   - Rollback: reverse-of-construction; runs ONLY on boot failure to clean
 *     up partial state.
 *   - Shutdown: operator-locked order; runs after full boot succeeded. The
 *     order matters because some teardowns must precede others (e.g.,
 *     discovery unsub before chain disconnect so live subscriptions don't
 *     fire callbacks against a torn-down api).
 *
 * Idempotent: second invocation is a no-op (logged). Errors inside a step
 * are logged and SKIPPED — the next step still runs. Shutdown is best-effort;
 * exiting with some teardowns failed is preferable to hanging the process.
 */

import type { Logger } from 'pino';

export interface ShutdownStep {
  name: string;
  fn: () => Promise<void>;
}

export class ShutdownSequence {
  private invoked = false;

  constructor(
    private readonly steps: readonly ShutdownStep[],
    private readonly logger: Logger,
  ) {}

  async shutdown(): Promise<void> {
    if (this.invoked) {
      this.logger.info({ op: 'shutdown', msg: 'idempotent re-invocation; ignored' });
      return;
    }
    this.invoked = true;
    for (const step of this.steps) {
      this.logger.info({ op: 'shutdown', step: step.name });
      try {
        await step.fn();
      } catch (err) {
        this.logger.error(
          {
            op: 'shutdown',
            step: step.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'shutdown step failed; continuing',
        );
      }
    }
  }
}
