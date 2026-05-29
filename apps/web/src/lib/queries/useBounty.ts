"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { BOUNTY_BY_ID } from "@/lib/graphql/queries";
import {
  parseBounty,
  type Bounty,
  type BountyByIdResponse,
} from "@/lib/graphql/types";

export interface UseBountyResult {
  bounty: Bounty | null;
  isLoading: boolean;
  error: Error | null;
}

export function useBounty(id: bigint | null): UseBountyResult {
  const query = useQuery({
    queryKey: ["bounty", id?.toString() ?? null],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<BountyByIdResponse>(BOUNTY_BY_ID, {
        id: id!.toString(),
      });
    },
    enabled: id !== null,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  return {
    bounty: query.data?.bountyById ? parseBounty(query.data.bountyById) : null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
