/**
 * Deadline filter (P2 §E — surfaced during P2 senior review).
 *
 * The contract's Post stores `deadline: Option<u32>` but the chain has no
 * AutoSettle / Cancel / Revoke exports, so a "deadline-passed" bounty is
 * semantically expired but mechanically still claimable. This filter
 * preempts the worker wasting cycles on a bounty the poster may no longer
 * want to accept.
 *
 * Cost: requires the current block number from chain. Placed last in the
 * pipeline so cheaper filters reject first.
 */

import type { Candidate } from '../discovery/types.js';
import type { FilterDecision } from './structural.js';

export function applyDeadlineFilter(
  candidate: Candidate,
  currentBlock: number,
): FilterDecision {
  if (candidate.deadline === null) return { decision: 'pass' };
  if (candidate.deadline <= currentBlock) {
    return {
      decision: 'drop',
      reason: `deadline-passed: candidate.deadline=${candidate.deadline}, currentBlock=${currentBlock}`,
    };
  }
  return { decision: 'pass' };
}
