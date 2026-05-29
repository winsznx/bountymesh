//! BountyService — Sails service exposing the bounty lifecycle methods.
//!
//! This step (5a) ships only `Post`. Claim/Submit/Accept/Withdraw arrive
//! incrementally in 5b–5e. The IDL surface is additive: each new #[export]
//! method extends the service without changing existing wire shapes.

use sails_rs::{cell::RefCell, gstd::{exec, msg}, prelude::*};

use crate::errors::Error;
use crate::events::Event;
use crate::state::{
    Bounty, BountyId, BountyMeshState, BountyStatus, TrackEnum,
    MAX_ACCEPTANCE_LEN, MAX_DESCRIPTION_LEN, MAX_REJECTION_REASON_LEN,
    MAX_RESULT_PAYLOAD_LEN, MAX_TITLE_LEN,
};

pub struct BountyService<'a> {
    state: &'a RefCell<BountyMeshState>,
}

impl<'a> BountyService<'a> {
    pub fn new(state: &'a RefCell<BountyMeshState>) -> Self {
        Self { state }
    }
}

#[sails_rs::service(events = Event)]
impl BountyService<'_> {
    /// Post a new bounty. Payable: `msg::value()` must be >= reward; excess refunded.
    ///
    /// All error branches return `CommandReply::new(Err(...)).with_value(value)` so
    /// the caller's attached value rides back to them on the reply. Per
    /// `agent-paid-service.md` "Critical correctness note": `msg::send_bytes` does
    /// NOT fire on Err returns in sails-rs 0.10 — only the reply carries value atomically.
    #[export]
    pub fn post(
        &mut self,
        title: String,
        description: String,
        acceptance: String,
        reward: u128,
        deadline: Option<u32>,
        track: TrackEnum,
    ) -> CommandReply<Result<BountyId, Error>> {
        let value = msg::value();
        let source = msg::source();

        // Guard order: cheapest checks first, anti-cheat ahead of value checks.
        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        if reward < self.state.borrow().config.min_reward {
            return CommandReply::new(Err(Error::RewardBelowMinimum)).with_value(value);
        }

        if value < reward {
            return CommandReply::new(Err(Error::InsufficientPayment)).with_value(value);
        }

        if title.len() > MAX_TITLE_LEN {
            return CommandReply::new(Err(Error::TitleTooLong)).with_value(value);
        }

        if description.len() > MAX_DESCRIPTION_LEN {
            return CommandReply::new(Err(Error::DescriptionTooLong)).with_value(value);
        }

        if acceptance.len() > MAX_ACCEPTANCE_LEN {
            return CommandReply::new(Err(Error::AcceptanceTooLong)).with_value(value);
        }

        // All guards passed. Allocate id (checked) and commit state.
        let mut state = self.state.borrow_mut();

        let id = state.next_id;
        let Some(next) = state.next_id.checked_add(1) else {
            return CommandReply::new(Err(Error::IdSpaceExhausted)).with_value(value);
        };
        state.next_id = next;

        let posted_at = exec::block_height();

        // Clone owned strings for the emitted event before moving the originals
        // into the Bounty struct. Mirrors the Accept (5d) capture pattern —
        // event-payload locals are sourced before the borrow boundary, not
        // re-read from state after insert. `deadline` is Option<u32> (Copy);
        // no clone needed.
        let event_title = title.clone();
        let event_description = description.clone();
        let event_acceptance = acceptance.clone();

        let bounty = Bounty {
            id,
            poster: source,
            worker: None,
            title,
            description,
            acceptance,
            reward,
            deadline,
            track,
            status: BountyStatus::Open,
            posted_at,
            claimed_at: None,
            submitted_at: None,
            settled_at: None,
            result_payload: None,
            result_hash: None,
            withdrawn: false,
            // v2 fields default to None at Post-time
            cancelled_at: None,
            rejected_at: None,
            timed_out_at: None,
            revoked_at: None,
            rejection_reason: None,
        };

        state.bounties.insert(id, bounty);
        state.bounties_by_status.entry(BountyStatus::Open).or_default().push(id);
        state.bounties_by_poster.entry(source).or_default().push(id);
        state.bounties_by_track.entry(track).or_default().push(id);

        // Drop the borrow before emitting the event (emit_event reads &self,
        // not state, but be defensive — a future event variant might read state).
        drop(state);

        self.emit_event(Event::BountyPosted {
            id,
            poster: source,
            reward,
            track,
            posted_at,
            // F1: title/description/acceptance/deadline appended to the END of
            // the BountyPosted payload (events.rs). SCALE-safe per CLAUDE.md
            // "Type drift not caught by snapshot": adds at the end of the
            // struct don't break the wire shape for prior consumers.
            title: event_title,
            description: event_description,
            acceptance: event_acceptance,
            deadline,
        })
        .expect("event emission must succeed");

        // Excess is refunded atomically on the reply. value - reward is safe
        // because we proved value >= reward above (InsufficientPayment guard).
        let excess = value - reward;
        CommandReply::new(Ok(id)).with_value(excess)
    }

    /// Claim an Open bounty. First wallet wins; second caller gets Err(BountyNotOpen).
    ///
    /// Claim is not payable. Any attached value is refunded defensively via
    /// CommandReply::with_value(value) on both Ok and Err branches.
    #[export]
    pub fn claim(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        // Guard order: cheapest first, anti-cheat ahead of state reads.
        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Open {
            return CommandReply::new(Err(Error::BountyNotOpen)).with_value(value);
        }

        let claimed_at = exec::block_height();
        bounty.worker = Some(source);
        bounty.status = BountyStatus::Claimed;
        bounty.claimed_at = Some(claimed_at);

        // Update index maps: move id out of Open list, into Claimed list, and
        // add to the by_worker map. O(n) on the Open vector — bounded by the
        // count of bounties currently in Open status. See senior-review §1 and
        // AGENT_PROGRESS.md "Known scale debt — Builder Grants v2."
        if let Some(open_list) = state.bounties_by_status.get_mut(&BountyStatus::Open) {
            open_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Claimed)
            .or_default()
            .push(id);
        state
            .bounties_by_worker
            .entry(source)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyClaimed {
            id,
            worker: source,
            claimed_at,
        })
        .expect("event emission must succeed");

        CommandReply::new(Ok(())).with_value(value)
    }

    /// Submit the worker's result payload + hash. Status flips Claimed → Submitted.
    ///
    /// Auth: caller must equal bounty.worker.
    /// Hash invariant: result_hash must be non-zero. All-zero H256 is rejected per
    /// the operator gotcha — workers generate hashes via `openssl dgst -sha256` over
    /// the payload bytes, never with a constant value.
    ///
    /// Submit is not payable. Any attached value is refunded defensively.
    #[export]
    pub fn submit(
        &mut self,
        id: BountyId,
        result_payload: String,
        result_hash: H256,
    ) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        // Guard order: cheapest first, anti-cheat ahead of state, auth before payload validation.
        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Claimed {
            return CommandReply::new(Err(Error::BountyNotClaimed)).with_value(value);
        }

        // bounty.worker is Some by invariant once status == Claimed (set by Claim).
        // Pattern-match handles the impossible-but-defensive None case implicitly.
        if bounty.worker != Some(source) {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        if result_hash == H256::zero() {
            return CommandReply::new(Err(Error::ZeroHashRejected)).with_value(value);
        }

        if result_payload.len() > MAX_RESULT_PAYLOAD_LEN {
            return CommandReply::new(Err(Error::PayloadTooLong)).with_value(value);
        }

        let submitted_at = exec::block_height();
        bounty.result_payload = Some(result_payload);
        bounty.result_hash = Some(result_hash);
        bounty.status = BountyStatus::Submitted;
        bounty.submitted_at = Some(submitted_at);

        // Index maps: id moves out of Claimed list, into Submitted list.
        // by_worker entries stay attached to the worker — Submit doesn't change who.
        if let Some(claimed_list) = state.bounties_by_status.get_mut(&BountyStatus::Claimed) {
            claimed_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Submitted)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountySubmitted {
            id,
            worker: source,
            result_hash,
            submitted_at,
        })
        .expect("event emission must succeed");

        CommandReply::new(Ok(())).with_value(value)
    }

    /// Accept the worker's submission. Poster's wallet-signed acknowledgement.
    ///
    /// Status flips Submitted → Accepted. NO value transfer — the reward stays in
    /// program escrow until the worker pulls it via Withdraw. Two-phase settlement
    /// per the PRD §5.2 redesign: Accept is the poster's signal, Withdraw is the
    /// worker's signal. Both are wallet-signed calls; both count toward the
    /// leaderboard's integrationsIn slice.
    ///
    /// Accept is not payable. Any attached value is refunded defensively.
    #[export]
    pub fn accept(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        // Guard order: cheapest first, anti-cheat ahead of state.
        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Submitted {
            return CommandReply::new(Err(Error::BountyNotSubmitted)).with_value(value);
        }

        if source != bounty.poster {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        let settled_at = exec::block_height();
        bounty.status = BountyStatus::Accepted;
        bounty.settled_at = Some(settled_at);
        // bounty.withdrawn stays false — Withdraw is a separate worker call.

        // Capture event payload values before dropping the borrow. worker is
        // Some by invariant (status was Submitted, which Claim+Submit chained).
        let event_id = id;
        let event_poster = bounty.poster;
        let event_worker = bounty
            .worker
            .expect("status==Submitted implies worker.is_some() by Claim invariant");
        let event_reward = bounty.reward;

        // Index map: id moves out of Submitted list, into Accepted list.
        if let Some(submitted_list) = state.bounties_by_status.get_mut(&BountyStatus::Submitted) {
            submitted_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Accepted)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyAccepted {
            id: event_id,
            poster: event_poster,
            worker: event_worker,
            reward: event_reward,
            settled_at,
        })
        .expect("event emission must succeed");

        CommandReply::new(Ok(())).with_value(value)
    }

    /// Worker pulls the escrowed reward. Two-phase settlement closure.
    ///
    /// Withdraw is the only method that:
    ///   - Does NOT change bounty.status (bounty stays Accepted).
    ///   - Does NOT touch index maps (status doesn't move).
    ///   - DOES flip exactly one field (`bounty.withdrawn`).
    ///   - DOES deliver value to the worker — combined with any defensive refund
    ///     into a single `CommandReply::with_value(value + reward)`.
    ///
    /// Primitive choice: because Withdraw is worker-initiated (msg::source() ==
    /// bounty.worker == reward target), `CommandReply::with_value` is the correct
    /// primitive — it delivers value directly to the caller's balance on the
    /// reply. AutoSettle (caller ≠ target, deferred) would use `msg::send_bytes`
    /// for the same reason inverted. See PRD §8 Escrow integrity.
    ///
    /// Withdraw is not payable, but any attached value is refunded defensively
    /// alongside the reward in a single reply.
    /// Idempotency: a second call returns Err(AlreadyWithdrawn) without moving value.
    #[export]
    pub fn withdraw(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        // Guard order: cheapest first, anti-cheat first, idempotency check last
        // so it costs nothing to repeat for callers who already withdrew.
        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Accepted {
            return CommandReply::new(Err(Error::BountyNotAccepted)).with_value(value);
        }

        // Accepted status is reached only via Claim → Submit → Accept; the Claim step
        // sets worker = Some. .expect documents the invariant for future readers.
        let worker = bounty
            .worker
            .expect("status==Accepted implies worker.is_some() by Claim invariant");

        if source != worker {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        if bounty.withdrawn {
            return CommandReply::new(Err(Error::AlreadyWithdrawn)).with_value(value);
        }

        // Capture event payload locals from state BEFORE drop, per the 5d pattern.
        let event_worker = worker;
        let event_amount = bounty.reward;
        let event_withdrawn_at = exec::block_height();

        // Flip the idempotency flag. If event emission below panics, this rolls
        // back atomically with the queued reply — actor-model rules.
        bounty.withdrawn = true;

        drop(state);

        self.emit_event(Event::BountyWithdrawn {
            id,
            worker: event_worker,
            amount: event_amount,
            withdrawn_at: event_withdrawn_at,
        })
        .expect("event emission must succeed");

        // Combined delivery: defensive refund of any attached value + reward.
        // checked_add documents the invariant (sum cannot overflow because value
        // is bounded by sender's balance and event_amount is bounded by the
        // original Post — neither can exceed u128 at hackathon scale).
        let total = value
            .checked_add(event_amount)
            .expect("withdraw value+reward overflow — impossible at any realistic scale");
        CommandReply::new(Ok(())).with_value(total)
    }

    // ============================================================
    // v2 transition methods — Cancel / Reject / Timeout / Revoke
    // ============================================================
    //
    // Each method matches the same defensive shape as v1:
    //   1. SelfLoop guard first (cheap msg::source() compare)
    //   2. MarketPaused guard
    //   3. Existence / status / auth checks in increasing cost order
    //   4. State mutation (status flip + timestamp + index map move)
    //   5. drop(state) BEFORE emit_event
    //   6. emit_event(...)
    //   7. Return CommandReply::with_value — refund path varies per method

    /// Cancel an Open bounty. Poster-only. Refunds the full escrow + any attached value.
    ///
    /// Status: Open → Cancelled (terminal).
    /// Caller MUST be the original poster.
    /// Refund: caller == value-target (poster), so `CommandReply::with_value(reward + value)`
    /// rides on the reply atomically.
    #[export]
    pub fn cancel(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Open {
            return CommandReply::new(Err(Error::BountyNotOpen)).with_value(value);
        }

        if source != bounty.poster {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        let cancelled_at = exec::block_height();
        let event_refunded = bounty.reward;
        let event_by = source;

        bounty.status = BountyStatus::Cancelled;
        bounty.cancelled_at = Some(cancelled_at);

        // Move out of Open list into Cancelled list.
        if let Some(open_list) = state.bounties_by_status.get_mut(&BountyStatus::Open) {
            open_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Cancelled)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyCancelled {
            id,
            by: event_by,
            refunded: event_refunded,
            cancelled_at,
        })
        .expect("event emission must succeed");

        // Combined delivery: full escrow refund + defensive refund of attached value.
        let total = value
            .checked_add(event_refunded)
            .expect("cancel value+reward overflow — impossible at any realistic scale");
        CommandReply::new(Ok(())).with_value(total)
    }

    /// Reject a Submitted bounty. Poster-only. Refunds the full escrow + any attached value.
    ///
    /// Status: Submitted → Rejected (terminal).
    /// Caller MUST be the original poster.
    /// The optional `reason` (≤ 500 chars) is persisted on-chain for indexer visibility.
    /// Refund: same primitive as Cancel — caller == value-target (poster).
    #[export]
    pub fn reject(
        &mut self,
        id: BountyId,
        reason: Option<String>,
    ) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        if let Some(r) = &reason {
            if r.len() > MAX_REJECTION_REASON_LEN {
                return CommandReply::new(Err(Error::ReasonTooLong)).with_value(value);
            }
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        if bounty.status != BountyStatus::Submitted {
            return CommandReply::new(Err(Error::BountyNotSubmitted)).with_value(value);
        }

        if source != bounty.poster {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        let rejected_at = exec::block_height();
        let event_by = source;
        let event_worker = bounty
            .worker
            .expect("status==Submitted implies worker.is_some() by Claim invariant");
        let event_reward = bounty.reward;
        let event_reason = reason.clone();

        bounty.status = BountyStatus::Rejected;
        bounty.rejected_at = Some(rejected_at);
        bounty.rejection_reason = reason;

        if let Some(sub_list) = state.bounties_by_status.get_mut(&BountyStatus::Submitted) {
            sub_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Rejected)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyRejected {
            id,
            by: event_by,
            worker: event_worker,
            reason: event_reason,
            rejected_at,
        })
        .expect("event emission must succeed");

        // Full escrow refund to poster + defensive refund of attached value.
        let total = value
            .checked_add(event_reward)
            .expect("reject value+reward overflow — impossible at any realistic scale");
        CommandReply::new(Ok(())).with_value(total)
    }

    /// Permissionless watchdog: force a stuck bounty into TimedOut after deadline.
    ///
    /// Status: Open | Claimed | Submitted → TimedOut (terminal).
    /// Caller is anyone — this is the canonical permissionless watchdog pattern.
    /// Deadline MUST be set AND `exec::block_height() > deadline`.
    /// Refund: caller ≠ value-target (poster). Per the primitive rule, escrow is
    /// pushed to poster's mailbox via `msg::send_bytes(poster, [], reward)`;
    /// caller's attached value rides back on the reply via `with_value(value)`.
    /// This is the FIRST `msg::send_bytes` invocation in the contract surface.
    #[export]
    pub fn timeout(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        // Only non-terminal pre-Accept statuses are timeout-eligible. Accepted
        // is a happy-path settlement awaiting worker Withdraw; the four v2
        // terminal statuses (Cancelled/Rejected/TimedOut/Revoked) have already
        // closed the bounty.
        let prior_status = bounty.status;
        match prior_status {
            BountyStatus::Open | BountyStatus::Claimed | BountyStatus::Submitted => {}
            _ => {
                return CommandReply::new(Err(Error::BountyAlreadyTerminal)).with_value(value);
            }
        }

        let Some(deadline) = bounty.deadline else {
            return CommandReply::new(Err(Error::NoDeadlineSet)).with_value(value);
        };

        let current_block = exec::block_height();
        if current_block <= deadline {
            return CommandReply::new(Err(Error::DeadlineNotReached)).with_value(value);
        }

        let timed_out_at = current_block;
        let event_called_by = source;
        let event_poster = bounty.poster;
        let event_reward = bounty.reward;

        bounty.status = BountyStatus::TimedOut;
        bounty.timed_out_at = Some(timed_out_at);

        if let Some(prior_list) = state.bounties_by_status.get_mut(&prior_status) {
            prior_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::TimedOut)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyTimedOut {
            id,
            last_state: prior_status,
            called_by: event_called_by,
            refunded_to: event_poster,
            timed_out_at,
        })
        .expect("event emission must succeed");

        // Push escrow to poster's mailbox — caller ≠ target. Poster (or their
        // wallet) must mailbox_claim to credit the balance.
        // .expect documents the invariant: the runtime only fails send_bytes
        // for OOM or quota exhaustion, neither reachable at hackathon scale.
        msg::send_bytes(event_poster, [], event_reward)
            .expect("timeout escrow push to poster must succeed");

        // Defensive refund of caller's attached value via the reply.
        CommandReply::new(Ok(())).with_value(value)
    }

    /// Owner emergency: forcibly Revoke a bounty in any state.
    ///
    /// Caller MUST be `state.owner` (set immutably at construction).
    /// If bounty has not been withdrawn, escrow is pushed to the original poster.
    /// If bounty has already been withdrawn (Accepted + withdrawn=true), no
    /// escrow movement — status flip only.
    /// Refund: caller (owner) ≠ value-target (poster). Same primitive as Timeout:
    /// `msg::send_bytes` to poster + `with_value(value)` reply refund.
    #[export]
    pub fn revoke(&mut self, id: BountyId) -> CommandReply<Result<(), Error>> {
        let value = msg::value();
        let source = msg::source();

        if source == exec::program_id() {
            return CommandReply::new(Err(Error::SelfLoop)).with_value(value);
        }

        if self.state.borrow().config.paused {
            return CommandReply::new(Err(Error::MarketPaused)).with_value(value);
        }

        // Owner check first — Revoke is owner-only by design.
        if source != self.state.borrow().owner {
            return CommandReply::new(Err(Error::Unauthorized)).with_value(value);
        }

        let mut state = self.state.borrow_mut();

        let Some(bounty) = state.bounties.get_mut(&id) else {
            return CommandReply::new(Err(Error::BountyNotFound)).with_value(value);
        };

        // Idempotency: a second Revoke on the same bounty is a no-op error.
        if bounty.status == BountyStatus::Revoked {
            return CommandReply::new(Err(Error::BountyAlreadyTerminal)).with_value(value);
        }

        let revoked_at = exec::block_height();
        let prior_status = bounty.status;
        let event_poster = bounty.poster;
        let event_by = source;
        // Refund the escrow only if it hasn't already left the contract.
        let escrow_to_refund = if bounty.withdrawn {
            0u128
        } else {
            bounty.reward
        };

        bounty.status = BountyStatus::Revoked;
        bounty.revoked_at = Some(revoked_at);

        if let Some(prior_list) = state.bounties_by_status.get_mut(&prior_status) {
            prior_list.retain(|x| *x != id);
        }
        state
            .bounties_by_status
            .entry(BountyStatus::Revoked)
            .or_default()
            .push(id);

        drop(state);

        self.emit_event(Event::BountyRevoked {
            id,
            by: event_by,
            refunded_to: event_poster,
            revoked_at,
        })
        .expect("event emission must succeed");

        if escrow_to_refund > 0 {
            msg::send_bytes(event_poster, [], escrow_to_refund)
                .expect("revoke escrow push to poster must succeed");
        }

        CommandReply::new(Ok(())).with_value(value)
    }
}
