//! RepService — open reputation ledger.
//!
//! Trust model: open caller. Anyone may call `RecordCompletion` or
//! `RecordRejection`. Each record stamps `msg::source()` as the `recorder`
//! on the emitted event so consumers can attribute and filter. Per
//! identity-card guidance, consumers verify the recorder against a known
//! issuer (e.g. the BountyMesh worker daemon's signing key) before relying
//! on any single record. Spam by unknown recorders is filterable off-chain
//! and self-limiting (every spam call costs the spammer gas).
//!
//! Dedupe: a (worker, bounty_id) pair carries at most one outcome —
//! Completion XOR Rejection. The first writer wins; later writes get
//! `Error::AlreadyRecorded` and do not mutate state.

use sails_rs::{cell::RefCell, gstd::msg, prelude::*};

use crate::errors::Error;
use crate::events::Event;
use crate::state::{RecordKind, ReputationScore, RepState};

pub struct RepService<'a> {
    state: &'a RefCell<RepState>,
}

impl<'a> RepService<'a> {
    pub fn new(state: &'a RefCell<RepState>) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = Event)]
impl RepService<'_> {
    /// Record a completed bounty. Idempotent on (worker, bounty_id).
    #[export(unwrap_result)]
    pub fn record_completion(
        &mut self,
        worker: ActorId,
        bounty_id: u64,
        reward: u128,
    ) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if state.recorded.contains_key(&(worker, bounty_id)) {
            return Err(Error::AlreadyRecorded);
        }
        state.recorded.insert((worker, bounty_id), RecordKind::Completion);
        let entry = state.scores.entry(worker).or_default();
        entry.bounties_completed = entry.bounties_completed.saturating_add(1);
        entry.total_earned = entry.total_earned.saturating_add(reward);
        drop(state);
        let recorder = msg::source();
        let _ = self.emit_event(Event::CompletionRecorded {
            worker,
            bounty_id,
            reward,
            recorder,
        });
        Ok(())
    }

    /// Record a rejected bounty. Idempotent on (worker, bounty_id).
    #[export(unwrap_result)]
    pub fn record_rejection(
        &mut self,
        worker: ActorId,
        bounty_id: u64,
    ) -> Result<(), Error> {
        let mut state = self.state.borrow_mut();
        if state.recorded.contains_key(&(worker, bounty_id)) {
            return Err(Error::AlreadyRecorded);
        }
        state.recorded.insert((worker, bounty_id), RecordKind::Rejection);
        let entry = state.scores.entry(worker).or_default();
        entry.bounties_rejected = entry.bounties_rejected.saturating_add(1);
        drop(state);
        let recorder = msg::source();
        let _ = self.emit_event(Event::RejectionRecorded {
            worker,
            bounty_id,
            recorder,
        });
        Ok(())
    }

    /// Read a worker's aggregate score. Returns the zero-valued default for
    /// workers with no recorded bounties.
    #[export]
    pub fn get_score(&self, worker: ActorId) -> ReputationScore {
        self.state
            .borrow()
            .scores
            .get(&worker)
            .copied()
            .unwrap_or_default()
    }
}
