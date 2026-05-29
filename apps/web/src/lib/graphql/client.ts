import { GraphQLClient } from "graphql-request";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4350";

let _client: GraphQLClient | null = null;

export function getGraphQLClient(): GraphQLClient {
  if (!_client) {
    _client = new GraphQLClient(`${INDEXER_URL}/graphql`, {
      headers: { "Content-Type": "application/json" },
    });
  }
  return _client;
}

export const INDEXER_BASE_URL = INDEXER_URL;
