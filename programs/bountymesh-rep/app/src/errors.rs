use sails_rs::prelude::*;

#[derive(Encode, Decode, TypeInfo, Clone, Copy, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Error {
    /// The (worker, bounty_id) pair has already been recorded. A bounty can
    /// only carry one outcome (Completion XOR Rejection); subsequent calls
    /// referencing the same pair are rejected to prevent score inflation.
    AlreadyRecorded,
}
