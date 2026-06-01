/**
 * Hand-curated high-quality routes for common bounty intents.
 *
 * The auto-generated CAPABILITY_INDEX (837+ entries across 44 topic buckets)
 * is comprehensive but noisy — topic assignment is keyword-based and can
 * surface irrelevant methods like `ReputationOracle/OracleStatus` at the head
 * of the "price" bucket. The router checks these overrides FIRST per topic
 * and falls back to the auto-generated index only when no override exists.
 *
 * Selection criteria for entries here:
 * - callType === 'query' (no signed extrinsic needed — pure RPC sim)
 * - cost === 'free' or 'gas-only' (no escrow, no voucher)
 * - authRequired === 'none' (any caller can hit it)
 * - The method semantically matches the topic (verified against the IDL,
 *   not just keyword-derived)
 *
 * What is NOT here (and why):
 * - varabridge price/gas/news feeds are FUNCTIONS (signed extrinsics), so
 *   they fall outside the current router's query-only execution model.
 *   When the worker eventually grows function-tier execution (signer +
 *   .signAndSend()), price/oracle/gas topics should be wired to varabridge
 *   methods. Until then, "price of BTC" bounties route to the Groq fallback.
 * - bountymesh-rep.GetScore requires an actor_id arg that can't be reliably
 *   extracted from bounty prose, so it falls through to fallback.
 */

import type { CapabilityEntry, TopicTag } from './types.js';

const AGENT_PULSE_PID = '0x61219b6e1a0724ac67c2e1133e6c5aaaddbfb88a0b457f93e6b94e02bdb27e6b' as const;
const INFINITE_BOUNTY_V3_PID = '0x747d09594538498f2c64ae91f93131a47b0ce8abaa80a54e37d7a6badadc15e8' as const;
const AAN_TV_PID = '0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f' as const;
const BOUNTYMESH_PID = '0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886' as const;

const pulseGetFeed: CapabilityEntry = {
  app: 'agent-pulse',
  programId: AGENT_PULSE_PID,
  service: 'PulseService',
  method: 'GetFeed',
  callType: 'query',
  authRequired: 'none',
  cost: 'gas-only',
  argTemplate: { count: '{count}' },
  argNames: ['count'],
  topics: ['feed', 'pulse', 'summarize', 'activity', 'recent'],
};

const pulseGetStats: CapabilityEntry = {
  app: 'agent-pulse',
  programId: AGENT_PULSE_PID,
  service: 'PulseService',
  method: 'GetStats',
  callType: 'query',
  authRequired: 'none',
  cost: 'free',
  argTemplate: {},
  argNames: [],
  topics: ['stats', 'pulse', 'analytics'],
};

const infiniteBountyByStatus: CapabilityEntry = {
  app: 'infinite-bounty-v3',
  programId: INFINITE_BOUNTY_V3_PID,
  service: 'BountyBoard',
  method: 'GetBountiesByStatus',
  callType: 'query',
  authRequired: 'none',
  cost: 'gas-only',
  argTemplate: { status: '{status}', cursor: '{cursor}', limit: '{limit}' },
  argNames: ['status', 'cursor', 'limit'],
  topics: ['bounty', 'task', 'mission', 'discovery'],
};

const infiniteBountyConfig: CapabilityEntry = {
  app: 'infinite-bounty-v3',
  programId: INFINITE_BOUNTY_V3_PID,
  service: 'BountyBoard',
  method: 'GetConfig',
  callType: 'query',
  authRequired: 'none',
  cost: 'free',
  argTemplate: {},
  argNames: [],
  topics: ['config', 'bounty'],
};

const aanTvCoverage: CapabilityEntry = {
  app: 'aan-tv',
  programId: AAN_TV_PID,
  service: 'AanTv',
  method: 'GetCoverageQueue',
  callType: 'query',
  authRequired: 'none',
  cost: 'gas-only',
  argTemplate: { cursor: '{cursor}', limit: '{limit}' },
  argNames: ['cursor', 'limit'],
  topics: ['coverage', 'narrate', 'event'],
};

// bountymesh's own GetBountyById serves "show me bounty N" lookups —
// useful when a bounty asks "what was bounty #42 about?"
const bountymeshGetBounty: CapabilityEntry = {
  app: 'bountymesh',
  programId: BOUNTYMESH_PID,
  service: 'DiscoveryService',
  method: 'GetBounty',
  callType: 'query',
  authRequired: 'none',
  cost: 'gas-only',
  argTemplate: { id: '{id}' },
  argNames: ['id'],
  topics: ['bounty', 'task'],
};

export const TOPIC_OVERRIDES: Partial<Record<TopicTag, readonly CapabilityEntry[]>> = Object.freeze({
  feed: [pulseGetFeed, pulseGetStats],
  pulse: [pulseGetFeed, pulseGetStats],
  summarize: [pulseGetFeed],
  activity: [pulseGetFeed, pulseGetStats],
  recent: [pulseGetFeed],
  stats: [pulseGetStats],
  bounty: [infiniteBountyByStatus, bountymeshGetBounty, infiniteBountyConfig],
  task: [infiniteBountyByStatus, bountymeshGetBounty],
  mission: [infiniteBountyByStatus],
  discovery: [infiniteBountyByStatus],
  coverage: [aanTvCoverage],
  narrate: [aanTvCoverage],
});

export function lookupOverride(topic: TopicTag): readonly CapabilityEntry[] {
  return TOPIC_OVERRIDES[topic] ?? [];
}
