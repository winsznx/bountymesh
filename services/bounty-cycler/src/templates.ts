/**
 * Bounty templates. Each cycle the cycler renders one template against a
 * runtime context (chain head, sample handle, sample bounty id, ISO clock).
 * The rendered description carries concrete numbers and identifiers so each
 * posted bounty reads as a distinct task rather than a recognizable template.
 *
 * Placeholders supported (substituted at render time):
 *   {{blockHigh}}   — current finalized head, integer
 *   {{blockLow}}    — blockHigh - 1000
 *   {{blockMid}}    — blockHigh - 50_000 (older anchor for diffs)
 *   {{isoNow}}      — ISO-8601 UTC timestamp at cycle start
 *   {{sampleHandle}}— rotating A2A handle (this protocol's peers)
 *   {{sampleBountyId}} — highest known bounty id on bountymesh
 */

export interface BountyTemplate {
  title: string;
  description: string;
  acceptance: string;
}

export interface BountyContext {
  cycleIndex: number;
  blockHigh: number;
  isoNow: string;
  sampleHandle: string;
  sampleBountyId: string;
}

const SAMPLE_HANDLES = [
  'bountymesh-rep',
  'bountymesh-feeds',
  'varabridge',
  'aan-tv',
  'infinite-bounty-v3',
];

export function pickHandle(cycleIndex: number): string {
  return SAMPLE_HANDLES[cycleIndex % SAMPLE_HANDLES.length];
}

export function renderTemplate(tmpl: BountyTemplate, ctx: BountyContext): BountyTemplate {
  const blockLow = Math.max(0, ctx.blockHigh - 1000);
  const blockMid = Math.max(0, ctx.blockHigh - 50_000);
  const subs: Record<string, string> = {
    '{{blockHigh}}': String(ctx.blockHigh),
    '{{blockLow}}': String(blockLow),
    '{{blockMid}}': String(blockMid),
    '{{isoNow}}': ctx.isoNow,
    '{{sampleHandle}}': ctx.sampleHandle,
    '{{sampleBountyId}}': ctx.sampleBountyId,
  };
  const sub = (s: string): string => {
    let out = s;
    for (const [k, v] of Object.entries(subs)) out = out.split(k).join(v);
    return out;
  };
  return {
    title: sub(tmpl.title),
    description: sub(tmpl.description),
    acceptance: sub(tmpl.acceptance),
  };
}

export const BOUNTY_TEMPLATES: BountyTemplate[] = [
  {
    title: 'Summarize Vara mainnet blocks {{blockLow}}–{{blockHigh}}',
    description:
      'Pull headers for blocks {{blockLow}} through {{blockHigh}} from wss://archive-rpc.vara.network (the public RPC only retains ~64 blocks, so the archive endpoint is required for this range). Return extrinsic count, finalised event count, unique signer count, and mean block time across the range. Snapshot taken at {{isoNow}}.',
    acceptance:
      'Submit a JSON object with four keys: extrinsics, events, signers (all integers), and meanBlockSec (a float to 2 decimals).',
  },
  {
    title: 'Diff IdentityCard for @{{sampleHandle}} between blocks {{blockMid}} and {{blockHigh}}',
    description:
      'Query the Vara A2A indexer at https://agents-api.vara.network/graphql for @{{sampleHandle}}\'s IdentityCard as of block {{blockMid}} and again at block {{blockHigh}}. Report field-by-field changes across description, tags, githubUrl, and capabilities.',
    acceptance:
      'Submit a JSON object with keys handle, atBlock (the older snapshot), current (the newer snapshot), and diff. The diff maps each field name to { from, to, changed }.',
  },
  {
    title: 'Generate SCALE encoding for a BountyMesh PostArgs struct',
    description:
      'Using the IDL at https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh.idl, encode the PostArgs value { title: "test", description: "test", acceptance: "test", reward: 500000000000n, deadline: null, track: Services } to SCALE hex per polkadot-js scale-codec semantics. The encoding must round-trip back to the input.',
    acceptance:
      'Submit a single 0x-prefixed hex string with no whitespace. A decoder applied to it must reproduce the input JSON exactly.',
  },
  {
    title: 'Resolve hex AccountId for SS58 kGjDUkLmNGX3iW (poster of bounty #{{sampleBountyId}})',
    description:
      'Convert the Vara SS58 address kGjDUkLmNGX3iW (prefix 137) to its 32-byte hex AccountId using ss58-codec or @polkadot/util-crypto.decodeAddress. Verify by re-encoding the hex back to SS58.',
    acceptance:
      'Submit a JSON object with keys ss58, hex (0x-prefixed 32-byte string), and roundTrip (boolean). The roundTrip flag must be true.',
  },
  {
    title: 'Fetch finalized status for Vara block {{blockHigh}}',
    description:
      'Query wss://archive-rpc.vara.network for the header at block {{blockHigh}}. Return blockNumber, parentHash, stateRoot, and a finalised boolean (compare against the finalized head reported at {{isoNow}}).',
    acceptance:
      'Submit a JSON object with keys blockNumber (integer), parentHash (0x-prefixed hex), stateRoot (0x-prefixed hex), and finalised (boolean).',
  },
  {
    title: 'Decode BountyMesh event payload for bounty #{{sampleBountyId}}',
    description:
      'Fetch the BountyPosted event for bounty id {{sampleBountyId}} from https://api.bountymesh.xyz/graphql (use allBountyEvents filtered by bountyId={{sampleBountyId}} and kind=BountyPosted). Decode the raw SCALE bytes using the IDL at https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh.idl and return the typed event JSON.',
    acceptance:
      'Submit a JSON object shaped as { kind: "BountyPosted", data: { id, poster, reward, title, ... } }. Every decoded field must match the indexer projection exactly.',
  },
  {
    title: 'Compute canonical JSON for envelope of bounty #{{sampleBountyId}}',
    description:
      'Build a delivery envelope { v: 1, bountyId: {{sampleBountyId}}, worker: "0xaa...", submittedAt: 1717200000000, result: { score: 0.87 } } and produce its RFC 8785 canonical-JSON serialization (keys sorted ascending, no insignificant whitespace, UTF-8). Hash the result with sha256 and prefix with 0x.',
    acceptance:
      'Submit a JSON object with keys canonical (the canonical-JSON string) and sha256 (0x-prefixed hash of that string). The hash must follow the BountyMesh result_hash convention.',
  },
  {
    title: 'List Track 03 Economy Applications on Vara A2A as of {{isoNow}}',
    description:
      'Query https://agents-api.vara.network/graphql for allApplications where track="Economy" and status is either "Submitted" or "Approved". Return handle, programId, registeredAt block, and tags. Snapshot taken at {{isoNow}}.',
    acceptance:
      'Submit a JSON array of objects { handle, programId, registeredAt (integer), tags (string array) }. Sort by registeredAt ascending and dedupe by programId.',
  },
  {
    title: 'Find Vara block closest to {{isoNow}}',
    description:
      'Binary-search wss://archive-rpc.vara.network for the finalized block whose timestamp is closest to {{isoNow}}. Return that block\'s number, its finalisedAt timestamp (ISO-8601), and the absolute drift in seconds.',
    acceptance:
      'Submit a JSON object with keys blockNumber (integer), finalisedAt (ISO-8601 UTC string), and driftSeconds (absolute difference, must be at most 6).',
  },
  {
    title: 'Fetch full lifecycle for BountyMesh bounty #{{sampleBountyId}}',
    description:
      'Query https://api.bountymesh.xyz/graphql for bountyById(id: "{{sampleBountyId}}") together with its event timeline. For each event include kind, block number, tx hash, and a decoded payload summary. Use hex addresses, not SS58.',
    acceptance:
      'Submit a JSON object with keys bounty (the bounty record) and events (an array of { kind, block, txHash, payload }). Events must be in chronological order.',
  },
  {
    title: 'Verify sha256 commitment for bounty #{{sampleBountyId}} delivery',
    description:
      'Pull the Submitted bounty #{{sampleBountyId}} from https://api.bountymesh.xyz/graphql, including result_payload and result_hash. Recompute sha256 over canonical-JSON(result_payload) locally and compare against result_hash. Do not trust the indexer\'s value — recompute it yourself.',
    acceptance:
      'Submit a JSON object for bounty {{sampleBountyId}} with keys bountyId, match (boolean), computedHash (0x-prefixed sha256 you computed), and onChainHash (0x-prefixed result_hash from chain).',
  },
  {
    title: 'Translate Vara extrinsic at block {{blockHigh}} index 1 to a one-sentence summary',
    description:
      'Fetch the extrinsic at (block={{blockHigh}}, index=1) from wss://archive-rpc.vara.network and decode it using the runtime metadata for that block. Return a one-sentence English summary plus structured section, method, signer, and args.',
    acceptance:
      'Submit a JSON object with keys summary (a single English sentence at most 140 characters) and details ({ section, method, signer, args }).',
  },
  {
    title: 'Summarize Vara A2A chat activity from block {{blockLow}} to {{blockHigh}}',
    description:
      'Query https://agents-api.vara.network/graphql for all ChatMessage and ChatMention rows where block is between {{blockLow}} and {{blockHigh}} inclusive. Group results by authorHandle. The window covers roughly the 6 hours ending at {{isoNow}}.',
    acceptance:
      'Submit a JSON object keyed by handle. Each value is { sent (integer), mentioned (integer), lastMsgBlock (integer) }. Order keys by sent descending.',
  },
  {
    title: 'Audit BountySubmitted decode for the most recent submission before block {{blockHigh}}',
    description:
      'Find the latest BountySubmitted event at or before block {{blockHigh}} via https://api.bountymesh.xyz/graphql. Fetch the raw event from chain using @gear-js/api against wss://archive-rpc.vara.network. Compare each field and flag any divergence between the indexer projection and the on-chain payload.',
    acceptance:
      'Submit a JSON object with keys txHash, match (boolean), mismatched (array of field names that differ), indexer (the indexer projection), and onChain (the decoded on-chain payload).',
  },
  {
    title: 'Write a 3-line bio for A2A handle @{{sampleHandle}}',
    description:
      'Fetch the @{{sampleHandle}} Application and IdentityCard from https://agents-api.vara.network/graphql. Compose three lines: line 1 is what_i_do (at most 80 chars), line 2 is the top two capability tags joined with " · ", line 3 is "since block {{blockHigh}} · N mentions" where N is mentionCount from the indexer.',
    acceptance:
      'Submit a three-line plain-text bio. No markdown. No leading or trailing whitespace. Each line at most 80 characters.',
  },
  {
    title: 'Recompute envelope sha256 for bounty #{{sampleBountyId}}',
    description:
      'Bounty #{{sampleBountyId}} on BountyMesh stores result_payload as the literal canonical-JSON string. Fetch it from https://api.bountymesh.xyz/graphql, recompute sha256 over the payload, and compare to result_hash on chain.',
    acceptance:
      'Submit a JSON object for bounty {{sampleBountyId}} with keys bountyId, match (boolean), computedHash (0x-prefixed sha256 you computed), and onChainHash (0x-prefixed result_hash from chain).',
  },
  {
    title: 'Compute Vara block time across {{blockLow}} → {{blockHigh}}',
    description:
      'Pull headers for the 1001-block window from {{blockLow}} through {{blockHigh}} from wss://archive-rpc.vara.network. Compute the mean, min, and max inter-block interval in seconds, each to 2-decimal precision. Snapshot taken at {{isoNow}}.',
    acceptance:
      'Submit a JSON object with keys meanSec, minSec, maxSec (all floats to 2 decimals), and sampleSize (must equal 1001).',
  },
  {
    title: 'Rank workers on BountyMesh by submission count up to block {{blockHigh}}',
    description:
      'Query https://api.bountymesh.xyz/graphql for distinct workers across all BountySubmitted events at or before block {{blockHigh}}. Group by worker address, count distinct bountyIds, and return the top 20 by submission count.',
    acceptance:
      'Submit a JSON array of objects { address (0x-prefixed hex), submitCount (integer), distinctBounties (integer), lastActiveBlock (integer) }. Sort by submitCount descending. At most 20 entries.',
  },
  {
    title: 'Diff @{{sampleHandle}}\'s IdentityCard at block {{blockMid}} vs {{blockHigh}}',
    description:
      'Fetch the IdentityCard for @{{sampleHandle}} from https://agents-api.vara.network/graphql at block {{blockMid}} and again at block {{blockHigh}}. Return a field-level diff showing which fields changed (with from/to values) and which were unchanged.',
    acceptance:
      'Submit a JSON object for handle {{sampleHandle}} with keys handle, atBlock (the older snapshot), current (the newer snapshot), and diff. The diff maps each field name to { from, to, changed }.',
  },
  {
    title: 'Recover canonical envelope JSON from bounty #{{sampleBountyId}} on-chain payload',
    description:
      'BountyMesh stores result_payload as the canonical-JSON serialization of the delivery envelope. Pull bounty #{{sampleBountyId}} from https://api.bountymesh.xyz/graphql, pretty-print the canonical JSON for human reading, and report whether sha256 over the canonical string matches the on-chain result_hash.',
    acceptance:
      'Submit a JSON object for bounty {{sampleBountyId}} with keys bountyId, prettyPrinted (the human-readable JSON), sha256Match (boolean), and hashedString (the exact canonical string that was hashed).',
  },
  {
    title: 'Score @{{sampleHandle}} against the Track 03 Economy rubric at {{isoNow}}',
    description:
      'Fetch on-chain metrics for @{{sampleHandle}} (chatPosts, chatMentions, integrationsIn, registeredAt) from https://agents-api.vara.network/graphql. Apply the Track 03 / Economy & Markets scoring rubric across visibility (0-100), integration depth (0-100), and activity (0-100). Output a composite 0-100 score plus the breakdown.',
    acceptance:
      'Submit a JSON object for handle {{sampleHandle}} with keys handle, score (integer 0 to 100), and breakdown ({ visibility, integration, activity }, each 0 to 100).',
  },
  {
    title: 'Cluster Vara A2A Applications by tag overlap as of block {{blockHigh}}',
    description:
      'Query https://agents-api.vara.network/graphql for all Applications and their capability tags as observed at block {{blockHigh}}. Compute pairwise Jaccard similarity over the tag sets and return clusters of two or more handles whose pairwise similarity is at least 0.5.',
    acceptance:
      'Submit a JSON array of clusters. Each cluster has { clusterId (integer), handles (string array), sharedTags (string array) }. Each cluster must contain at least 2 handles.',
  },
  {
    title: 'Build Subscan-linked timeline for BountyMesh bounty #{{sampleBountyId}}',
    description:
      'For bounty #{{sampleBountyId}} on https://api.bountymesh.xyz/graphql, fetch every lifecycle event (Posted, Claimed, Submitted, Accepted, Withdrawn, or any terminal variant). For each event attach a Subscan URL of the form https://vara.subscan.io/extrinsic/{txHash} plus a one-line payload summary.',
    acceptance:
      'Submit a JSON array of timeline entries. Each entry has { kind, block (integer), ts (ISO-8601 UTC), subscanUrl (https://vara.subscan.io/...), payloadSummary (short string) }.',
  },
  {
    title: 'Find near-duplicate Open BountyMesh bounties as of block {{blockHigh}}',
    description:
      'Pull all Open bounties (status=Open) from https://api.bountymesh.xyz/graphql at or before block {{blockHigh}}. Compute pairwise title similarity using Levenshtein ratio or trigram cosine. Return only the pairs whose similarity is at least 0.80.',
    acceptance:
      'Submit a JSON array of duplicate-pair objects. Each item has idA, idB, titleA, titleB, and similarity (a float between 0.80 and 1.00). Sort by similarity descending.',
  },
];
