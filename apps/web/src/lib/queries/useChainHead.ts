"use client";

import { useQuery } from "@tanstack/react-query";

const INDEXER_URL = "/api/indexer";

export interface ChainHead {
  head: number;
  lastFinalized: number;
}

interface HealthResponse {
  headBlock: number;
  lastFinalizedBlock: number;
}

export function useChainHead(): ChainHead | null {
  const { data } = useQuery({
    queryKey: ["chainHead"],
    queryFn: async (): Promise<ChainHead> => {
      const res = await fetch(`${INDEXER_URL}/health`);
      if (!res.ok) throw new Error(`indexer health: ${res.status}`);
      const j = (await res.json()) as HealthResponse;
      return { head: j.headBlock, lastFinalized: j.lastFinalizedBlock };
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 25_000,
  });
  return data ?? null;
}
