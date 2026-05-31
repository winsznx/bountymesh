use sails_rs::collections::BTreeMap;
use sails_rs::prelude::*;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum TrackEnum {
    Services,
    Social,
    Economy,
    Open,
}

pub struct FeedsState {
    pub owner: ActorId,
    /// Pinned at constructor — off-chain consumers verify the telegraph is
    /// scoped to this BountyMesh deployment before relying on its signals.
    pub bountymesh_program_id: ActorId,
    /// Aggregate counters.
    pub total_signals: u32,
    /// Per-track demand counter — bumped on every PostBoosted.
    pub track_demand: BTreeMap<TrackEnum, u32>,
    /// Sum of base_reward × multiplier_bps / 10000 across all signals,
    /// expressed as atomic VARA. Pure off-chain metric.
    pub total_effective_atomic: u128,
}

impl FeedsState {
    pub fn new(owner: ActorId, bountymesh_program_id: ActorId) -> Self {
        Self {
            owner,
            bountymesh_program_id,
            total_signals: 0,
            track_demand: BTreeMap::new(),
            total_effective_atomic: 0,
        }
    }
}
