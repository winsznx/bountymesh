import type { BountyStatus } from "@/components/primitives/StatusPill";
import type { Track } from "@/components/primitives/TrackPill";

export type BountyOrderBy =
  | "POSTED_AT_DESC"
  | "POSTED_AT_ASC"
  | "REWARD_DESC"
  | "REWARD_ASC"
  | "ID_DESC"
  | "ID_ASC";

export interface BountyWire {
  id: string;
  poster: string;
  reward: string;
  track: Track;
  status: BountyStatus;
  withdrawn: boolean;
  title: string;
  description?: string;
  acceptance?: string;
  postedAt: string;
  deadline: string | null;
  worker: string | null;
  resultHash?: string | null;
  postTxHash: string;
  claimTxHash: string | null;
  submitTxHash: string | null;
  acceptTxHash: string | null;
  withdrawTxHash: string | null;
  lastEventBlock: string;
}

export interface Bounty {
  id: bigint;
  poster: string;
  reward: bigint;
  track: Track;
  status: BountyStatus;
  title: string;
  description?: string;
  acceptance?: string;
  postedAt: number;
  deadline: number | null;
  worker: string | null;
  resultHash: string | null;
  postTxHash: string;
  claimTxHash: string | null;
  submitTxHash: string | null;
  acceptTxHash: string | null;
  withdrawTxHash: string | null;
  lastEventBlock: number;
}

export function parseBounty(w: BountyWire): Bounty {
  // Indexer stores status='Accepted' + withdrawn=true (Phase 1 contract:
  // Withdraw is a flag flip, not a status transition). Frontend's
  // BountyStatus enum exposes Withdrawn as its own status per PRD §3 ;
  // derive here.
  const effectiveStatus: BountyStatus =
    w.status === "Accepted" && w.withdrawn ? "Withdrawn" : w.status;
  return {
    ...w,
    id: BigInt(w.id),
    reward: BigInt(w.reward),
    status: effectiveStatus,
    postedAt: Number(w.postedAt),
    deadline: w.deadline === null ? null : Number(w.deadline),
    resultHash: w.resultHash ?? null,
    lastEventBlock: Number(w.lastEventBlock),
  };
}

export interface ListBountiesResponse {
  allBounties: {
    totalCount: number;
    nodes: BountyWire[];
  };
}

export interface BountyByIdResponse {
  bountyById: BountyWire | null;
}

export type BountyEventName =
  | "BountyPosted"
  | "BountyClaimed"
  | "BountySubmitted"
  | "BountyAccepted"
  | "BountyWithdrawn";

export interface BountyEventWire {
  eventUid: string;
  bountyId: string;
  eventName: BountyEventName;
  blockNumber: string;
  blockHash: string;
  txHash: string | null;
  payload: string;
}

export interface BountyEvent {
  eventUid: string;
  bountyId: bigint;
  eventName: BountyEventName;
  blockNumber: number;
  blockHash: string;
  txHash: string | null;
  payload: Record<string, unknown>;
}

export function parseBountyEvent(w: BountyEventWire): BountyEvent {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(w.payload) as Record<string, unknown>;
  } catch {
    payload = { _raw: w.payload, _parseError: true };
  }
  return {
    eventUid: w.eventUid,
    bountyId: BigInt(w.bountyId),
    eventName: w.eventName,
    blockNumber: Number(w.blockNumber),
    blockHash: w.blockHash,
    txHash: w.txHash,
    payload,
  };
}

export interface BountyEventsResponse {
  allBountyEvents: {
    nodes: BountyEventWire[];
  };
}
