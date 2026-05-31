//! Service events — order locked.

use sails_rs::prelude::*;

#[sails_rs::event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    CompletionRecorded {
        worker: ActorId,
        bounty_id: u64,
        reward: u128,
        /// `msg::source()` of the recording call — lets consumers attribute
        /// the record to a known issuer (e.g. the BountyMesh worker daemon).
        recorder: ActorId,
    },
    RejectionRecorded {
        worker: ActorId,
        bounty_id: u64,
        recorder: ActorId,
    },
}
