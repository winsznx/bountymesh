//! Service-level events — PRD §5.4, all five variants declared in 5a.
//!
//! Only BountyPosted is emitted from Post (this step). Remaining variants are
//! declared now so SCALE enum encoding is stable across Steps 5b–5e and the
//! Phase 3 indexer schema can be written once.

use sails_rs::prelude::*;

use crate::state::{BountyId, TrackEnum};

#[sails_rs::event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    BountyPosted {
        // F1: title/description/acceptance/deadline appended AFTER posted_at.
        // SCALE encodes positionally; reorder is a silent wire break per
        // CLAUDE.md "Type drift not caught by snapshot". Existing five fields
        // are NOT reshuffled. New fields go at the end in the order emitted
        // by service.rs Post (F1.1).
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
}
