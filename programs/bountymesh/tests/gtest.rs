//! BountyMesh gtest harness — Step 5a: Post + foundation.
//!
//! Coverage this file (5a):
//!   - post_happy_path                  : Ok(id), BountyPosted emitted, escrow == reward
//!   - post_below_min_reward_refunds    : Err(RewardBelowMinimum), escrow unchanged
//!   - post_title_too_long_refunds      : Err(TitleTooLong), escrow unchanged
//!
//! Substitution note (per agent-paid-service.md line 144):
//! `post_self_loop_refunds` is not testable in the standard gtest harness because
//! `gtest::System` panics with "Sending messages allowed only from users id" when
//! `with_actor_id(program_id)` is used. The self-loop branch IS exercised by
//! production program-to-self call shape and is covered defensively by
//! `if source == exec::program_id()` in service.rs::post. We substitute a
//! different typed-error-with-refund path (TitleTooLong) which fires the same
//! `CommandReply::with_value(value)` codepath.

use bountymesh::WASM_BINARY;
use bountymesh_client::{
    BountymeshClient as _,
    BountymeshClientCtors as _,
    BountymeshClientProgram,
    Error,
    TrackEnum,
    bounty_service::{BountyService as _, events::BountyServiceEvents},
};
use sails_rs::{
    ActorId, H256,
    client::{Actor, BlockRunMode, GearEnv as _, GtestEnv},
    futures::StreamExt as _,
    gtest::*,
};

const WORKER_A: u64 = 43;
const WORKER_B: u64 = 44;

const POSTER_ID: u64 = 42;
const MIN_REWARD: u128 = 100_000_000_000; // 0.1 VARA
const AUTO_SETTLE_BLOCKS: u32 = 50_400;
const INITIAL_BALANCE: u128 = 100_000_000_000_000; // 100 VARA

/// Deploy a fresh BountyMesh program for a single test.
/// Returns (env, program, program_initial_balance_after_deploy).
async fn bootstrap() -> (
    GtestEnv,
    Actor<BountymeshClientProgram, GtestEnv>,
    u128,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(POSTER_ID, INITIAL_BALANCE);

    let code_id = system.submit_code(WASM_BINARY);
    let env = GtestEnv::new(system, POSTER_ID.into());

    let program = env
        .deploy::<BountymeshClientProgram>(code_id, b"bountymesh".to_vec())
        .new(MIN_REWARD, AUTO_SETTLE_BLOCKS)
        .await
        .expect("constructor must succeed");

    let program_initial = env.system().balance_of(program.id());
    (env, program, program_initial)
}

#[tokio::test]
async fn post_happy_path() {
    let (env, program, program_initial) = bootstrap().await;

    let reward: u128 = 1_000_000_000_000; // 1.0 VARA
    let value: u128 = 1_500_000_000_000; // 1.5 VARA — 0.5 excess to verify refund

    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    let result: Result<u64, Error> = svc
        .post(
            "Translate Sails IDL".to_string(),
            "Translate this Sails IDL into TypeScript types.".to_string(),
            "PR opened with generated types; manual review accepted.".to_string(),
            reward,
            None,
            TrackEnum::Services,
        )
        .with_value(value)
        .await
        .expect("call should reach reply");

    assert_eq!(result, Ok(0), "first bounty should have id 0");

    let (_, event) = event_stream
        .next()
        .await
        .expect("BountyPosted event must arrive");
    match event {
        BountyServiceEvents::BountyPosted {
            id,
            poster,
            reward: emitted_reward,
            track,
            ..
        } => {
            assert_eq!(id, 0);
            assert_eq!(poster, POSTER_ID.into());
            assert_eq!(emitted_reward, reward);
            assert_eq!(track, TrackEnum::Services);
        }
        other => panic!("expected BountyPosted, got {:?}", other),
    }

    // Escrow assertion: program balance should grow by exactly the reward.
    // Excess (0.5 VARA) was refunded via CommandReply::with_value(excess).
    let program_final = env.system().balance_of(program.id());
    let escrow_delta = program_final - program_initial;
    assert_eq!(
        escrow_delta, reward,
        "program escrow should equal reward; excess should have been refunded"
    );
}

#[tokio::test]
async fn post_below_min_reward_refunds() {
    let (env, program, program_initial) = bootstrap().await;

    // reward is 1 unit below the configured minimum.
    let reward: u128 = MIN_REWARD - 1;
    let value: u128 = MIN_REWARD - 1;

    let mut svc = program.bounty_service();

    let result: Result<u64, Error> = svc
        .post(
            "Underpriced".to_string(),
            "This bounty's reward is below the configured floor.".to_string(),
            "n/a".to_string(),
            reward,
            None,
            TrackEnum::Open,
        )
        .with_value(value)
        .await
        .expect("call should reach reply");

    assert_eq!(result, Err(Error::RewardBelowMinimum));

    // Escrow must be untouched — value was refunded atomically on the Err reply.
    let program_final = env.system().balance_of(program.id());
    assert_eq!(
        program_final - program_initial,
        0,
        "no value should land in program on Err refund"
    );
}

#[tokio::test]
async fn post_title_too_long_refunds() {
    // Substitutes for post_self_loop_refunds (untestable in gtest, see file header).
    // Exercises the same CommandReply::with_value(value) codepath via a different
    // typed-error branch.
    let (env, program, program_initial) = bootstrap().await;

    let reward: u128 = 1_000_000_000_000;
    let value: u128 = 1_000_000_000_000;
    let oversize_title: String = "a".repeat(bountymesh_app::MAX_TITLE_LEN + 1);

    let mut svc = program.bounty_service();

    let result: Result<u64, Error> = svc
        .post(
            oversize_title,
            "Description fits.".to_string(),
            "Acceptance fits.".to_string(),
            reward,
            None,
            TrackEnum::Open,
        )
        .with_value(value)
        .await
        .expect("call should reach reply");

    assert_eq!(result, Err(Error::TitleTooLong));

    let program_final = env.system().balance_of(program.id());
    assert_eq!(
        program_final - program_initial,
        0,
        "TitleTooLong must refund the full value"
    );
}

// ----------------------------------------------------------------------------
// Step 5b — Claim tests
// ----------------------------------------------------------------------------

/// Helper: bootstrap + post one Open bounty so Claim tests don't repeat the setup.
/// Returns (env, program, bounty_id, reward, program_balance_after_post).
async fn bootstrap_with_open_bounty(
    extra_actors: &[u64],
) -> (
    GtestEnv,
    Actor<BountymeshClientProgram, GtestEnv>,
    u64,
    u128,
    u128,
) {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(POSTER_ID, INITIAL_BALANCE);
    for actor in extra_actors {
        system.mint_to(*actor, INITIAL_BALANCE);
    }

    let code_id = system.submit_code(WASM_BINARY);
    let env = GtestEnv::new(system, POSTER_ID.into());

    let program = env
        .deploy::<BountymeshClientProgram>(code_id, b"bountymesh".to_vec())
        .new(MIN_REWARD, AUTO_SETTLE_BLOCKS)
        .await
        .expect("constructor must succeed");

    let reward: u128 = 1_000_000_000_000;
    let mut svc = program.bounty_service();
    let post_result: Result<u64, Error> = svc
        .post(
            "Claimable bounty".to_string(),
            "Claim-test fixture bounty.".to_string(),
            "Accept any submission.".to_string(),
            reward,
            None,
            TrackEnum::Open,
        )
        .with_value(reward)
        .await
        .expect("post should reach reply");
    let bounty_id = post_result.expect("post must succeed");

    let program_balance = env.system().balance_of(program.id());
    (env, program, bounty_id, reward, program_balance)
}

#[tokio::test]
async fn claim_happy_path() {
    let (_env, program, bounty_id, _reward, _) = bootstrap_with_open_bounty(&[WORKER_A]).await;

    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    let result: Result<(), Error> = svc
        .claim(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("claim should reach reply");

    assert_eq!(result, Ok(()));

    // Event evidence: BountyClaimed is emitted AFTER the state commit per
    // gear-sails-production-patterns.md §10 — so its presence proves the
    // status flip and worker assignment landed atomically.
    let (_, event) = event_stream
        .next()
        .await
        .expect("BountyClaimed event must arrive");
    match event {
        BountyServiceEvents::BountyClaimed {
            id,
            worker,
            claimed_at,
        } => {
            assert_eq!(id, bounty_id);
            assert_eq!(worker, WORKER_A.into());
            assert!(claimed_at >= 1, "claimed_at must be a real block height");
        }
        other => panic!("expected BountyClaimed, got {:?}", other),
    }
}

#[tokio::test]
async fn claim_when_not_open_errs() {
    let (env, program, bounty_id, _reward, program_balance_after_post) =
        bootstrap_with_open_bounty(&[WORKER_A, WORKER_B]).await;

    let mut svc_a = program.bounty_service();
    let first_claim: Result<(), Error> = svc_a
        .claim(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("first claim should reach reply");
    assert_eq!(first_claim, Ok(()));

    // Program balance after a successful Claim should not change — Claim is
    // not payable and no escrow movement happens at this stage.
    let balance_after_first_claim = env.system().balance_of(program.id());
    assert_eq!(
        balance_after_first_claim, program_balance_after_post,
        "Claim must not move escrow"
    );

    // Now WORKER_B tries to claim with a defensive value attached. The
    // service must reject with BountyNotOpen AND refund the full value
    // via CommandReply::with_value(value).
    let attached: u128 = 42;
    let mut svc_b = program.bounty_service();
    let second_claim: Result<(), Error> = svc_b
        .claim(bounty_id)
        .with_actor_id(WORKER_B.into())
        .with_value(attached)
        .await
        .expect("second claim should reach reply");

    assert_eq!(second_claim, Err(Error::BountyNotOpen));

    let balance_after_second_claim = env.system().balance_of(program.id());
    assert_eq!(
        balance_after_second_claim, program_balance_after_post,
        "BountyNotOpen must refund the defensively attached value — program balance unchanged"
    );
}

#[tokio::test]
async fn two_workers_race_first_wins() {
    // Senior-review concern #4: two Claim messages must queue into the same
    // block; first-by-FIFO wins. Path taken: option (a) — typed client via
    // PendingCall::send_for_reply() + BlockRunMode::Manual + run_next_block.
    let (env, program, bounty_id, _reward, _) =
        bootstrap_with_open_bounty(&[WORKER_A, WORKER_B]).await;

    // Switch to Manual mode for the race. Clone env first so we can still
    // read system state through the original (Auto-mode) handle afterwards.
    let env_manual = env.clone().with_block_run_mode(BlockRunMode::Manual);
    let program_manual: Actor<BountymeshClientProgram, GtestEnv> =
        Actor::new(env_manual.clone(), program.id());

    let mut svc_a = program_manual.bounty_service();
    let mut svc_b = program_manual.bounty_service();

    // Queue both messages WITHOUT running blocks (Manual mode).
    let pending_a = svc_a
        .claim(bounty_id)
        .with_actor_id(WORKER_A.into())
        .send_for_reply()
        .expect("WORKER_A send must queue");
    let pending_b = svc_b
        .claim(bounty_id)
        .with_actor_id(WORKER_B.into())
        .send_for_reply()
        .expect("WORKER_B send must queue");

    // Now run ONE block — both messages process in the same block, FIFO order.
    env_manual.run_next_block();

    let result_a: Result<(), Error> = pending_a.await.expect("WORKER_A reply");
    let result_b: Result<(), Error> = pending_b.await.expect("WORKER_B reply");

    assert_eq!(result_a, Ok(()), "first-queued claim must win");
    assert_eq!(
        result_b,
        Err(Error::BountyNotOpen),
        "second-queued claim must err with BountyNotOpen"
    );
}

// ----------------------------------------------------------------------------
// Step 5c — Submit tests
// ----------------------------------------------------------------------------

/// Helper: bootstrap + post + WORKER_A claim, ready for Submit tests.
/// Returns (env, program, bounty_id, reward, program_balance_after_claim).
async fn bootstrap_with_claimed_bounty(
    extra_actors: &[u64],
) -> (
    GtestEnv,
    Actor<BountymeshClientProgram, GtestEnv>,
    u64,
    u128,
    u128,
) {
    // bootstrap_with_open_bounty already mints to POSTER + extras; we pass WORKER_A
    // explicitly so the worker has a balance for the (always defensive) value refund.
    let mut all_extras: Vec<u64> = vec![WORKER_A];
    all_extras.extend_from_slice(extra_actors);
    let (env, program, bounty_id, reward, _balance_after_post) =
        bootstrap_with_open_bounty(&all_extras).await;

    let mut svc = program.bounty_service();
    let claim_result: Result<(), Error> = svc
        .claim(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("claim should reach reply");
    assert_eq!(claim_result, Ok(()), "fixture: WORKER_A claim must succeed");

    let balance_after_claim = env.system().balance_of(program.id());
    (env, program, bounty_id, reward, balance_after_claim)
}

#[tokio::test]
async fn submit_happy_path() {
    let (_env, program, bounty_id, _reward, _) = bootstrap_with_claimed_bounty(&[]).await;

    // Non-zero H256 — first byte set, rest zero is fine (only all-zero is rejected).
    let result_hash = H256::from_low_u64_be(0xc0_ffee);
    let payload = "ipfs://bafy.../result.json".to_string();

    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    let result: Result<(), Error> = svc
        .submit(bounty_id, payload.clone(), result_hash)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("submit should reach reply");

    assert_eq!(result, Ok(()));

    // Event payload is the evidence the state commit landed atomically.
    let (_, event) = event_stream
        .next()
        .await
        .expect("BountySubmitted event must arrive");
    match event {
        BountyServiceEvents::BountySubmitted {
            id,
            worker,
            result_hash: emitted_hash,
            submitted_at,
        } => {
            assert_eq!(id, bounty_id);
            assert_eq!(worker, WORKER_A.into());
            assert_eq!(emitted_hash, result_hash);
            assert!(submitted_at >= 1, "submitted_at must be a real block height");
        }
        other => panic!("expected BountySubmitted, got {:?}", other),
    }
}

#[tokio::test]
async fn submit_zero_hash_rejected() {
    let (env, program, bounty_id, _reward, balance_after_claim) =
        bootstrap_with_claimed_bounty(&[]).await;

    let attached: u128 = 99;
    let zero_hash = H256::zero();
    let payload = "this should never be stored".to_string();

    let mut svc = program.bounty_service();
    let result: Result<(), Error> = svc
        .submit(bounty_id, payload, zero_hash)
        .with_actor_id(WORKER_A.into())
        .with_value(attached)
        .await
        .expect("submit should reach reply");

    assert_eq!(result, Err(Error::ZeroHashRejected));

    // Defensive refund: program balance unchanged from the post-claim baseline.
    let balance_after = env.system().balance_of(program.id());
    assert_eq!(
        balance_after, balance_after_claim,
        "ZeroHashRejected must refund the defensively attached value"
    );

    // Bounty state must be untouched. We can't read it directly (no Discovery
    // service yet), but a second Submit with valid args should still succeed
    // — proving status is still Claimed, no payload landed, hash slot is free.
    let valid_hash = H256::from_low_u64_be(0xfeed);
    let mut svc2 = program.bounty_service();
    let recovery: Result<(), Error> = svc2
        .submit(bounty_id, "valid".to_string(), valid_hash)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("recovery submit should reach reply");
    assert_eq!(
        recovery,
        Ok(()),
        "after a rejected zero-hash submit, the bounty must still be Claimed and submittable"
    );
}

#[tokio::test]
async fn submit_from_non_worker_errs() {
    // WORKER_A claimed in the fixture; WORKER_B tries to submit.
    let (env, program, bounty_id, _reward, balance_after_claim) =
        bootstrap_with_claimed_bounty(&[WORKER_B]).await;

    let attached: u128 = 7;
    let result_hash = H256::from_low_u64_be(0xbad_b0b);
    let payload = "impostor result".to_string();

    let mut svc = program.bounty_service();
    let result: Result<(), Error> = svc
        .submit(bounty_id, payload, result_hash)
        .with_actor_id(WORKER_B.into())
        .with_value(attached)
        .await
        .expect("submit should reach reply");

    assert_eq!(result, Err(Error::Unauthorized));

    // Defensive refund verification.
    let balance_after = env.system().balance_of(program.id());
    assert_eq!(
        balance_after, balance_after_claim,
        "Unauthorized must refund the defensively attached value"
    );
}

// ----------------------------------------------------------------------------
// Step 5d — Accept tests
// ----------------------------------------------------------------------------

/// Helper: bootstrap + post + WORKER_A claim + WORKER_A submit, ready for Accept tests.
/// Returns (env, program, bounty_id, reward, result_hash, program_balance_after_submit).
async fn bootstrap_with_submitted_bounty(
    extra_actors: &[u64],
) -> (
    GtestEnv,
    Actor<BountymeshClientProgram, GtestEnv>,
    u64,
    u128,
    H256,
    u128,
) {
    let (env, program, bounty_id, reward, _balance_after_claim) =
        bootstrap_with_claimed_bounty(extra_actors).await;

    let result_hash = H256::from_low_u64_be(0xc0_ffee);
    let payload = "ipfs://bafy.../result.json".to_string();

    let mut svc = program.bounty_service();
    let submit_result: Result<(), Error> = svc
        .submit(bounty_id, payload, result_hash)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("submit should reach reply");
    assert_eq!(
        submit_result,
        Ok(()),
        "fixture: WORKER_A submit must succeed"
    );

    let balance_after_submit = env.system().balance_of(program.id());
    (
        env,
        program,
        bounty_id,
        reward,
        result_hash,
        balance_after_submit,
    )
}

#[tokio::test]
async fn accept_happy_path() {
    let (env, program, bounty_id, reward, _result_hash, balance_after_submit) =
        bootstrap_with_submitted_bounty(&[]).await;

    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    // Poster is POSTER_ID (the env's default actor) — no with_actor_id needed.
    let result: Result<(), Error> = svc
        .accept(bounty_id)
        .await
        .expect("accept should reach reply");

    assert_eq!(result, Ok(()));

    // Event payload is the evidence the state commit landed atomically.
    // All five fields verified per operator spec.
    let (_, event) = event_stream
        .next()
        .await
        .expect("BountyAccepted event must arrive");
    match event {
        BountyServiceEvents::BountyAccepted {
            id,
            poster,
            worker,
            reward: emitted_reward,
            settled_at,
        } => {
            assert_eq!(id, bounty_id);
            assert_eq!(poster, POSTER_ID.into());
            assert_eq!(worker, WORKER_A.into());
            assert_eq!(emitted_reward, reward);
            assert!(settled_at >= 1, "settled_at must be a real block height");
        }
        other => panic!("expected BountyAccepted, got {:?}", other),
    }

    // Escrow assertion: Accept does NOT transfer the reward. Program balance
    // must equal the post-submit balance exactly (no value moved). This is the
    // PRD §5.6 redesigned gas budget — Accept is "state flip only", Withdraw
    // does the value transfer.
    let balance_after_accept = env.system().balance_of(program.id());
    assert_eq!(
        balance_after_accept, balance_after_submit,
        "Accept must NOT transfer the reward — program balance must be unchanged"
    );
}

#[tokio::test]
async fn accept_from_non_poster_errs() {
    // Impostor: WORKER_B (the bounty's worker is WORKER_A, the poster is POSTER_ID).
    let (env, program, bounty_id, _reward, _result_hash, balance_after_submit) =
        bootstrap_with_submitted_bounty(&[WORKER_B]).await;

    let attached: u128 = 13;
    let mut svc = program.bounty_service();
    let result: Result<(), Error> = svc
        .accept(bounty_id)
        .with_actor_id(WORKER_B.into())
        .with_value(attached)
        .await
        .expect("accept should reach reply");

    assert_eq!(result, Err(Error::Unauthorized));

    let balance_after = env.system().balance_of(program.id());
    assert_eq!(
        balance_after, balance_after_submit,
        "Unauthorized must refund the defensively attached value"
    );

    // Proof-by-recovery: the legitimate poster's Accept should still succeed,
    // proving the rejected impostor call left state untouched.
    let mut svc2 = program.bounty_service();
    let recovery: Result<(), Error> = svc2
        .accept(bounty_id)
        .await
        .expect("recovery accept should reach reply");
    assert_eq!(
        recovery,
        Ok(()),
        "after a rejected non-poster Accept, the bounty must still be Submitted and acceptable"
    );
}

#[tokio::test]
async fn accept_when_not_submitted_errs() {
    // Bounty stays in Claimed status — no Submit has occurred. Poster tries to Accept.
    let (env, program, bounty_id, _reward, balance_after_claim) =
        bootstrap_with_claimed_bounty(&[]).await;

    let attached: u128 = 5;
    let mut svc = program.bounty_service();
    let result: Result<(), Error> = svc
        .accept(bounty_id)
        .with_value(attached)
        .await
        .expect("accept should reach reply");

    assert_eq!(result, Err(Error::BountyNotSubmitted));

    let balance_after = env.system().balance_of(program.id());
    assert_eq!(
        balance_after, balance_after_claim,
        "BountyNotSubmitted must refund the defensively attached value"
    );

    // Proof-by-recovery: after the rejected Accept-on-Claimed, the worker can
    // still Submit normally, confirming state is intact.
    let result_hash = H256::from_low_u64_be(0xfeed);
    let mut svc2 = program.bounty_service();
    let recovery_submit: Result<(), Error> = svc2
        .submit(bounty_id, "ok".to_string(), result_hash)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("recovery submit should reach reply");
    assert_eq!(
        recovery_submit,
        Ok(()),
        "after a rejected Accept-on-Claimed, the bounty must still be Claimed and submittable"
    );
}

// ----------------------------------------------------------------------------
// Step 5e — Withdraw tests
// ----------------------------------------------------------------------------

/// Helper: bootstrap + post + WORKER_A claim + WORKER_A submit + POSTER accept.
/// Returns (env, program, bounty_id, reward, program_balance_after_accept).
async fn bootstrap_with_accepted_bounty(
    extra_actors: &[u64],
) -> (
    GtestEnv,
    Actor<BountymeshClientProgram, GtestEnv>,
    u64,
    u128,
    u128,
) {
    let (env, program, bounty_id, reward, _result_hash, _balance_after_submit) =
        bootstrap_with_submitted_bounty(extra_actors).await;

    let mut svc = program.bounty_service();
    let accept_result: Result<(), Error> = svc
        .accept(bounty_id)
        .await
        .expect("accept should reach reply");
    assert_eq!(accept_result, Ok(()), "fixture: POSTER accept must succeed");

    let balance_after_accept = env.system().balance_of(program.id());
    (env, program, bounty_id, reward, balance_after_accept)
}

#[tokio::test]
async fn withdraw_happy_path() {
    let (env, program, bounty_id, reward, program_balance_after_accept) =
        bootstrap_with_accepted_bounty(&[]).await;

    let worker_a_id: ActorId = WORKER_A.into();
    let worker_balance_before = env.system().balance_of(worker_a_id);

    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    let result: Result<(), Error> = svc
        .withdraw(bounty_id)
        .with_actor_id(worker_a_id)
        .await
        .expect("withdraw should reach reply");

    assert_eq!(result, Ok(()));

    // Event payload assertions — all four fields.
    let (_, event) = event_stream
        .next()
        .await
        .expect("BountyWithdrawn event must arrive");
    match event {
        BountyServiceEvents::BountyWithdrawn {
            id,
            worker,
            amount,
            withdrawn_at,
        } => {
            assert_eq!(id, bounty_id);
            assert_eq!(worker, WORKER_A.into());
            assert_eq!(amount, reward);
            assert!(withdrawn_at >= 1, "withdrawn_at must be a real block height");
        }
        other => panic!("expected BountyWithdrawn, got {:?}", other),
    }

    // Program escrow must DECREASE by exactly the reward.
    let program_balance_after_withdraw = env.system().balance_of(program.id());
    assert_eq!(
        program_balance_after_accept - program_balance_after_withdraw,
        reward,
        "Withdraw must move exactly `reward` out of program escrow"
    );

    // Worker balance must INCREASE by close to reward (minus their own gas).
    // Use strict-monotonic + lower bound: gas for one Withdraw is well under 1 VARA.
    let worker_balance_after = env.system().balance_of(worker_a_id);
    let one_vara: u128 = 1_000_000_000_000;
    assert!(
        worker_balance_after > worker_balance_before,
        "worker balance must have grown"
    );
    let net_gain = worker_balance_after - worker_balance_before;
    assert!(
        net_gain > reward - one_vara && net_gain <= reward,
        "worker net gain {} must be reward {} minus a small gas amount (< 1 VARA)",
        net_gain,
        reward
    );

    // Proof-by-recovery: a second Withdraw must err AlreadyWithdrawn —
    // confirms the withdrawn flag flipped atomically with the value transfer.
    let mut svc2 = program.bounty_service();
    let second: Result<(), Error> = svc2
        .withdraw(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("second withdraw should reach reply");
    assert_eq!(second, Err(Error::AlreadyWithdrawn));
}

#[tokio::test]
async fn withdraw_idempotent_errs() {
    let (env, program, bounty_id, _reward, _balance_after_accept) =
        bootstrap_with_accepted_bounty(&[]).await;

    // First withdraw: succeeds.
    let mut svc = program.bounty_service();
    let first: Result<(), Error> = svc
        .withdraw(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("first withdraw should reach reply");
    assert_eq!(first, Ok(()));

    let program_balance_after_first = env.system().balance_of(program.id());
    let worker_a_id: ActorId = WORKER_A.into();
    let worker_balance_after_first = env.system().balance_of(worker_a_id);

    // Second withdraw: idempotent error, no value movement, defensive refund.
    let attached: u128 = 17;
    let mut svc2 = program.bounty_service();
    let second: Result<(), Error> = svc2
        .withdraw(bounty_id)
        .with_actor_id(WORKER_A.into())
        .with_value(attached)
        .await
        .expect("second withdraw should reach reply");
    assert_eq!(second, Err(Error::AlreadyWithdrawn));

    // Program balance must be unchanged: no additional reward sent.
    let program_balance_final = env.system().balance_of(program.id());
    assert_eq!(
        program_balance_final, program_balance_after_first,
        "AlreadyWithdrawn must NOT move any value out of program"
    );

    // Worker balance must be roughly unchanged: they paid gas for the second
    // (failing) withdraw call, but received no reward. Worker is allowed to
    // have lost a small gas amount; not allowed to have GAINED any.
    let worker_balance_final = env.system().balance_of(worker_a_id);
    assert!(
        worker_balance_final <= worker_balance_after_first,
        "worker must not gain any value on a second (failing) withdraw"
    );
}

#[tokio::test]
async fn withdraw_from_non_worker_errs() {
    // POSTER tries to withdraw worker's reward (impostor scenario #1).
    let (env, program, bounty_id, _reward, balance_after_accept) =
        bootstrap_with_accepted_bounty(&[WORKER_B]).await;

    let attached: u128 = 11;
    let mut svc = program.bounty_service();

    // POSTER_ID is the env's default sender — no with_actor_id needed.
    let result: Result<(), Error> = svc
        .withdraw(bounty_id)
        .with_value(attached)
        .await
        .expect("poster-impostor withdraw should reach reply");
    assert_eq!(result, Err(Error::Unauthorized));

    let balance_after_poster = env.system().balance_of(program.id());
    assert_eq!(
        balance_after_poster, balance_after_accept,
        "Unauthorized (poster) must refund attached value AND not move escrow"
    );

    // Now WORKER_B (arbitrary third party) tries.
    let mut svc_b = program.bounty_service();
    let result_b: Result<(), Error> = svc_b
        .withdraw(bounty_id)
        .with_actor_id(WORKER_B.into())
        .with_value(attached)
        .await
        .expect("third-party-impostor withdraw should reach reply");
    assert_eq!(result_b, Err(Error::Unauthorized));

    let balance_after_third = env.system().balance_of(program.id());
    assert_eq!(
        balance_after_third, balance_after_accept,
        "Unauthorized (third party) must refund and not move escrow"
    );

    // Proof-by-recovery: legitimate WORKER_A withdraw must still succeed —
    // proves bounty.withdrawn is still false and state is intact.
    let mut svc_a = program.bounty_service();
    let recovery: Result<(), Error> = svc_a
        .withdraw(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("worker recovery withdraw should reach reply");
    assert_eq!(
        recovery,
        Ok(()),
        "after rejected impostor calls, the real worker must still be able to withdraw"
    );
}

/// End-to-end demo proof: Post → Claim → Submit → Accept → Withdraw.
///
/// Tracks program escrow balance at every step. The escrow-conservation
/// invariant — program ends at its post-deploy baseline — proves the full
/// lifecycle moves exactly `reward` from poster's wallet to worker's wallet
/// via the program, with no value stuck on-chain at terminal state.
#[tokio::test]
async fn full_cycle_post_claim_submit_accept_withdraw() {
    let system = System::new();
    system.init_logger_with_default_filter("gwasm=debug,gtest=info,sails_rs=debug");
    system.mint_to(POSTER_ID, INITIAL_BALANCE);
    system.mint_to(WORKER_A, INITIAL_BALANCE);

    let code_id = system.submit_code(WASM_BINARY);
    let env = GtestEnv::new(system, POSTER_ID.into());

    let program = env
        .deploy::<BountymeshClientProgram>(code_id, b"bountymesh".to_vec())
        .new(MIN_REWARD, AUTO_SETTLE_BLOCKS)
        .await
        .expect("constructor must succeed");

    // Snapshot baselines after deploy. Program holds its existential deposit only.
    let program_baseline = env.system().balance_of(program.id());

    let reward: u128 = 2_000_000_000_000; // 2 VARA — the "20-bounty cycle" hackathon reference price.

    // ----- Step 1: Post -----
    let mut svc = program.bounty_service();
    let listener = svc.listener();
    let mut event_stream = listener.listen().await.expect("listener should start");

    let bounty_id: u64 = svc
        .post(
            "phase-3-indexer-smoke".to_string(),
            "ingest 5-event lifecycle and assert convergence".to_string(),
            "indexer GraphQL bountyById matches contract state".to_string(),
            reward,
            Some(1_000_000u32),
            TrackEnum::Services,
        )
        .with_value(reward)
        .await
        .expect("post should reach reply")
        .expect("post must return Ok(id)");

    // F1 SCALE roundtrip: assert the 4 new BountyPosted fields decode back to
    // values alice passed. Exhaustive pattern (no `..`) so future event-payload
    // additions fail-compile this test until intentionally extended. The 5
    // pre-F1 fields are covered by post_happy_path + the other 15 gtests; only
    // `id` is asserted here for "this is OUR bounty" sanity.
    let (_, event) = event_stream.next().await.expect("BountyPosted must arrive");
    let BountyServiceEvents::BountyPosted {
        id,
        poster: _,
        reward: _,
        track: _,
        posted_at: _,
        title,
        description,
        acceptance,
        deadline,
    } = event else {
        panic!("expected BountyPosted, got {:?}", event);
    };
    assert_eq!(id, bounty_id);
    assert_eq!(title, "phase-3-indexer-smoke");
    assert_eq!(description, "ingest 5-event lifecycle and assert convergence");
    assert_eq!(acceptance, "indexer GraphQL bountyById matches contract state");
    assert_eq!(deadline, Some(1_000_000u32));

    let program_after_post = env.system().balance_of(program.id());
    assert_eq!(
        program_after_post - program_baseline,
        reward,
        "after Post: program escrow grew by exactly reward"
    );

    // ----- Step 2: Claim -----
    let mut svc = program.bounty_service();
    let claim_result: Result<(), Error> = svc
        .claim(bounty_id)
        .with_actor_id(WORKER_A.into())
        .await
        .expect("claim should reach reply");
    assert_eq!(claim_result, Ok(()));

    let program_after_claim = env.system().balance_of(program.id());
    assert_eq!(
        program_after_claim, program_after_post,
        "after Claim: program escrow unchanged (no value moves)"
    );

    // ----- Step 3: Submit -----
    let result_hash = H256::from_low_u64_be(0xc0_ffee);
    let mut svc = program.bounty_service();
    let submit_result: Result<(), Error> = svc
        .submit(
            bounty_id,
            "ipfs://bafy.../ts-bindings.tar.gz".to_string(),
            result_hash,
        )
        .with_actor_id(WORKER_A.into())
        .await
        .expect("submit should reach reply");
    assert_eq!(submit_result, Ok(()));

    let program_after_submit = env.system().balance_of(program.id());
    assert_eq!(
        program_after_submit, program_after_post,
        "after Submit: program escrow unchanged (no value moves)"
    );

    // ----- Step 4: Accept -----
    let mut svc = program.bounty_service();
    let accept_result: Result<(), Error> = svc
        .accept(bounty_id)
        .await
        .expect("accept should reach reply");
    assert_eq!(accept_result, Ok(()));

    let program_after_accept = env.system().balance_of(program.id());
    assert_eq!(
        program_after_accept, program_after_post,
        "after Accept: program escrow STILL unchanged — Accept does not move value (Withdraw does)"
    );

    // ----- Step 5: Withdraw -----
    let worker_a_id: ActorId = WORKER_A.into();
    let worker_before_withdraw = env.system().balance_of(worker_a_id);

    let mut svc = program.bounty_service();
    let withdraw_result: Result<(), Error> = svc
        .withdraw(bounty_id)
        .with_actor_id(worker_a_id)
        .await
        .expect("withdraw should reach reply");
    assert_eq!(withdraw_result, Ok(()));

    let program_after_withdraw = env.system().balance_of(program.id());
    assert_eq!(
        program_after_withdraw, program_baseline,
        "after Withdraw: program escrow returns to post-deploy baseline (full reward drained)"
    );

    // Worker delta between (just before Withdraw) and (after Withdraw): +reward minus their gas.
    let worker_after_withdraw = env.system().balance_of(worker_a_id);
    let one_vara: u128 = 1_000_000_000_000;
    let worker_delta = worker_after_withdraw - worker_before_withdraw;
    assert!(
        worker_delta > reward - one_vara && worker_delta <= reward,
        "worker delta {} ≈ reward {} (minus a small gas amount)",
        worker_delta,
        reward
    );

    // The demo-proof invariant: 5 wallet-signed calls completed (1 Post by poster,
    // 1 Claim + 1 Submit + 1 Withdraw by worker, 1 Accept by poster). Reward flowed
    // exactly once from poster to worker via on-chain escrow. Program is back to
    // baseline. This is the lifecycle the Loom demo will narrate.
}
