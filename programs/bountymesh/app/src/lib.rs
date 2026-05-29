#![no_std]

use sails_rs::{cell::RefCell, prelude::*};

mod errors;
mod events;
mod service;
mod state;

pub use errors::Error;
pub use events::Event;
pub use service::BountyService;
pub use state::{
    Bounty, BountyId, BountyMeshState, BountyStatus, Config, TrackEnum,
    MAX_ACCEPTANCE_LEN, MAX_DESCRIPTION_LEN, MAX_RESULT_PAYLOAD_LEN, MAX_TITLE_LEN,
};

pub struct Program {
    state: RefCell<BountyMeshState>,
}

#[sails_rs::program]
impl Program {
    /// Initialize the BountyMesh program.
    ///
    /// Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
    /// protocol_fee_bps = 0 at launch.
    /// paused = false at launch.
    pub fn new(min_reward: u128, auto_settle_blocks: u32) -> Self {
        let owner = sails_rs::gstd::msg::source();
        Self {
            state: RefCell::new(BountyMeshState::new(owner, min_reward, auto_settle_blocks)),
        }
    }

    pub fn bounty_service(&self) -> BountyService<'_> {
        BountyService::new(&self.state)
    }
}
