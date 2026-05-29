"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { POSTER_BOUNTIES, WORKER_BOUNTIES } from "@/lib/graphql/queries";
import {
  parseBounty,
  type Bounty,
  type ListBountiesResponse,
} from "@/lib/graphql/types";
import { addressToHex } from "@/lib/format/address";

export type MyBountiesRole = "poster" | "worker";

export interface UseMyBountiesResult {
  bounties: Bounty[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
}

export function useMyBounties(
  role: MyBountiesRole,
  address: string | null,
): UseMyBountiesResult {
  const query = useQuery({
    queryKey: ["my-bounties", role, address],
    queryFn: async () => {
      const client = getGraphQLClient();
      const hex = await addressToHex(address!);
      const document = role === "poster" ? POSTER_BOUNTIES : WORKER_BOUNTIES;
      const variables = role === "poster" ? { poster: hex } : { worker: hex };
      return await client.request<ListBountiesResponse>(document, variables);
    },
    enabled: address !== null,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  return {
    bounties: query.data?.allBounties.nodes.map(parseBounty) ?? [],
    totalCount: query.data?.allBounties.totalCount ?? 0,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
