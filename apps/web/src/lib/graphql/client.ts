import { GraphQLClient } from "graphql-request";

let _client: GraphQLClient | null = null;

/**
 * Same-origin indexer proxy (src/app/api/indexer/[...path]/route.ts).
 *
 * graphql-request validates the endpoint with `new URL()`, which throws on a
 * bare relative path ("/api/indexer/graphql cannot be parsed as a URL"). So we
 * resolve the proxy against the current browser origin to hand it an absolute
 * URL. getGraphQLClient is only ever invoked from client-side queryFns, so
 * `window` is defined; the SSR fallback keeps it from throwing at build time.
 */
function indexerGraphqlEndpoint(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/api/indexer/graphql`;
}

export function getGraphQLClient(): GraphQLClient {
  if (!_client) {
    _client = new GraphQLClient(indexerGraphqlEndpoint(), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return _client;
}

export const INDEXER_BASE_URL = "/api/indexer";
