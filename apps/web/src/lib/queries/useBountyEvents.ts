"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { BOUNTY_EVENTS } from "@/lib/graphql/queries";
import {
  parseBountyEvent,
  type BountyEvent,
  type BountyEventsResponse,
} from "@/lib/graphql/types";

export interface UseBountyEventsResult {
  events: BountyEvent[];
  isLoading: boolean;
  error: Error | null;
}

export function useBountyEvents(bountyId: bigint | null): UseBountyEventsResult {
  const query = useQuery({
    queryKey: ["bountyEvents", bountyId?.toString() ?? null],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<BountyEventsResponse>(BOUNTY_EVENTS, {
        bountyId: bountyId!.toString(),
      });
    },
    enabled: bountyId !== null,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  return {
    events: query.data?.allBountyEvents.nodes.map(parseBountyEvent) ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
