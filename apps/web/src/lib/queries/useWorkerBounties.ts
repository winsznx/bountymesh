"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { WORKER_BOUNTIES } from "@/lib/graphql/queries";
import {
  parseBounty,
  type Bounty,
  type BountyWire,
} from "@/lib/graphql/types";

interface WorkerBountiesResponse {
  allBounties: {
    totalCount: number;
    nodes: BountyWire[];
  };
}

export interface UseWorkerBountiesResult {
  bounties: Bounty[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
}

/**
 * All bounties this worker has claimed (status >= Claimed, by worker filter).
 * Returns parsed Bounty[] in postedAt DESC order.
 */
export function useWorkerBounties(worker: string | null): UseWorkerBountiesResult {
  const query = useQuery({
    queryKey: ["worker-bounties", worker],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<WorkerBountiesResponse>(WORKER_BOUNTIES, {
        worker,
      });
    },
    enabled: !!worker,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  return {
    bounties: query.data?.allBounties.nodes.map(parseBounty) ?? [],
    totalCount: query.data?.allBounties.totalCount ?? 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
