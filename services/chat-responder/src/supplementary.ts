/**
 * Per-app supplementary state. The composeReply step takes one of these
 * blobs and the LLM is instructed to ground every numeric claim in it.
 *
 * Bountymesh:  open bounty count, total bounty count, recent settle
 * Bountymesh-rep:  worker stats from the bountymesh indexer (rep-adjacent)
 * Bountymesh-feeds:  GetTotalRouted via sails-js (count + atomic sum)
 */

import type { Sails } from 'sails-js';
import type { OurAppHandle } from './indexer.js';

const INDEXER_BASE = process.env.INDEXER_BASE_URL ?? 'https://api.bountymesh.xyz';

export interface BountymeshState {
  app: 'bountymesh';
  openCount: number;
  totalCount: number;
  recentSettle: { bountyId: string; rewardAtomic: bigint; workerShortHex: string } | null;
}

export interface BountymeshRepState {
  app: 'bountymesh-rep';
  uniqueWorkers: number;
  totalSubmissions: number;
  totalAccepted: number;
}

export interface BountymeshFeedsState {
  app: 'bountymesh-feeds';
  signalCount: number;
  totalEffectiveAtomic: bigint;
}

export type SupplementaryState = BountymeshState | BountymeshRepState | BountymeshFeedsState;

async function gql<T>(query: string): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_BASE}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T };
    return body.data ?? null;
  } catch {
    return null;
  }
}

async function bountymeshSupplementary(): Promise<BountymeshState> {
  const counts = await gql<{
    open: { totalCount: number };
    all: { totalCount: number };
    settled: { nodes: Array<{ id: string; reward: string; worker: string | null }> };
  }>(`{
    open: allBounties(filter: { status: { equalTo: "Open" } }) { totalCount }
    all: allBounties { totalCount }
    settled: allBounties(filter: { withdrawn: { equalTo: true } }, orderBy: WITHDRAWN_AT_DESC, first: 1) {
      nodes { id reward worker }
    }
  }`);
  const settleNode = counts?.settled?.nodes?.[0];
  const recentSettle = settleNode?.worker
    ? {
        bountyId: settleNode.id,
        rewardAtomic: BigInt(settleNode.reward),
        workerShortHex: `${settleNode.worker.slice(0, 8)}…${settleNode.worker.slice(-4)}`,
      }
    : null;
  return {
    app: 'bountymesh',
    openCount: counts?.open?.totalCount ?? 0,
    totalCount: counts?.all?.totalCount ?? 0,
    recentSettle,
  };
}

async function bountymeshRepSupplementary(): Promise<BountymeshRepState> {
  const data = await gql<{
    submitted: { totalCount: number };
    accepted: { totalCount: number };
    distinct: { nodes: Array<{ worker: string | null }> };
  }>(`{
    submitted: allBounties(filter: { submittedAt: { isNull: false } }) { totalCount }
    accepted: allBounties(filter: { acceptedAt: { isNull: false } }) { totalCount }
    distinct: allBounties(filter: { worker: { isNull: false } }) { nodes { worker } }
  }`);
  const workers = new Set<string>();
  for (const node of data?.distinct?.nodes ?? []) {
    if (node.worker) workers.add(node.worker);
  }
  return {
    app: 'bountymesh-rep',
    uniqueWorkers: workers.size,
    totalSubmissions: data?.submitted?.totalCount ?? 0,
    totalAccepted: data?.accepted?.totalCount ?? 0,
  };
}

async function bountymeshFeedsSupplementary(feedsSails: Sails | null): Promise<BountymeshFeedsState> {
  if (!feedsSails) return { app: 'bountymesh-feeds', signalCount: 0, totalEffectiveAtomic: 0n };
  try {
    const qb = feedsSails.services.FeedsService.queries.GetTotalRouted();
    const result = (await qb.call()) as [number, string | bigint] | null;
    if (!result) return { app: 'bountymesh-feeds', signalCount: 0, totalEffectiveAtomic: 0n };
    return {
      app: 'bountymesh-feeds',
      signalCount: Number(result[0]),
      totalEffectiveAtomic: BigInt(result[1]),
    };
  } catch {
    return { app: 'bountymesh-feeds', signalCount: 0, totalEffectiveAtomic: 0n };
  }
}

export async function fetchSupplementary(
  ourApp: OurAppHandle,
  feedsSails: Sails | null,
): Promise<SupplementaryState> {
  switch (ourApp) {
    case 'bountymesh':
      return bountymeshSupplementary();
    case 'bountymesh-rep':
      return bountymeshRepSupplementary();
    case 'bountymesh-feeds':
      return bountymeshFeedsSupplementary(feedsSails);
  }
}

/** Atomic → VARA (10^12) formatted to 2 decimals. */
export function formatVara(atomic: bigint): string {
  const whole = atomic / 1_000_000_000_000n;
  const frac = ((atomic % 1_000_000_000_000n) * 100n) / 1_000_000_000_000n;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}
