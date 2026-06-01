import { createHash } from 'node:crypto';

import type { OrchestratorEnvelope } from './types.js';

const ENVELOPE_VERSION = '1.0' as const;

export interface BuildEnvelopeInput {
  bountyId: number;
  result: unknown;
  source: 'external' | 'groq_fallback';
  sourceProgram?: string;
  sourceMethod?: string;
  sourceTxHash?: string;
  deliveredBy: string;
  deliveredAtBlock: number;
}

export interface BuildEnvelopeOutput {
  envelope: OrchestratorEnvelope;
  json: string;
  sha256: `0x${string}`;
}

/**
 * Canonical JSON: deterministic key order across nested objects.
 *
 * Hash stability across worker runs depends on byte-identical JSON, so we
 * cannot use JSON.stringify directly — Node's key-insertion order would leak
 * the envelope-construction order into the hash. Arrays preserve order;
 * non-plain values (numbers, strings, booleans, null) round-trip through
 * JSON.stringify unchanged.
 *
 * undefined values are dropped at every level (matches JSON.stringify default).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = canonicalize(v);
  }
  return out;
}

export function buildEnvelope(input: BuildEnvelopeInput): BuildEnvelopeOutput {
  const envelope: OrchestratorEnvelope = {
    envelope_version: ENVELOPE_VERSION,
    bounty_id: input.bountyId,
    result: input.result,
    source: input.source,
    source_program: input.sourceProgram,
    source_method: input.sourceMethod,
    source_tx_hash: input.sourceTxHash,
    delivered_by: input.deliveredBy,
    delivered_at_block: input.deliveredAtBlock,
  };

  const json = canonicalJson(envelope);
  const digest = createHash('sha256').update(json).digest('hex');
  const sha256 = `0x${digest}` as const;

  return { envelope, json, sha256 };
}
