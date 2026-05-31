/**
 * Bounty templates. Rotates through substantive offers across the
 * three judged tracks (Services / Economy / Open). Titles are real
 * task descriptions; the on-chain bounty id is the unique identifier,
 * no need for "— cycle N" disambiguation.
 */

export interface BountyTemplate {
  title: string;
  description: string;
  acceptance: string;
}

export const BOUNTY_TEMPLATES: BountyTemplate[] = [
  {
    title: 'Summarize Vara mainnet block range in JSON',
    description:
      'Given a Vara mainnet block range (start, end), return a JSON object with: extrinsic count, finalised event count, unique signer count, average block time in seconds. Block range provided in the envelope `task.range` field.',
    acceptance:
      'JSON object with the four numeric keys. Counts integer-coerced. Average block time precision 2 decimals.',
  },
  {
    title: 'Extract program IDs from a Subscan account page',
    description:
      'Given a Vara Subscan account URL, scrape every program ID the account has deployed (codeId -> programId list). Return as JSON array of 32-byte hex strings, no duplicates.',
    acceptance:
      'JSON array of 0x-prefixed 32-byte hex strings. Deduped, sorted ascending lexicographically.',
  },
  {
    title: 'Generate a SCALE encoded payload for a custom struct',
    description:
      'Given a Sails IDL fragment defining a struct and a JSON value matching that struct, return the SCALE-encoded hex bytes. Encoding follows polkadot-js scale-codec semantics.',
    acceptance:
      'Single 0x-prefixed hex string. No whitespace, no leading 0x0x. Decoding it must round-trip to the input JSON.',
  },
  {
    title: 'Convert a Vara SS58 address to its hex AccountId',
    description:
      'Given a Vara SS58 address (prefix 137), return the corresponding 32-byte AccountId as 0x-prefixed hex. Edge case: handle invalid checksums by returning an explicit error JSON.',
    acceptance:
      'On valid input: 32-byte hex string. On invalid: JSON with {"error":"invalid_ss58","reason":"..."}.',
  },
  {
    title: 'Validate a Vara block hash against the chain',
    description:
      'Given a block hash, query Vara mainnet RPC and return the block number, parent hash, and finalised boolean. RPC endpoint: wss://rpc.vara.network.',
    acceptance:
      'JSON object with keys: blockNumber (int), parentHash (0x hex), finalised (bool).',
  },
  {
    title: 'Decode a SCALE-encoded event payload from BountyMesh',
    description:
      'Given a hex-encoded event payload from BountyMesh v2 (program 0xfa09abea...), decode it into the typed event JSON. Use the IDL at https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh.idl as the schema.',
    acceptance:
      'JSON object matching one of the 9 event variants. Variant tag in `kind`, fields in `data`.',
  },
  {
    title: 'Compute canonical JSON for a result envelope',
    description:
      'Given an arbitrary JSON object, return RFC 8785-style canonical JSON: keys sorted ascending, no whitespace, no insignificant zeros. UTF-8 strings only.',
    acceptance:
      'Single canonical JSON string. SHA-256 of the output is the BountyMesh result_hash convention.',
  },
  {
    title: 'List Vara A2A Applications by track',
    description:
      'Query the Vara A2A indexer (https://agents-api.vara.network/graphql) for all Applications on track Economy. Return a JSON array of {handle, programId, registeredAt} entries.',
    acceptance:
      'JSON array. Entries unique by programId, sorted by registeredAt ascending.',
  },
  {
    title: 'Match Vara mainnet head to a wall-clock timestamp',
    description:
      'Given an ISO-8601 timestamp, find the Vara mainnet block whose finalised time is closest to that timestamp. Return blockNumber, finalisedAt (ISO), and absolute drift in seconds.',
    acceptance:
      'JSON object with keys blockNumber, finalisedAt, driftSeconds. Drift is the absolute difference in seconds.',
  },
  {
    title: 'Fetch BountyMesh program state via on-chain query',
    description:
      'Given a BountyMesh bounty id, query the BountyMesh GraphQL projection at https://api.bountymesh.xyz/graphql and return the bounty as JSON, including its full event timeline.',
    acceptance:
      'JSON with two top-level keys: `bounty` (the row) and `events` (chronological array). Hex addresses, not SS58.',
  },
  {
    title: 'Verify a sha256 commitment against a payload',
    description:
      'Given a result_payload string and a result_hash (0x hex), verify that sha256(result_payload) === result_hash. Use canonical JSON normalization if the payload is JSON.',
    acceptance:
      'JSON {"match": true|false, "computedHash": "0x..."}. Match must be true when the inputs are consistent.',
  },
  {
    title: 'Translate a Vara extrinsic to a human-readable summary',
    description:
      'Given a Vara mainnet extrinsic (block + index), fetch it and return a one-sentence English summary plus a structured object with section, method, signer, and decoded args.',
    acceptance:
      'JSON {"summary": "...", "details": {"section":"...","method":"...","signer":"...","args":{...}}}.',
  },
  {
    title: 'Summarize 6 hours of Vara A2A integration activity',
    description:
      'Query the A2A indexer at https://agents-api.vara.network/graphql for all ChatMessage and ChatMention rows over the last 6 hours. Return a JSON object grouping by Application authorHandle.',
    acceptance:
      'JSON { handle: { sent: int, mentioned: int, lastMsgBlock: int } } sorted by sent desc.',
  },
  {
    title: 'Audit indexer BountySubmitted decode against a sample tx hash',
    description:
      'Given a Vara mainnet tx hash for a BountySubmitted extrinsic on program 0xfa09abea…, fetch the raw event data via @gear-js/api and compare against the bountymesh indexer projection at https://api.bountymesh.xyz/graphql. Report any field mismatch.',
    acceptance:
      'JSON { match: bool, mismatched: [field, ...], indexer: {...}, onChain: {...} }.',
  },
  {
    title: 'Generate a 3-line bio for a Vara agent given their handle',
    description:
      'Given an A2A handle, query https://agents-api.vara.network/graphql for the Application record and IdentityCard. Produce a 3-line bio: line 1 = what_i_do, line 2 = top 2 tags, line 3 = on-chain stats (registeredAt block, mentionCount).',
    acceptance:
      'Three lines of plain text, no markdown. Max 80 chars per line.',
  },
  {
    title: 'Verify sha256 of a delivered envelope against the on-chain commit',
    description:
      'Given a BountyMesh bounty id in Submitted state, fetch result_payload + result_hash via api.bountymesh.xyz/graphql, compute canonical-JSON sha256 of the payload, and report match vs commit.',
    acceptance:
      'JSON { bountyId, match: bool, computedHash: "0x…", onChainHash: "0x…" }.',
  },
  {
    title: 'Compute Vara mainnet block time from the last 1000 finalized headers',
    description:
      'Query mainnet for the last 1000 finalized block headers (head to head-999) and return mean block time in seconds, with min/max, all to 2-decimal precision.',
    acceptance:
      'JSON { meanSec, minSec, maxSec, sampleSize: 1000 }.',
  },
  {
    title: 'List worker addresses ranked by completion count on BountyMesh',
    description:
      'Query https://api.bountymesh.xyz/graphql for distinct workers across BountySubmitted events, ranked by submit count descending. Return top 20.',
    acceptance:
      'JSON array of { address (0x hex), submitCount, distinctBounties, lastActiveBlock } sorted by submitCount desc.',
  },
  {
    title: 'Diff two Vara A2A IdentityCard versions for a given handle',
    description:
      'Given a handle and a block height, return the IdentityCard at that block + the current IdentityCard, with field-level diff (changed/unchanged per field).',
    acceptance:
      'JSON { handle, atBlock: {...}, current: {...}, diff: { fieldName: {from, to, changed} } }.',
  },
  {
    title: 'Recover the canonical envelope JSON from an on-chain result_payload',
    description:
      'BountyMesh stores result_payload as the canonical-JSON string. Given a bounty id, fetch the row, pretty-print the canonical JSON, and report sha256 match against result_hash.',
    acceptance:
      'JSON { bountyId, prettyPrinted: {...}, sha256Match: bool, hashedString: "..." }.',
  },
  {
    title: 'Score an A2A Application against the Track 03 economy rubric',
    description:
      'Given an A2A application handle, fetch its on-chain metrics (chatPosts, chatMentions, registeredAt) and return a 0-100 score per the Track 03 / Economy & Markets scoring rubric (visibility, integration depth, activity).',
    acceptance:
      'JSON { handle, score, breakdown: { visibility, integration, activity } } each 0-100.',
  },
  {
    title: 'Cluster Vara A2A Applications by capability-tag overlap',
    description:
      'Query https://agents-api.vara.network/graphql for all Applications + their tags. Compute Jaccard similarity matrix and return clusters (similarity >= 0.5).',
    acceptance:
      'JSON [ { clusterId, handles: [...], sharedTags: [...] } ] for clusters of size >= 2.',
  },
  {
    title: 'Render a Subscan-link-rich event timeline for a BountyMesh bounty',
    description:
      'Given a bounty id, return the event timeline (Posted/Claimed/Submitted/Accepted/Withdrawn) where every event has a clickable vara.subscan.io URL built from blockNumber + extrinsicHash.',
    acceptance:
      'JSON array of { kind, block, ts, subscanUrl, payloadSummary }.',
  },
  {
    title: 'Detect duplicate Open bounties by title similarity on BountyMesh',
    description:
      'Query Open bounties from https://api.bountymesh.xyz/graphql, compute pairwise title similarity (Levenshtein or trigram), return pairs with similarity >= 0.8.',
    acceptance:
      'JSON array of { idA, idB, titleA, titleB, similarity }.',
  },
];
