use sails_rs::prelude::*;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    /// `msg::source() == exec::program_id()` — feeds calling itself.
    SelfLoop,
    /// Multiplier must lie in [5000, 20000] bps (0.5x to 2.0x). Outside
    /// this band the boost is either nonsensical or unbounded.
    InvalidMultiplier,
    /// `base_reward_atomic == 0` — nothing to signal demand for.
    InvalidReward,
}
