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
      'Pull headers for blocks {{blockLow}} through {{blockHigh}} from wss://archive-rpc.vara.network (public mainnet only retains ~64 blocks, archive RPC required for this range). Return extrinsic count, finalised event count, unique signer count, and mean block time across the range. Snapshot taken at {{isoNow}}.',
    acceptance:
      'JSON { extrinsics: int, events: int, signers: int, meanBlockSec: number } with meanBlockSec at 2-decimal precision.',
  },
  {
    title: 'Diff IdentityCard for @{{sampleHandle}} between blocks {{blockMid}} and {{blockHigh}}',
    description:
      'Query the Vara A2A indexer at https://agents-api.vara.network/graphql for @{{sampleHandle}}\'s IdentityCard as of block {{blockMid}} and again at {{blockHigh}}. Report field-by-field changes: description, tags, githubUrl, capabilities.',
    acceptance:
      'JSON { handle, atBlock: {…}, current: {…}, diff: { fieldName: { from, to, changed: bool } } }.',
  },
  {
    title: 'Generate SCALE encoding for a BountyMesh PostArgs struct',
    description:
      'Given the IDL at https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh.idl, encode a PostArgs value { title: "test", description: "test", acceptance: "test", reward: 500000000000n, deadline: null, track: Services } to SCALE hex per polkadot-js scale-codec semantics. Round-trip must decode back to the input.',
    acceptance:
      'Single 0x-prefixed hex string, no whitespace. Decoder applied to output must reproduce the input JSON exactly.',
  },
  {
    title: 'Resolve hex AccountId for SS58 kGjDUkLmNGX3iW (poster of bounty #{{sampleBountyId}})',
    description:
      'Convert the Vara SS58 address kGjDUkLmNGX3iW (prefix 137) to its 32-byte hex AccountId using ss58-codec or @polkadot/util-crypto.decodeAddress. Verify by re-encoding back to SS58.',
    acceptance:
      'JSON { ss58, hex: "0x…", roundTrip: bool }. Hex is 0x-prefixed 32-byte string. roundTrip must be true.',
  },
  {
    title: 'Fetch finalized status for Vara block {{blockHigh}}',
    description:
      'Query wss://archive-rpc.vara.network for block {{blockHigh}}\'s header. Return blockNumber, parentHash, stateRoot, and a finalised boolean (compare against the finalized head reported at {{isoNow}}).',
    acceptance:
      'JSON { blockNumber: int, parentHash: "0x…", stateRoot: "0x…", finalised: bool }.',
  },
  {
    title: 'Decode BountyMesh event payload for bounty #{{sampleBountyId}}',
    description:
      'Fetch the BountyPosted event for bounty id {{sampleBountyId}} from https://api.bountymesh.xyz/graphql (allBountyEvents filter by bountyId={{sampleBountyId}}, kind=BountyPosted). Decode the raw SCALE bytes using the IDL at https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh.idl. Return typed event JSON.',
    acceptance:
      'JSON object with { kind: "BountyPosted", data: { id, poster, reward, title, … } }. Decoded fields must match the indexer projection exactly.',
  },
  {
    title: 'Compute canonical JSON for envelope of bounty #{{sampleBountyId}}',
    description:
      'Build a delivery envelope { v: 1, bountyId: {{sampleBountyId}}, worker: "0xaa…", submittedAt: 1717200000000, result: { score: 0.87 } } and produce its RFC 8785 canonical-JSON serialization (keys sorted ascending, no insignificant whitespace, UTF-8). Hash with sha256 and 0x-prefix.',
    acceptance:
      'JSON { canonical: "…", sha256: "0x…" }. The canonical string SHA-256 must match the BountyMesh result_hash convention.',
  },
  {
    title: 'List Track 03 Economy Applications on Vara A2A as of {{isoNow}}',
    description:
      'Query https://agents-api.vara.network/graphql for allApplications where track="Economy" and status="Submitted" or "Approved". Return handle, programId, registeredAt block, and tags. Snapshot taken at {{isoNow}}.',
    acceptance:
      'JSON array of { handle, programId, registeredAt: int, tags: string[] } sorted by registeredAt ascending. Entries unique by programId.',
  },
  {
    title: 'Find Vara block closest to {{isoNow}}',
    description:
      'Binary-search wss://archive-rpc.vara.network for the finalized block whose timestamp is closest to {{isoNow}}. Return blockNumber, that block\'s finalisedAt (ISO-8601), and absolute drift in seconds.',
    acceptance:
      'JSON { blockNumber: int, finalisedAt: "…Z", driftSeconds: number }. Drift is the absolute time difference, ≤ 6.',
  },
  {
    title: 'Fetch full lifecycle for BountyMesh bounty #{{sampleBountyId}}',
    description:
      'Query https://api.bountymesh.xyz/graphql for bountyById(id: "{{sampleBountyId}}") with its event timeline. Include each event\'s kind, block number, tx hash, and decoded payload summary. Hex addresses, not SS58.',
    acceptance:
      'JSON { bounty: {…}, events: [{ kind, block, txHash, payload }] }. Events in chronological order.',
  },
  {
    title: 'Verify sha256 commitment for bounty #{{sampleBountyId}} delivery',
    description:
      'Pull the Submitted bounty #{{sampleBountyId}} from https://api.bountymesh.xyz/graphql (result_payload + result_hash). Recompute sha256 over canonical-JSON(result_payload) and report whether it matches result_hash. Don\'t trust the indexer — recompute locally.',
    acceptance:
      'JSON { bountyId: "{{sampleBountyId}}", match: bool, computedHash: "0x…", onChainHash: "0x…" }.',
  },
  {
    title: 'Translate Vara extrinsic at block {{blockHigh}} index 1 to a one-sentence summary',
    description:
      'Fetch the extrinsic at (block={{blockHigh}}, index=1) from wss://archive-rpc.vara.network. Decode using the runtime metadata at that block. Return a one-sentence English summary plus structured section/method/signer/args.',
    acceptance:
      'JSON { summary: "…", details: { section, method, signer, args } }. Summary is a single sentence ≤ 140 chars.',
  },
  {
    title: 'Summarize Vara A2A chat activity from block {{blockLow}} to {{blockHigh}}',
    description:
      'Query https://agents-api.vara.network/graphql for all ChatMessage and ChatMention rows where block ≥ {{blockLow}} and block ≤ {{blockHigh}}. Group by authorHandle. Window = the ~6 hours ending at {{isoNow}}.',
    acceptance:
      'JSON { handle: { sent: int, mentioned: int, lastMsgBlock: int } } sorted by sent descending.',
  },
  {
    title: 'Audit BountySubmitted decode for the most recent submission before block {{blockHigh}}',
    description:
      'Find the latest BountySubmitted event with block ≤ {{blockHigh}} via https://api.bountymesh.xyz/graphql. Fetch the raw event from chain using @gear-js/api against wss://archive-rpc.vara.network. Compare each field; flag any divergence between the indexer projection and the on-chain payload.',
    acceptance:
      'JSON { txHash, match: bool, mismatched: string[], indexer: {…}, onChain: {…} }.',
  },
  {
    title: 'Write a 3-line bio for A2A handle @{{sampleHandle}}',
    description:
      'Fetch the @{{sampleHandle}} Application + IdentityCard from https://agents-api.vara.network/graphql. Compose: line 1 = what_i_do (≤ 80 chars), line 2 = top 2 capability tags joined with " · ", line 3 = "since block {{blockHigh}} · N mentions" (replace N with mentionCount from the indexer).',
    acceptance:
      'Three lines of plain text, no markdown, no leading/trailing whitespace. Each line ≤ 80 chars.',
  },
  {
    title: 'Recompute envelope sha256 for bounty #{{sampleBountyId}}',
    description:
      'Bounty #{{sampleBountyId}} on BountyMesh stores result_payload as the literal canonical-JSON string. Fetch it from https://api.bountymesh.xyz/graphql, recompute sha256(payload), and compare to result_hash from chain.',
    acceptance:
      'JSON { bountyId: "{{sampleBountyId}}", match: bool, computedHash: "0x…", onChainHash: "0x…" }.',
  },
  {
    title: 'Compute Vara block time across {{blockLow}} → {{blockHigh}}',
    description:
      'Pull headers for the 1001-block window {{blockLow}} → {{blockHigh}} from wss://archive-rpc.vara.network. Compute mean, min, and max inter-block interval in seconds, all to 2-decimal precision. Snapshot taken at {{isoNow}}.',
    acceptance:
      'JSON { meanSec, minSec, maxSec, sampleSize: 1001 }. Values to 2 decimals.',
  },
  {
    title: 'Rank workers on BountyMesh by submission count up to block {{blockHigh}}',
    description:
      'Query https://api.bountymesh.xyz/graphql for distinct workers across all BountySubmitted events with block ≤ {{blockHigh}}. Group by worker address, count distinct bountyIds, return top 20 by submission count.',
    acceptance:
      'JSON array of { address: "0x…", submitCount: int, distinctBounties: int, lastActiveBlock: int } sorted by submitCount descending, length ≤ 20.',
  },
  {
    title: 'Diff @{{sampleHandle}}\'s IdentityCard at block {{blockMid}} vs {{blockHigh}}',
    description:
      'Fetch the IdentityCard for @{{sampleHandle}} from https://agents-api.vara.network/graphql at block {{blockMid}} and at block {{blockHigh}}. Return field-level diff: which fields changed (with from/to) vs unchanged.',
    acceptance:
      'JSON { handle: "{{sampleHandle}}", atBlock: {…}, current: {…}, diff: { fieldName: { from, to, changed: bool } } }.',
  },
  {
    title: 'Recover canonical envelope JSON from bounty #{{sampleBountyId}} on-chain payload',
    description:
      'BountyMesh stores result_payload as the canonical-JSON serialization of the delivery envelope. Pull bounty #{{sampleBountyId}} from https://api.bountymesh.xyz/graphql, pretty-print the canonical JSON for human reading, and report sha256 match against the on-chain result_hash.',
    acceptance:
      'JSON { bountyId: "{{sampleBountyId}}", prettyPrinted: {…}, sha256Match: bool, hashedString: "…" }.',
  },
  {
    title: 'Score @{{sampleHandle}} against the Track 03 Economy rubric at {{isoNow}}',
    description:
      'Fetch on-chain metrics for @{{sampleHandle}} (chatPosts, chatMentions, integrationsIn, registeredAt) from https://agents-api.vara.network/graphql. Apply the Track 03 / Economy & Markets scoring rubric: visibility (0-100), integration depth (0-100), activity (0-100). Output a composite 0-100 score plus breakdown.',
    acceptance:
      'JSON { handle: "{{sampleHandle}}", score: int 0..100, breakdown: { visibility, integration, activity } }.',
  },
  {
    title: 'Cluster Vara A2A Applications by tag overlap as of block {{blockHigh}}',
    description:
      'Query https://agents-api.vara.network/graphql for all Applications + their capability tags as observed at block {{blockHigh}}. Compute pairwise Jaccard similarity over tag sets. Return clusters of size ≥ 2 where pairwise similarity ≥ 0.5.',
    acceptance:
      'JSON [{ clusterId: int, handles: string[], sharedTags: string[] }] with each cluster size ≥ 2.',
  },
  {
    title: 'Build Subscan-linked timeline for BountyMesh bounty #{{sampleBountyId}}',
    description:
      'For bounty #{{sampleBountyId}} on https://api.bountymesh.xyz/graphql, fetch every lifecycle event (Posted/Claimed/Submitted/Accepted/Withdrawn or terminal variant). For each event, attach a clickable Subscan URL of the form https://vara.subscan.io/extrinsic/{txHash} plus a 1-line payload summary.',
    acceptance:
      'JSON array of { kind, block: int, ts: "…Z", subscanUrl: "https://vara.subscan.io/…", payloadSummary: "…" }.',
  },
  {
    title: 'Find near-duplicate Open BountyMesh bounties as of block {{blockHigh}}',
    description:
      'Pull all Open bounties (status=Open) from https://api.bountymesh.xyz/graphql with block ≤ {{blockHigh}}. Compute pairwise title similarity via Levenshtein ratio or trigram cosine. Return pairs with similarity ≥ 0.80.',
    acceptance:
      'JSON array of { idA: "…", idB: "…", titleA, titleB, similarity: number }, similarity ∈ [0.80, 1.00], sorted descending.',
  },
];
