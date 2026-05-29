/**
 * Structural filter — track + reward floor + non-self-poster (P0 §B1 lock).
 *
 * No content-aware filtering at v1. Title/description/acceptance are
 * consumed downstream by the WorkAdapter (P3.6), not by the filter.
 *
 * Pure function — no I/O, no state. Returns a discriminated decision so
 * the pipeline (pipeline.ts) can log the specific reject reason at INFO.
 */

import type { Track } from '../config/index.js';
import type { Candidate } from '../discovery/types.js';

export interface StructuralFilterOptions {
  workerTrack: Track;
  workerMinReward: bigint;
  myAddress: `0x${string}`;
}

export type FilterDecision =
  | { decision: 'pass' }
  | { decision: 'drop'; reason: string };

export function applyStructuralFilter(
  candidate: Candidate,
  opts: StructuralFilterOptions,
): FilterDecision {
  if (candidate.track !== opts.workerTrack) {
    return {
      decision: 'drop',
      reason: `track-mismatch: candidate.track=${candidate.track}, worker.track=${opts.workerTrack}`,
    };
  }
  if (candidate.reward < opts.workerMinReward) {
    return {
      decision: 'drop',
      reason: `reward-below-floor: ${candidate.reward} < ${opts.workerMinReward}`,
    };
  }
  if (candidate.poster.toLowerCase() === opts.myAddress.toLowerCase()) {
    return { decision: 'drop', reason: 'self-poster' };
  }
  return { decision: 'pass' };
}
