#![no_std]

use sails_rs::{cell::RefCell, prelude::*};

mod errors;
mod events;
mod service;
mod state;

pub use errors::Error;
pub use events::Event;
pub use service::RepService;
pub use state::{RecordKind, ReputationScore, RepState};

pub struct Program {
    state: RefCell<RepState>,
}

#[sails_rs::program]
impl Program {
    /// Initialize the bountymesh-rep registry.
    ///
    /// Open-caller model: no admin, no owner. Anyone may call RecordCompletion
    /// or RecordRejection. Legitimacy of any single entry comes from the
    /// off-chain caller's program_id (recorder field on each event) — consumers
    /// of the registry verify the recorder before relying on the record.
    pub fn new() -> Self {
        Self {
            state: RefCell::new(RepState::default()),
        }
    }

    pub fn rep_service(&self) -> RepService<'_> {
        RepService::new(&self.state)
    }
}
