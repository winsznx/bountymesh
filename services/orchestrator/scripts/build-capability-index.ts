/**
 * P13.2 — build-capability-index
 *
 * Parses every <handle>.idl + <handle>.meta.json pair under
 * services/orchestrator/data/idls and emits a strongly-typed
 * services/orchestrator/src/capability-index.ts that the Phase-3 router
 * consumes.
 *
 * The output deliberately separates:
 *   - CAPABILITY_INDEX: Record<topic, readonly CapabilityEntry[]>
 *   - ALL_ENTRIES:      readonly CapabilityEntry[] (flat)
 *   - INDEX_VERSION:    fixed string literal (no runtime time call)
 *
 * Within each topic bucket entries are ranked by cost:
 *   free  <  gas-only  <  voucher  <  escrow
 * so the router prefers the cheapest path by default.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthKind, CallType, CapabilityEntry, CostKind } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IDL_DIR = join(ROOT, 'data', 'idls');
const OUT_FILE = join(ROOT, 'src', 'capability-index.ts');
const INDEX_VERSION = '2026-06-01-p13-2';

interface IdlMeta {
  handle: string;
  programId: `0x${string}`;
  owner?: string;
  track?: string;
  idlUrl?: string;
  tags?: string[];
  fetched: boolean;
}

interface ParsedMethod {
  service: string;
  method: string;
  callType: CallType;
  argNames: string[];
  argTypes: string[];
  returnType: string;
  rawLine: string;
}

interface IdlParseResult {
  services: string[];
  methods: ParsedMethod[];
}

// ────────────────────────────────────────────────────────────────────────────
// IDL parser
// ────────────────────────────────────────────────────────────────────────────

const SERVICE_HEADER_RE = /^service\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
const METHOD_LINE_RE = /^\s*(query\s+)?([A-Z][A-Za-z0-9_]*)\s*:\s*\(([^)]*)\)(?:\s*->\s*(.+?))?\s*;\s*$/;

function parseIdl(idlText: string): IdlParseResult {
  const services: string[] = [];
  const methods: ParsedMethod[] = [];

  const lines = idlText.split(/\r?\n/);
  let currentService: string | null = null;
  let braceDepth = 0;
  let insideService = false;
  let insideNested = false;
  let nestedDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (!insideService) {
      const m = trimmed.match(SERVICE_HEADER_RE);
      if (m) {
        currentService = m[1];
        services.push(currentService);
        insideService = true;
        braceDepth = 1;
        insideNested = false;
        nestedDepth = 0;
      }
      continue;
    }

    // Inside a service block. Track nested braces (events { ... } sub-blocks
    // and inline struct { ... } returns). We only parse top-level method
    // lines whose nestedDepth === 0.
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (insideNested) {
      nestedDepth += opens - closes;
      if (nestedDepth <= 0) {
        insideNested = false;
        nestedDepth = 0;
      }
      // also bookkeep service braces
      braceDepth += opens - closes;
      if (braceDepth <= 0) {
        insideService = false;
        currentService = null;
        braceDepth = 0;
      }
      continue;
    }

    if (/^\s*events\s*\{/.test(line) || /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\{\s*$/.test(line)) {
      // entering nested block (events or inline struct/enum)
      insideNested = true;
      nestedDepth = opens - closes;
      braceDepth += opens - closes;
      if (nestedDepth <= 0) insideNested = false;
      continue;
    }

    // Try method match
    const mm = trimmed.match(METHOD_LINE_RE);
    if (mm && currentService) {
      const isQuery = Boolean(mm[1]);
      const methodName = mm[2];
      const argsStr = mm[3];
      const retStr = (mm[4] ?? 'null').trim();

      const { argNames, argTypes } = parseArgs(argsStr);

      methods.push({
        service: currentService,
        method: methodName,
        callType: isQuery ? 'query' : 'function',
        argNames,
        argTypes,
        returnType: retStr,
        rawLine: trimmed,
      });
    }

    braceDepth += opens - closes;
    if (braceDepth <= 0) {
      insideService = false;
      currentService = null;
      braceDepth = 0;
    }
  }

  return { services, methods };
}

function parseArgs(argsStr: string): { argNames: string[]; argTypes: string[] } {
  const argNames: string[] = [];
  const argTypes: string[] = [];
  const trimmed = argsStr.trim();
  if (trimmed.length === 0) return { argNames, argTypes };

  // Split on top-level commas (these IDL signatures are flat — no nested
  // generics or tuples spanning commas at the arg level, because we already
  // stopped at the matching paren). Still defensive against vec/opt args.
  const parts = splitTopLevelCommas(trimmed);
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const type = part.slice(colon + 1).trim();
    if (!name) continue;
    argNames.push(name);
    argTypes.push(type);
  }
  return { argNames, argTypes };
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '<' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '>' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Classifiers
// ────────────────────────────────────────────────────────────────────────────

const SCALAR_TYPES = new Set([
  'str',
  'String',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'i8',
  'i16',
  'i32',
  'i64',
  'i128',
  'bool',
  'actor_id',
  'h256',
  'H256',
  'null',
]);

function isScalar(type: string): boolean {
  const t = type.trim();
  if (SCALAR_TYPES.has(t)) return true;
  if (/^opt\s+/.test(t)) return isScalar(t.replace(/^opt\s+/, ''));
  return false;
}

function classifyAuth(method: string): AuthKind {
  const m = method.toLowerCase();
  if (/^(admin|configure|set|grant|revoke|pause|unpause|migrate|upgrade)/.test(m)) return 'Other';
  if (/^(subscribe|register|enroll|signup|join|onboard)/.test(m)) return 'Wallet';
  if (/^(activate|authorize|approve|attest)/.test(m)) return 'Application';
  return 'none';
}

function classifyCost(
  callType: CallType,
  argCount: number,
  method: string,
): CostKind {
  if (callType === 'query') {
    return argCount === 0 ? 'free' : 'gas-only';
  }
  const m = method.toLowerCase();
  // Heuristics on method name → value semantics
  if (
    /(post|place|stake|deposit|fund|escrow|sponsor|pay|tip|donate|buy|purchase|mint|enter|bet|wager)/.test(
      m,
    )
  ) {
    return 'escrow';
  }
  return 'voucher';
}

// Topic taxonomy — bucket → keyword set. Methods/services/tags hit any
// keyword to land in that bucket. Buckets are intentionally broad so the
// Phase-3 router has options.
const TOPIC_KEYWORDS: Record<string, string[]> = {
  price: ['price', 'rate', 'quote', 'usd', 'value', 'oracle', 'priced', 'spot'],
  market: ['market', 'markets', 'odds', 'outcome', 'binary'],
  predict: ['predict', 'prediction', 'forecast', 'bet', 'wager'],
  bet: ['bet', 'wager', 'odds', 'stake'],
  casino: ['casino', 'roll', 'spin', 'flip', 'dice', 'slots', 'keno', 'wheel', 'crash', 'mines'],
  feed: ['feed', 'timeline', 'recent', 'stream', 'activity', 'pulse'],
  news: ['news', 'headline', 'headlines', 'article', 'story'],
  weather: ['weather', 'forecast', 'temperature', 'climate'],
  score: ['score', 'rank', 'rating', 'leaderboard'],
  reputation: ['reputation', 'credit', 'trust', 'attest', 'attestation', 'history'],
  bounty: ['bounty', 'bounties', 'task', 'tasks', 'mission', 'missions', 'job', 'jobs'],
  coverage: ['cover', 'coverage', 'insurance', 'claim', 'narrate', 'narration'],
  oracle: ['oracle', 'feed', 'price', 'rate', 'quote', 'gas', 'datetime'],
  dex: ['dex', 'swap', 'orderbook', 'liquidity', 'amm', 'pool', 'pair'],
  trade: ['trade', 'swap', 'exchange', 'buy', 'sell'],
  pulse: ['pulse', 'activity', 'recent', 'tick', 'beat', 'heartbeat'],
  social: ['social', 'chat', 'message', 'post', 'board', 'follow'],
  chat: ['chat', 'message', 'reply', 'conversation', 'thread'],
  board: ['board', 'announce', 'announcement', 'post', 'bulletin'],
  registry: ['registry', 'register', 'directory', 'discover', 'index'],
  discovery: ['discover', 'directory', 'find', 'search', 'list'],
  analytics: ['analytics', 'metric', 'metrics', 'stat', 'stats', 'report'],
  agent: ['agent', 'agents', 'profile', 'identity'],
  ranking: ['rank', 'ranking', 'leaderboard', 'top', 'ladder'],
  reward: ['reward', 'rewards', 'payout', 'distribute', 'bounty'],
  governance: ['govern', 'governance', 'vote', 'proposal', 'dao'],
  identity: ['identity', 'profile', 'card', 'handle'],
  payment: ['pay', 'payment', 'invoice', 'settle', 'transfer'],
  escrow: ['escrow', 'deposit', 'hold', 'lock', 'release'],
  insurance: ['insurance', 'cover', 'coverage', 'policy', 'claim'],
  nft: ['nft', 'token', 'mint', 'transfer', 'collection'],
  vault: ['vault', 'storage', 'safe', 'lock'],
  bridge: ['bridge', 'cross', 'relay', 'connect'],
  router: ['route', 'router', 'forward', 'proxy'],
  game: ['game', 'play', 'gaming', 'level', 'quest'],
  raffle: ['raffle', 'lottery', 'draw', 'ticket'],
  staking: ['stake', 'staking', 'delegate', 'bond', 'unbond'],
  treasury: ['treasury', 'fund', 'pool', 'reserve'],
  promo: ['promo', 'promotion', 'campaign', 'advert'],
  mission: ['mission', 'quest', 'task', 'objective'],
  pact: ['pact', 'integration', 'partnership', 'covenant'],
  signal: ['signal', 'event', 'broadcast', 'emit'],
  stats: ['stat', 'stats', 'count', 'metric', 'totals'],
  config: ['config', 'configure', 'set', 'admin', 'tune'],
  fallback: [],
};

function deriveTopics(
  method: string,
  service: string,
  tags: string[],
  argTypes: string[],
  returnType: string,
): string[] {
  // METHOD NAME is the primary signal — it's the actual semantic of the call.
  // Service/tags/argTypes/returnType are noisy (e.g. an "Oracle" service has
  // methods that aren't price oracles). They contribute only as a TIE-BREAKER:
  // a topic is assigned iff the METHOD name matches a keyword, OR the method
  // contains a partial signal AND the service name reinforces it.
  void argTypes;
  void returnType;
  const methodTokens = new Set<string>();
  const serviceTokens = new Set<string>();
  const tagTokens = new Set<string>();
  const pushInto = (set: Set<string>, raw: string) => {
    const lc = raw.toLowerCase();
    set.add(lc);
    for (const part of lc.split(/[^a-z0-9]+/)) if (part) set.add(part);
    const camel = raw.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    for (const part of camel.split(/[^a-z0-9]+/)) if (part) set.add(part);
  };
  pushInto(methodTokens, method);
  pushInto(serviceTokens, service);
  for (const t of tags) pushInto(tagTokens, t);

  const methodHasKeyword = (kw: string): boolean => {
    if (methodTokens.has(kw)) return true;
    for (const tok of methodTokens) {
      if (tok.length >= 5 && kw.length >= 4 && tok.includes(kw)) return true;
    }
    return false;
  };

  const topics: string[] = [];
  for (const [bucket, kws] of Object.entries(TOPIC_KEYWORDS)) {
    if (bucket === 'fallback') continue;
    // Strong signal: method-name contains the bucket key or a bucket keyword.
    if (methodHasKeyword(bucket)) {
      topics.push(bucket);
      continue;
    }
    let methodMatched = false;
    for (const kw of kws) {
      if (methodHasKeyword(kw)) {
        methodMatched = true;
        break;
      }
    }
    if (methodMatched) {
      topics.push(bucket);
      continue;
    }
    // Weak signal: app self-tagged with this bucket via meta.tags.
    // Service-name match alone is NOT enough (e.g. ReputationOracle has methods
    // that aren't oracles). We accept tag matches because tags are author-curated.
    if (tagTokens.has(bucket)) {
      topics.push(bucket);
    }
  }

  return Array.from(new Set(topics));
}

// ────────────────────────────────────────────────────────────────────────────
// Build pipeline
// ────────────────────────────────────────────────────────────────────────────

const COST_RANK: Record<CostKind, number> = {
  free: 0,
  'gas-only': 1,
  voucher: 2,
  escrow: 3,
};

function buildArgTemplate(argNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of argNames) out[n] = `{${n}}`;
  return out;
}

function loadIdls(): { meta: IdlMeta; idlText: string }[] {
  const files = readdirSync(IDL_DIR);
  const metas = files.filter((f) => f.endsWith('.meta.json'));

  const loaded: { meta: IdlMeta; idlText: string }[] = [];
  for (const metaFile of metas) {
    const handle = metaFile.replace(/\.meta\.json$/, '');
    const metaPath = join(IDL_DIR, metaFile);
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as IdlMeta;
    if (!meta.fetched) continue;

    const idlPath = join(IDL_DIR, `${handle}.idl`);
    let idlText: string;
    try {
      idlText = readFileSync(idlPath, 'utf-8');
    } catch {
      continue;
    }

    // Guard against rescued HTML (404 pages saved as .idl)
    if (!/^service\s+/m.test(idlText)) continue;

    loaded.push({ meta, idlText });
  }
  return loaded;
}

interface BuildSummary {
  idlsParsed: number;
  totalEntries: number;
  bucketCount: number;
  sampleBuckets: { topic: string; count: number; topApp: string }[];
}

function build(): BuildSummary {
  const loaded = loadIdls();
  const allEntries: CapabilityEntry[] = [];

  for (const { meta, idlText } of loaded) {
    const parsed = parseIdl(idlText);
    for (const m of parsed.methods) {
      const auth = classifyAuth(m.method);
      const cost = classifyCost(m.callType, m.argNames.length, m.method);
      const topics = deriveTopics(
        m.method,
        m.service,
        meta.tags ?? [],
        m.argTypes,
        m.returnType,
      );
      const entry: CapabilityEntry = {
        app: meta.handle,
        programId: meta.programId,
        service: m.service,
        method: m.method,
        callType: m.callType,
        authRequired: auth,
        cost,
        argTemplate: buildArgTemplate(m.argNames),
        argNames: m.argNames,
        topics,
        track: meta.track,
      };
      allEntries.push(entry);
    }
  }

  // Sort flat list deterministically for reproducible output
  allEntries.sort((a, b) => {
    if (a.app !== b.app) return a.app < b.app ? -1 : 1;
    if (a.service !== b.service) return a.service < b.service ? -1 : 1;
    return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
  });

  // Bucket
  const buckets: Record<string, CapabilityEntry[]> = {};
  for (const entry of allEntries) {
    for (const topic of entry.topics) {
      (buckets[topic] ??= []).push(entry);
    }
  }
  // Always include fallback (empty) so the router can rely on the key
  buckets['fallback'] ??= [];

  // Rank inside each bucket: cost asc, then app, then method
  for (const topic of Object.keys(buckets)) {
    buckets[topic].sort((a, b) => {
      const ca = COST_RANK[a.cost];
      const cb = COST_RANK[b.cost];
      if (ca !== cb) return ca - cb;
      if (a.app !== b.app) return a.app < b.app ? -1 : 1;
      return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
    });
  }

  const orderedBucketKeys = Object.keys(buckets).sort();

  // Emit the TS module
  const out = emitModule(buckets, allEntries, orderedBucketKeys);
  writeFileSync(OUT_FILE, out, 'utf-8');

  const bucketCount = orderedBucketKeys.filter((k) => buckets[k].length > 0).length;
  const sampleBuckets = orderedBucketKeys
    .filter((k) => buckets[k].length > 0)
    .slice(0, 5)
    .map((k) => ({
      topic: k,
      count: buckets[k].length,
      topApp: buckets[k][0]!.app,
    }));

  return {
    idlsParsed: loaded.length,
    totalEntries: allEntries.length,
    bucketCount,
    sampleBuckets,
  };
}

function jsonLit(v: unknown): string {
  return JSON.stringify(v);
}

function emitEntry(e: CapabilityEntry, indent: string): string {
  const lines = [
    `${indent}{`,
    `${indent}  app: ${jsonLit(e.app)},`,
    `${indent}  programId: ${jsonLit(e.programId)} as \`0x\${string}\`,`,
    `${indent}  service: ${jsonLit(e.service)},`,
    `${indent}  method: ${jsonLit(e.method)},`,
    `${indent}  callType: ${jsonLit(e.callType)},`,
    `${indent}  authRequired: ${jsonLit(e.authRequired)},`,
    `${indent}  cost: ${jsonLit(e.cost)},`,
    `${indent}  argTemplate: ${jsonLit(e.argTemplate)} as Record<string, string>,`,
    `${indent}  argNames: ${jsonLit(e.argNames)} as string[],`,
    `${indent}  topics: ${jsonLit(e.topics)} as string[],`,
  ];
  if (e.track !== undefined) {
    lines.push(`${indent}  track: ${jsonLit(e.track)},`);
  }
  lines.push(`${indent}} as CapabilityEntry`);
  return lines.join('\n');
}

function emitModule(
  buckets: Record<string, CapabilityEntry[]>,
  flat: CapabilityEntry[],
  bucketOrder: string[],
): string {
  const header = [
    '/**',
    ' * AUTO-GENERATED by scripts/build-capability-index.ts — DO NOT EDIT BY HAND.',
    ` * Run \`npx tsx scripts/build-capability-index.ts\` from services/orchestrator`,
    ' * to regenerate. Source of truth: services/orchestrator/data/idls/*.{idl,meta.json}.',
    ` * Generated INDEX_VERSION: ${INDEX_VERSION}`,
    ' */',
    '',
    'import type { CapabilityEntry } from \'./types.js\';',
    '',
    `export const INDEX_VERSION = ${jsonLit(INDEX_VERSION)} as const;`,
    '',
    '/**',
    ' * Curated keyword taxonomy used by src/classifier.ts to bucket bounty',
    ' * content into TopicTag(s). Lowercase, matched against tokens split out',
    ' * of the bounty content. The keys correspond 1:1 with CAPABILITY_INDEX',
    ' * buckets — every routable topic has a non-empty keyword list (except',
    ' * the synthetic "fallback" bucket).',
    ' */',
    `export const TOPIC_KEYWORDS: Record<string, readonly string[]> = Object.freeze(${jsonLit(TOPIC_KEYWORDS)});`,
    '',
  ].join('\n');

  // Emit flat array first
  const flatLines: string[] = [];
  flatLines.push('export const ALL_ENTRIES: readonly CapabilityEntry[] = Object.freeze([');
  for (const e of flat) {
    flatLines.push(emitEntry(e, '  ') + ',');
  }
  flatLines.push(']);');
  flatLines.push('');

  // Emit per-bucket arrays referencing entries by index would be cleaner,
  // but the duplication-friendly form is simpler to read and lets routers
  // grep the file. Bucket entries reference the same shape (deep-equal but
  // freshly literal-emitted).
  const idxLines: string[] = [];
  idxLines.push('export const CAPABILITY_INDEX: Record<string, readonly CapabilityEntry[]> = Object.freeze({');
  for (const key of bucketOrder) {
    const arr = buckets[key]!;
    idxLines.push(`  ${jsonLit(key)}: Object.freeze([`);
    for (const e of arr) {
      idxLines.push(emitEntry(e, '    ') + ',');
    }
    idxLines.push('  ]),');
  }
  idxLines.push('});');
  idxLines.push('');

  return header + '\n' + flatLines.join('\n') + '\n' + idxLines.join('\n');
}

const summary = build();
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
