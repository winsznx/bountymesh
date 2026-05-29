"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { STATS_REWARDS, STATS_TOTALS } from "@/lib/graphql/queries";

interface StatsTotalsResponse {
  total: { totalCount: number };
  open: { totalCount: number };
  claimed: { totalCount: number };
  submitted: { totalCount: number };
  accepted: { totalCount: number };
  withdrawn: { totalCount: number };
  rejected: { totalCount: number };
}

interface StatsRewardsResponse {
  allBounties: {
    nodes: Array<{
      id: string;
      reward: string;
      status: string;
      withdrawn: boolean;
    }>;
  };
}

export interface StatsCounts {
  total: number;
  open: number;
  claimed: number;
  submitted: number;
  accepted: number;
  withdrawn: number;
  rejected: number;
}

export interface StatsData {
  counts: StatsCounts;
  totalEscrowed: bigint;
  totalSettled: bigint;
}

const ZERO_COUNTS: StatsCounts = {
  total: 0,
  open: 0,
  claimed: 0,
  submitted: 0,
  accepted: 0,
  withdrawn: 0,
  rejected: 0,
};

export interface UseStatsResult {
  data: StatsData | null;
  isLoading: boolean;
  error: Error | null;
}

export function useStats(): UseStatsResult {
  const totals = useQuery({
    queryKey: ["stats", "totals"],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<StatsTotalsResponse>(STATS_TOTALS);
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const rewards = useQuery({
    queryKey: ["stats", "rewards"],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<StatsRewardsResponse>(STATS_REWARDS);
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const isLoading = totals.isLoading || rewards.isLoading;
  const error = (totals.error ?? rewards.error) as Error | null;

  if (!totals.data || !rewards.data) {
    return {
      data: isLoading ? null : { counts: ZERO_COUNTS, totalEscrowed: 0n, totalSettled: 0n },
      isLoading,
      error,
    };
  }

  const counts: StatsCounts = {
    total: totals.data.total.totalCount,
    open: totals.data.open.totalCount,
    claimed: totals.data.claimed.totalCount,
    submitted: totals.data.submitted.totalCount,
    accepted: totals.data.accepted.totalCount,
    withdrawn: totals.data.withdrawn.totalCount,
    rejected: totals.data.rejected.totalCount,
  };

  // Client-side reward aggregation. Replaced by aggregates.sum.reward at the
  // GraphQL boundary once @graphile-pg-aggregates is installed.
  let totalEscrowed = 0n;
  let totalSettled = 0n;
  for (const b of rewards.data.allBounties.nodes) {
    const reward = BigInt(b.reward);
    if (b.status === "Accepted" && b.withdrawn) {
      totalSettled += reward;
    } else if (
      b.status === "Open" ||
      b.status === "Claimed" ||
      b.status === "Submitted" ||
      (b.status === "Accepted" && !b.withdrawn)
    ) {
      totalEscrowed += reward;
    }
  }

  return {
    data: { counts, totalEscrowed, totalSettled },
    isLoading,
    error,
  };
}
