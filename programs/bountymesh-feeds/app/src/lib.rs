#![no_std]

use sails_rs::{cell::RefCell, prelude::*};

mod errors;
mod events;
mod service;
mod state;

pub use errors::Error;
pub use events::Event;
pub use service::FeedsService;
pub use state::{FeedsState, TrackEnum};

pub struct Program {
    state: RefCell<FeedsState>,
}

#[sails_rs::program]
impl Program {
    /// Initialize bountymesh-feeds — a demand telegraph.
    ///
    /// Callers signal hiring intent per track + multiplier; the contract
    /// validates, bumps the per-track demand counter, emits an event, and
    /// refunds any attached value back to the caller via `CommandReply::with_value`.
    /// No escrow lock here — the caller follows up with a separate
    /// Bounty/Post call on the bountymesh contract to actually escrow the reward.
    ///
    /// `bountymesh_program_id` is recorded in state for off-chain consumers
    /// that want to verify which BountyMesh deployment this telegraph is
    /// scoped to.
    pub fn new(bountymesh_program_id: ActorId) -> Self {
        let owner = sails_rs::gstd::msg::source();
        Self {
            state: RefCell::new(FeedsState::new(owner, bountymesh_program_id)),
        }
    }

    pub fn feeds_service(&self) -> FeedsService<'_> {
        FeedsService::new(&self.state)
    }
}
