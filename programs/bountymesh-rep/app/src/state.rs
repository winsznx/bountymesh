//! Reputation registry on-chain state. Field order locked at deploy.

use sails_rs::collections::BTreeMap;
use sails_rs::prelude::*;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ReputationScore {
    pub bounties_completed: u32,
    pub bounties_rejected: u32,
    pub total_earned: u128,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum RecordKind {
    Completion,
    Rejection,
}

#[derive(Default)]
pub struct RepState {
    /// (worker, bounty_id) → outcome. Dedupe guard: a bounty has at most one
    /// recorded outcome. The first writer wins; later writers get
    /// `Error::AlreadyRecorded`.
    pub recorded: BTreeMap<(ActorId, u64), RecordKind>,
    /// worker → aggregate score. Materialised at write time so reads are O(1).
    pub scores: BTreeMap<ActorId, ReputationScore>,
}
