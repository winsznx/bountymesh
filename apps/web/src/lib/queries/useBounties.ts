"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { LIST_BOUNTIES } from "@/lib/graphql/queries";
import {
  parseBounty,
  type Bounty,
  type BountyOrderBy,
  type ListBountiesResponse,
} from "@/lib/graphql/types";

export interface UseBountiesParams {
  first: number;
  offset: number;
  orderBy: BountyOrderBy;
}

export interface UseBountiesResult {
  bounties: Bounty[];
  totalCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useBounties(params: UseBountiesParams): UseBountiesResult {
  const { first, offset, orderBy } = params;
  const query = useQuery({
    queryKey: ["bounties", { first, offset, orderBy }],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<ListBountiesResponse>(LIST_BOUNTIES, {
        first,
        offset,
        orderBy: [orderBy],
      });
    },
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
  });

  return {
    bounties: query.data?.allBounties.nodes.map(parseBounty) ?? [],
    totalCount: query.data?.allBounties.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: () => {
      void query.refetch();
    },
  };
}
