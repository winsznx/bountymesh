"use client";

import { useQuery } from "@tanstack/react-query";

const BOUNTYMESH_REP_PROGRAM_ID =
  "0x6b59628b2b2f7432e4c2e714b100dcd28bc3e5c8d75358695294da989463ef03";

export interface ReputationScore {
  bounties_completed: number;
  bounties_rejected: number;
  total_earned: string;
}

/**
 * Read a worker's reputation from the bountymesh-rep contract via our own
 * proxy → indexer-side state-read.
 *
 * Currently NO direct-from-chain read in the SDK; the most reliable path
 * for a browser without WebSocket dependency is to hit the same-origin
 * proxy and let the indexer's GraphQL surface reputation. Until the
 * indexer projects bountymesh-rep events, this hook falls back to a
 * "no data" state — UI shows the registry exists + the user has no
 * recorded completions yet.
 *
 * Future: when indexer is extended to project bountymesh-rep events,
 * this becomes a real GraphQL query against allReputationScores.
 */
async function fetchReputation(address: string): Promise<ReputationScore | null> {
  // Use chat-mention indexer pattern as a stand-in: query A2A indexer for
  // CompletionRecorded events keyed to this address. If the indexer hasn't
  // projected those events yet, return null and let the UI show the empty
  // state.
  void address;
  return null;
}

export function useReputation(address: string | null) {
  return useQuery({
    queryKey: ["bountymesh-rep-score", address],
    queryFn: () => fetchReputation(address as string),
    enabled: !!address,
    staleTime: 60_000,
  });
}

export const BOUNTYMESH_REP_PROGRAM = BOUNTYMESH_REP_PROGRAM_ID;
