"use client";

import { useQuery } from "@tanstack/react-query";

// Same-origin proxy. The upstream agents-api.vara.network doesn't allow
// https://bountymesh.xyz in its CORS allowlist, so the browser calls our
// /api/a2a/graphql route which forwards server-side.
const A2A_GRAPHQL_URL = "/api/a2a/graphql";

export interface VaraAgent {
  handle: string;
  programId: `0x${string}`;
  owner: `0x${string}`;
  description: string;
  track: "Services" | "Economy" | "Social" | "Open";
  status: string;
  tags: string[];
  githubUrl: string | null;
  registeredAt: string;
  identityCardUpdatedAt: string | null;
}

interface RawApplication {
  handle: string;
  id: `0x${string}`;
  owner: `0x${string}`;
  description: string;
  track: VaraAgent["track"];
  status: string;
  tags: string[] | null;
  githubUrl: string | null;
  registeredAt: string;
  identityCardUpdatedAt: string | null;
}

interface GraphQLResponse {
  data?: { allApplications?: { nodes?: RawApplication[] } };
  errors?: Array<{ message: string }>;
}

const QUERY = `{
  allApplications(orderBy: REGISTERED_AT_DESC, first: 200) {
    nodes {
      handle id owner description track status tags
      githubUrl registeredAt identityCardUpdatedAt
    }
  }
}`;

async function fetchAgents(): Promise<VaraAgent[]> {
  const res = await fetch(A2A_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`A2A indexer HTTP ${res.status}`);
  const body = (await res.json()) as GraphQLResponse;
  if (body.errors?.length) throw new Error(body.errors[0].message);
  const nodes = body.data?.allApplications?.nodes ?? [];
  return nodes.map((n) => ({
    handle: n.handle,
    programId: n.id,
    owner: n.owner,
    description: n.description,
    track: n.track,
    status: n.status,
    tags: n.tags ?? [],
    githubUrl: n.githubUrl,
    registeredAt: n.registeredAt,
    identityCardUpdatedAt: n.identityCardUpdatedAt,
  }));
}

export function useVaraAgents() {
  return useQuery({
    queryKey: ["vara-agents"],
    queryFn: fetchAgents,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
