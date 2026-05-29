//! BountyMesh on-chain state model — PRD §5.3, field order locked.
//!
//! Reachable status variants this session: Open, Claimed, Submitted, Accepted.
//! Cancelled/Rejected/TimedOut/Revoked are declared (forward-compat per
//! operator decision at Step 4) but no method transitions into them yet.

use sails_rs::prelude::*;
use sails_rs::collections::BTreeMap;

pub type BountyId = u64;

pub const MAX_TITLE_LEN: usize = 200;
pub const MAX_DESCRIPTION_LEN: usize = 2_000;
pub const MAX_ACCEPTANCE_LEN: usize = 1_000;
pub const MAX_RESULT_PAYLOAD_LEN: usize = 5_000;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum TrackEnum {
    Services,
    Social,
    Economy,
    Open,
}

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum BountyStatus {
    Open,
    Claimed,
    Submitted,
    Accepted,
    Rejected,
    Cancelled,
    TimedOut,
    Revoked,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Bounty {
    pub id: BountyId,
    pub poster: ActorId,
    pub worker: Option<ActorId>,
    pub title: String,
    pub description: String,
    pub acceptance: String,
    pub reward: u128,
    pub deadline: Option<u32>,
    pub track: TrackEnum,
    pub status: BountyStatus,
    pub posted_at: u32,
    pub claimed_at: Option<u32>,
    pub submitted_at: Option<u32>,
    pub settled_at: Option<u32>,
    pub result_payload: Option<String>,
    pub result_hash: Option<H256>,
    pub withdrawn: bool,
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Config {
    pub min_reward: u128,
    pub protocol_fee_bps: u16,
    pub auto_settle_blocks: u32,
    pub paused: bool,
}

pub struct BountyMeshState {
    pub bounties: BTreeMap<BountyId, Bounty>,
    pub next_id: BountyId,
    pub bounties_by_status: BTreeMap<BountyStatus, Vec<BountyId>>,
    pub bounties_by_poster: BTreeMap<ActorId, Vec<BountyId>>,
    pub bounties_by_worker: BTreeMap<ActorId, Vec<BountyId>>,
    pub bounties_by_track: BTreeMap<TrackEnum, Vec<BountyId>>,
    pub config: Config,
    pub owner: ActorId,
}

impl BountyMeshState {
    pub fn new(owner: ActorId, min_reward: u128, auto_settle_blocks: u32) -> Self {
        Self {
            bounties: BTreeMap::new(),
            next_id: 0,
            bounties_by_status: BTreeMap::new(),
            bounties_by_poster: BTreeMap::new(),
            bounties_by_worker: BTreeMap::new(),
            bounties_by_track: BTreeMap::new(),
            config: Config {
                min_reward,
                protocol_fee_bps: 0,
                auto_settle_blocks,
                paused: false,
            },
            owner,
        }
    }
}
