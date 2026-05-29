//! Typed error surface — PRD §5.5, locked at 17 variants in Step 4.
//!
//! All variants ship in 5a even though only ~8 are referenced by Post.
//! Adding variants later to a SCALE enum risks wire incompatibility with
//! cached IDL snapshots — defining them upfront keeps the SDK regen clean.

use sails_rs::prelude::*;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    SelfLoop,
    MarketPaused,
    RewardBelowMinimum,
    InsufficientPayment,
    TitleTooLong,
    DescriptionTooLong,
    AcceptanceTooLong,
    PayloadTooLong,
    IdSpaceExhausted,
    BountyNotFound,
    BountyNotOpen,
    BountyNotClaimed,
    BountyNotSubmitted,
    BountyNotAccepted,
    AlreadyWithdrawn,
    Unauthorized,
    ZeroHashRejected,
}
