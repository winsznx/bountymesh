"use client";

import { useQuery } from "@tanstack/react-query";
import { getGraphQLClient } from "@/lib/graphql/client";
import { AGENT_DIRECTORY } from "@/lib/graphql/queries";

interface AgentDirectoryResponse {
  allBountyEvents: {
    nodes: Array<{
      eventName: "BountyClaimed" | "BountySubmitted";
      bountyId: string;
      blockNumber: string;
      txHash: string | null;
      payload: string;
    }>;
  };
  allBounties: { totalCount: number };
}

export interface Agent {
  address: string;
  claimCount: number;
  submitCount: number;
  distinctBounties: number;
  firstSeenBlock: number;
  lastActiveBlock: number;
  deliveryRatePct: number;
}

export interface UseAgentsResult {
  agents: Agent[];
  totalEvents: number;
  totalBounties: number;
  isLoading: boolean;
  error: Error | null;
}

export function useAgents(): UseAgentsResult {
  const query = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const client = getGraphQLClient();
      return await client.request<AgentDirectoryResponse>(AGENT_DIRECTORY);
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  if (!query.data) {
    return {
      agents: [],
      totalEvents: 0,
      totalBounties: 0,
      isLoading: query.isLoading,
      error: query.error as Error | null,
    };
  }

  // Group by worker address. payload is jsonb-as-string (PostGraphile drift
  // item #9); JSON.parse at the boundary.
  interface Bucket {
    address: string;
    claimCount: number;
    submitCount: number;
    bounties: Set<bigint>;
    firstSeenBlock: number;
    lastActiveBlock: number;
  }
  const byAddress = new Map<string, Bucket>();

  for (const ev of query.data.allBountyEvents.nodes) {
    let payload: { worker?: string; id?: string };
    try {
      payload = JSON.parse(ev.payload) as { worker?: string; id?: string };
    } catch {
      continue;
    }
    if (typeof payload.worker !== "string") continue;
    const worker = payload.worker;
    const blockNumber = Number(ev.blockNumber);
    let bucket = byAddress.get(worker);
    if (!bucket) {
      bucket = {
        address: worker,
        claimCount: 0,
        submitCount: 0,
        bounties: new Set<bigint>(),
        firstSeenBlock: blockNumber,
        lastActiveBlock: blockNumber,
      };
      byAddress.set(worker, bucket);
    }
    if (ev.eventName === "BountyClaimed") bucket.claimCount += 1;
    if (ev.eventName === "BountySubmitted") bucket.submitCount += 1;
    if (typeof payload.id === "string") {
      try {
        bucket.bounties.add(BigInt(payload.id));
      } catch {
        // ignore malformed id
      }
    }
    if (blockNumber < bucket.firstSeenBlock) bucket.firstSeenBlock = blockNumber;
    if (blockNumber > bucket.lastActiveBlock) bucket.lastActiveBlock = blockNumber;
  }

  const agents: Agent[] = Array.from(byAddress.values())
    .map((b) => ({
      address: b.address,
      claimCount: b.claimCount,
      submitCount: b.submitCount,
      distinctBounties: b.bounties.size,
      firstSeenBlock: b.firstSeenBlock,
      lastActiveBlock: b.lastActiveBlock,
      deliveryRatePct:
        b.claimCount === 0
          ? 0
          : Math.min(100, Math.round((b.submitCount / b.claimCount) * 100)),
    }))
    .sort((a, b) => b.submitCount - a.submitCount);

  return {
    agents,
    totalEvents: query.data.allBountyEvents.nodes.length,
    totalBounties: query.data.allBounties.totalCount,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
