//! Service-level events — all variants declared up front.
//!
//! Variants are declared in their final order so SCALE enum encoding is stable
//! and the indexer schema can be written once. New variants only at the end.

use sails_rs::prelude::*;

use crate::state::{BountyId, BountyStatus, TrackEnum};

#[sails_rs::event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    BountyPosted {
        // F1: title/description/acceptance/deadline appended AFTER posted_at.
        // SCALE encodes positionally; reorder is a silent wire break. New
        // fields go at the end in the order emitted by service.rs Post.
        id: BountyId,
        poster: ActorId,
        reward: u128,
        track: TrackEnum,
        posted_at: u32,
        title: String,
        description: String,
        acceptance: String,
        deadline: Option<u32>,
    },
    BountyClaimed {
        id: BountyId,
        worker: ActorId,
        claimed_at: u32,
    },
    BountySubmitted {
        id: BountyId,
        worker: ActorId,
        result_hash: H256,
        submitted_at: u32,
    },
    BountyAccepted {
        id: BountyId,
        poster: ActorId,
        worker: ActorId,
        reward: u128,
        settled_at: u32,
    },
    BountyWithdrawn {
        id: BountyId,
        worker: ActorId,
        amount: u128,
        withdrawn_at: u32,
    },
    // === v2 additions: appended at the END so existing SCALE discriminants
    // stay stable for SDK consumers built against the v1 snapshot. Adding here
    // means the indexer's chain/decode.ts needs new branches; CLAUDE.md type-
    // drift discipline mandates the snapshot bless + drift-check re-runs. ===
    BountyCancelled {
        id: BountyId,
        by: ActorId,
        refunded: u128,
        cancelled_at: u32,
    },
    BountyRejected {
        id: BountyId,
        by: ActorId,
        worker: ActorId,
        reason: Option<String>,
        rejected_at: u32,
    },
    BountyTimedOut {
        id: BountyId,
        last_state: BountyStatus,
        called_by: ActorId,
        refunded_to: ActorId,
        timed_out_at: u32,
    },
    BountyRevoked {
        id: BountyId,
        by: ActorId,
        refunded_to: ActorId,
        revoked_at: u32,
    },
}
