/**
 * Filter pipeline orchestrator. Composes 4 layers in cost-ascending order:
 *   1. dedup       — O(1) Set lookup against work_history
 *   2. serializer  — O(1) flag check (Main FSM ceiling=1 gate, P2 §8)
 *   3. structural  — track + reward + non-self-poster (P0 §B1)
 *   4. deadline    — deadline ≤ currentBlock check (requires RPC; most expensive)
 *
 * Returns a CandidateConsumer to plug into discovery's setupDiscovery({consumer}).
 *
 * Slot ownership on PASS: serializer stays acquired; onAccepted takes
 * ownership. P3.x FSM releases when it closes on Submit-confirmed (P2 §8
 * Main FSM ceiling=1 closure). If onAccepted throws, the pipeline releases
 * defensively + re-throws.
 */

import type { Logger } from 'pino';
import type { WorkerConfig } from '../config/index.js';
import type { Candidate, CandidateConsumer } from '../discovery/types.js';
import { applyDeadlineFilter } from './deadline.js';
import type { WorkHistoryDedup } from './dedup.js';
import type { InflightSerializer } from './serializer.js';
import { applyStructuralFilter } from './structural.js';

export interface FilterPipelineOptions {
  config: WorkerConfig;
  myAddress: `0x${string}`;
  workHistory: WorkHistoryDedup;
  serializer: InflightSerializer;
  getCurrentBlock: () => Promise<number>;
  onAccepted: (c: Candidate) => Promise<void> | void;
  logger: Logger;
}

export function createFilterPipeline(opts: FilterPipelineOptions): CandidateConsumer {
  return async (candidate: Candidate): Promise<void> => {
    const candidateId = candidate.id.toString();
    const baseFields = {
      op: 'filter',
      candidateId,
      phase: candidate.phase,
    };

    // 1. dedup
    if (opts.workHistory.has(candidate.id)) {
      opts.logger.info({ ...baseFields, decision: 'drop', reason: 'in-work-history' });
      return;
    }

    // 2. serializer (acquire inflight slot speculatively)
    if (!opts.serializer.tryAcquire(candidate.id)) {
      opts.logger.info({
        ...baseFields,
        decision: 'drop',
        reason: 'inflight-busy',
        inflightId: opts.serializer.inflightId()?.toString() ?? null,
      });
      return;
    }

    // 3. structural
    const structural = applyStructuralFilter(candidate, {
      workerTrack: opts.config.workerTrack,
      workerMinReward: opts.config.workerMinReward,
      myAddress: opts.myAddress,
    });
    if (structural.decision === 'drop') {
      opts.serializer.release();
      opts.logger.info({ ...baseFields, decision: 'drop', reason: structural.reason });
      return;
    }

    // 4. deadline (requires currentBlock RPC)
    const currentBlock = await opts.getCurrentBlock();
    const deadline = applyDeadlineFilter(candidate, currentBlock);
    if (deadline.decision === 'drop') {
      opts.serializer.release();
      opts.logger.info({ ...baseFields, decision: 'drop', reason: deadline.reason });
      return;
    }

    // PASS — onAccepted takes ownership of the inflight slot.
    opts.logger.info({ ...baseFields, decision: 'pass' });
    try {
      await opts.onAccepted(candidate);
    } catch (err) {
      // Defensive: if onAccepted throws before it can release, free the slot
      // so the worker isn't permanently stuck. Re-throw so the caller (P2 §C
      // pipeline wrapper) can transition to WaitingForOperatorIntervention.
      opts.serializer.release();
      opts.logger.error(
        { ...baseFields, err: err instanceof Error ? err.message : String(err) },
        'onAccepted threw — released serializer defensively',
      );
      throw err;
    }
  };
}
