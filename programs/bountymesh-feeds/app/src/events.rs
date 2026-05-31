use sails_rs::prelude::*;

use crate::state::TrackEnum;

#[sails_rs::event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    /// Caller signalled hiring intent for `track` with a base reward and
    /// a multiplier (basis points). Off-chain consumers (the cycler,
    /// chat-poster, etc.) read these as demand telegraph entries and may
    /// follow up with a real Bounty/Post on the bountymesh contract.
    BoostedSignal {
        track: TrackEnum,
        base_reward_atomic: u128,
        multiplier_bps: u16,
        effective_atomic: u128,
        by: ActorId,
    },
}
