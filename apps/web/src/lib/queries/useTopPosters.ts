"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { LIST_BOUNTIES } from "@/lib/graphql/queries";
import type { ListBountiesResponse } from "@/lib/graphql/types";

export interface PosterStat {
  poster: string;
  bountyCount: number;
  totalEscrowed: bigint;
}

export interface UseTopPostersResult {
  posters: PosterStat[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Top posters by bounty count. Aggregated client-side from the bounty list —
 * fine for current scale (every bounty fits in a 1000-node page). When the
 * indexer grows past that, swap for a server-side aggregate query.
 */
export function useTopPosters(limit = 10): UseTopPostersResult {
  const query = useQuery({
    queryKey: ["top-posters", limit],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<ListBountiesResponse>(LIST_BOUNTIES, {
        first: 1000,
        offset: 0,
        orderBy: ["POSTED_AT_DESC"],
      });
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  if (!query.data) {
    return {
      posters: [],
      isLoading: query.isLoading,
      error: query.error as Error | null,
    };
  }

  interface Bucket {
    poster: string;
    bountyCount: number;
    totalEscrowed: bigint;
  }
  const byPoster = new Map<string, Bucket>();

  for (const node of query.data.allBounties.nodes) {
    const poster = node.poster;
    let bucket = byPoster.get(poster);
    if (!bucket) {
      bucket = { poster, bountyCount: 0, totalEscrowed: 0n };
      byPoster.set(poster, bucket);
    }
    bucket.bountyCount += 1;
    try {
      bucket.totalEscrowed += BigInt(node.reward);
    } catch {
      // malformed reward — skip
    }
  }

  const posters = Array.from(byPoster.values())
    .sort(
      (a, b) =>
        b.bountyCount - a.bountyCount ||
        (b.totalEscrowed > a.totalEscrowed ? 1 : -1),
    )
    .slice(0, limit);

  return {
    posters,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
