//! FeedsService — track-aware demand telegraph.
//!
//! Trust model: open caller. Anyone may signal demand. Every signal is
//! identified by `msg::source()` on the emitted event so consumers can
//! filter by issuer. The contract NEVER LOCKS VALUE — any `msg::value()`
//! attached to a PostBoosted call is refunded atomically on the reply
//! via `CommandReply::with_value(value)`.
//!
//! The cross-program call to bountymesh.Bounty/Post lives in the caller's
//! workflow, not in this contract. This keeps the telegraph cheap, safe,
//! and free of chain-side cross-program-call complexity. A future feeds
//! v2 may add a `PostAndForward` method that escrows + cross-program-calls
//! bountymesh in a single tx — see the Phase 1 design note.

use sails_rs::{cell::RefCell, gstd::{exec, msg}, prelude::*};

use crate::errors::Error;
use crate::events::Event;
use crate::state::{FeedsState, TrackEnum};

const MIN_MULTIPLIER_BPS: u16 = 5_000;
const MAX_MULTIPLIER_BPS: u16 = 20_000;
const BPS_DENOM: u128 = 10_000;

pub struct FeedsService<'a> {
    state: &'a RefCell<FeedsState>,
}

impl<'a> FeedsService<'a> {
    pub fn new(state: &'a RefCell<FeedsState>) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = Event)]
impl FeedsService<'_> {
    /// Signal hiring demand for a track with a reward + boost multiplier.
    ///
    /// Multiplier is in basis points: 10_000 = 1.0x, 15_000 = 1.5x,
    /// 5_000 = 0.5x, 20_000 = 2.0x. Outside [5_000, 20_000] → Err.
    ///
    /// Any `msg::value()` is refunded atomically on the reply. Use this
    /// method to broadcast intent; follow up with bountymesh.Bounty/Post
    /// to actually escrow.
    #[export]
    pub fn post_boosted(
        &mut self,
        track: TrackEnum,
        base_reward_atomic: u128,
        multiplier_bps: u16,
    ) -> CommandReply<Result<u128, Error>> {
        let value = msg::value();
        let source = msg::source();

        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }
        if base_reward_atomic == 0 {
            return CommandReply::new(Err(Error::InvalidReward)).with_value(value);
        }
        if multiplier_bps < MIN_MULTIPLIER_BPS || multiplier_bps > MAX_MULTIPLIER_BPS {
            return CommandReply::new(Err(Error::InvalidMultiplier)).with_value(value);
        }

        let effective_atomic = base_reward_atomic
            .saturating_mul(multiplier_bps as u128)
            / BPS_DENOM;

        {
            let mut state = self.state.borrow_mut();
            state.total_signals = state.total_signals.saturating_add(1);
            state.total_effective_atomic = state
                .total_effective_atomic
                .saturating_add(effective_atomic);
            *state.track_demand.entry(track).or_insert(0) += 1;
        }

        let _ = self.emit_event(Event::BoostedSignal {
            track,
            base_reward_atomic,
            multiplier_bps,
            effective_atomic,
            by: source,
        });

        CommandReply::new(Ok(effective_atomic)).with_value(value)
    }

    /// Read the per-track demand counter. Returns 0 for any track that's
    /// never been signalled.
    #[export]
    pub fn get_track_demand(&self, track: TrackEnum) -> u32 {
        self.state
            .borrow()
            .track_demand
            .get(&track)
            .copied()
            .unwrap_or(0)
    }

    /// Aggregate counters: (total_signals, total_effective_atomic).
    /// Useful for /stats — a single read returns the headline metric.
    #[export]
    pub fn get_total_routed(&self) -> (u32, u128) {
        let s = self.state.borrow();
        (s.total_signals, s.total_effective_atomic)
    }

    /// Pinned bountymesh deployment this telegraph is scoped to.
    /// Off-chain consumers verify before relying on signals.
    #[export]
    pub fn get_bountymesh_program_id(&self) -> ActorId {
        self.state.borrow().bountymesh_program_id
    }
}
