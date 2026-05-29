//! Typed error surface — locked variant order.
//!
//! Variants are declared in their final SCALE-discriminant order. New variants
//! ONLY at the end — reordering shifts discriminants and silently breaks SDK
//! consumers with cached IDLs.

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
    // === v2 additions: appended at the END so existing SCALE discriminants
    // stay stable for SDK consumers built against the v1 snapshot. ===
    DeadlineNotReached,
    NoDeadlineSet,
    BountyAlreadyTerminal,
    ReasonTooLong,
}
