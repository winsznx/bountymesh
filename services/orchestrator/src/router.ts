/**
 * Phase-3 orchestrator router. Given a ranked list of TopicTags (output of
 * src/classifier.ts) and the bounty's raw content string, scan the
 * capability registry in topic order and return the first entry that:
 *
 * - Uses callType === 'query' (read-only RPC sim; free + fast; does NOT
 *   generate an Interaction on-chain — which is what we want when fanning
 *   per-bounty across 70 apps).
 * - Has cost === 'free' or 'gas-only' (prefers 'free'; falls back to
 *   'gas-only' only if no free option exists in any topic).
 * - Has authRequired === 'none'.
 * - Has every argTemplate slot resolvable from the bounty content (or a
 *   safe default). Entries with {handle} / {worker} placeholders are
 *   skipped because we cannot synthesize those without external data.
 *
 * Returns null when no route matches across all topics; the caller is
 * expected to fall back to its existing supplementary context (e.g.
 * Groq summarisation).
 */

import type { CapabilityEntry, RouteResult, TopicTag } from './types.js';
import { CAPABILITY_INDEX } from './capability-index.js';
import { lookupOverride } from './overrides.js';

const TICKER_RE = /\b([A-Z]{2,6})\b/g;

const KNOWN_TICKERS = new Set([
  'BTC',
  'ETH',
  'VARA',
  'SOL',
  'USDC',
  'USDT',
  'DOT',
  'KSM',
  'BNB',
  'ADA',
  'XRP',
  'AVAX',
  'MATIC',
  'LINK',
  'ATOM',
  'NEAR',
  'TIA',
  'ARB',
  'OP',
  'DOGE',
]);

const COUNT_RE = /\b(\d{1,3})\b/;

const TEMPLATE_PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/;

function extractSymbol(content: string): string {
  TICKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TICKER_RE.exec(content)) !== null) {
    const candidate = match[1];
    if (KNOWN_TICKERS.has(candidate)) return candidate;
  }
  return 'VARA';
}

function extractCount(content: string): number {
  const m = content.match(COUNT_RE);
  if (!m) return 5;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return 5;
  if (n > 100) return 100;
  return n;
}

type ArgResolution =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

function resolveSlot(
  template: string,
  argName: string,
  content: string,
): ArgResolution {
  const placeholderMatch = template.match(TEMPLATE_PLACEHOLDER_RE);
  if (!placeholderMatch) {
    return { ok: true, value: template };
  }
  const placeholder = placeholderMatch[1].toLowerCase();
  switch (placeholder) {
    case 'symbol':
    case 'ticker':
    case 'asset': {
      return { ok: true, value: extractSymbol(content) };
    }
    case 'count':
    case 'limit':
    case 'n':
    case 'size': {
      return { ok: true, value: extractCount(content) };
    }
    case 'handle':
    case 'worker':
    case 'agent':
    case 'account':
    case 'actor':
    case 'address': {
      return { ok: false, reason: `unresolvable placeholder {${placeholder}} for arg ${argName}` };
    }
    case 'status': {
      // Sails enum input shape: { Variant: null } for unit variants.
      // Default to Open for bounty/task lookups; if the prose mentions a
      // specific status verbatim, use that.
      const lc = content.toLowerCase();
      const variants = ['Open', 'Claimed', 'Submitted', 'Approved', 'Accepted', 'Cancelled', 'Rejected', 'TimedOut', 'Revoked', 'Withdrawn'];
      for (const v of variants) {
        if (lc.includes(v.toLowerCase())) {
          return { ok: true, value: { [v]: null } };
        }
      }
      return { ok: true, value: { Open: null } };
    }
    case 'id':
    case 'bountyid':
    case 'bounty_id': {
      const m = content.match(/#\s*(\d{1,8})\b/);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n)) return { ok: true, value: BigInt(n) };
      }
      return { ok: false, reason: `no numeric id found in content for {${placeholder}}` };
    }
    case 'cursor': {
      return { ok: true, value: null };
    }
    default: {
      return { ok: true, value: null };
    }
  }
}

function resolveEntryArgs(entry: CapabilityEntry, content: string): unknown[] | null {
  const resolved: unknown[] = [];
  for (const argName of entry.argNames) {
    const template = entry.argTemplate[argName];
    if (template === undefined) {
      resolved.push(null);
      continue;
    }
    const slot = resolveSlot(template, argName, content);
    if (!slot.ok) return null;
    resolved.push(slot.value);
  }
  return resolved;
}

function entryIsRoutable(entry: CapabilityEntry): boolean {
  if (entry.callType !== 'query') return false;
  if (entry.authRequired !== 'none') return false;
  if (entry.cost !== 'free' && entry.cost !== 'gas-only') return false;
  return true;
}

function tryBucket(
  bucket: readonly CapabilityEntry[],
  topic: TopicTag,
  bountyContent: string,
): { result: RouteResult | null; fallback: RouteResult | null } {
  let fallback: RouteResult | null = null;
  for (const entry of bucket) {
    if (!entryIsRoutable(entry)) continue;
    const args = resolveEntryArgs(entry, bountyContent);
    if (args === null) continue;

    const result: RouteResult = {
      app: entry.app,
      programId: entry.programId,
      service: entry.service,
      method: entry.method,
      callType: entry.callType,
      args,
      topic,
    };
    if (entry.cost === 'free') return { result, fallback: null };
    if (fallback === null) fallback = result;
  }
  return { result: null, fallback };
}

function firstRoutable(
  entries: readonly CapabilityEntry[],
  topic: TopicTag,
  bountyContent: string,
): RouteResult | null {
  for (const entry of entries) {
    if (!entryIsRoutable(entry)) continue;
    const args = resolveEntryArgs(entry, bountyContent);
    if (args === null) continue;
    return {
      app: entry.app,
      programId: entry.programId,
      service: entry.service,
      method: entry.method,
      callType: entry.callType,
      args,
      topic,
    };
  }
  return null;
}

export function route(topics: TopicTag[], bountyContent: string): RouteResult | null {
  let fallback: RouteResult | null = null;

  for (const topic of topics) {
    // Hand-curated overrides take precedence and are ranked by relevance,
    // not by cost — return the first routable entry verbatim. See overrides.ts.
    const overrides = lookupOverride(topic);
    if (overrides.length > 0) {
      const r = firstRoutable(overrides, topic, bountyContent);
      if (r) return r;
    }

    const bucket = CAPABILITY_INDEX[topic];
    if (!bucket || bucket.length === 0) continue;
    // Auto-generated index uses cost-based tiebreak (free > gas-only).
    const r = tryBucket(bucket, topic, bountyContent);
    if (r.result) return r.result;
    if (r.fallback && fallback === null) fallback = r.fallback;
  }

  return fallback;
}
