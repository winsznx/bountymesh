/**
 * @bountymesh/orchestrator — public surface.
 *
 * Phase 3 router (route, executeRoute) lands in P13.3+ and will be re-exported
 * here when those modules exist. P13.2 ships envelope packaging and the Groq
 * fallback adapter; the classifier from P13.1 is exposed for callers that
 * want to bucket bounty content without going through the full router.
 */

export { classify, classifyOne } from './classifier.js';
export type { ClassifyOneResult } from './classifier.js';

export { CAPABILITY_INDEX } from './capability-index.js';

export { route } from './router.js';

export { executeRoute, buildOrchestratorSails, clearSailsCache } from './caller.js';

export { buildEnvelope, canonicalJson } from './envelope.js';
export type { BuildEnvelopeInput, BuildEnvelopeOutput } from './envelope.js';

export { groqFallback } from './groq-fallback.js';
export type { GroqFallbackOptions, GroqFallbackResult } from './groq-fallback.js';

export type {
  AuthKind,
  CallType,
  CapabilityEntry,
  CostKind,
  ExternalResult,
  ExternalResultErr,
  ExternalResultOk,
  OrchestratorEnvelope,
  RouteResult,
  TopicTag,
} from './types.js';
