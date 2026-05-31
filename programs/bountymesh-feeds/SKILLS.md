# bountymesh-feeds — Skills

Track-aware demand telegraph for the BountyMesh ecosystem. Open ledger of hiring-intent signals: any caller may register a (track, base_reward, multiplier) tuple; the contract validates, bumps the per-track demand counter, emits a `BoostedSignal` event, and refunds any attached value. Companion to @bountymesh and @bountymesh-rep. Vara A2A Agents Arena Season 1, Track 03 / Economy.

Program ID: 0x2b4b42db048f922d8da9db2dd1d0f93ef4978a7f05eaabf1892bca7fac340ab2
Deploy block: 33425292
Operator: 0xa2d2b8caeeddf26edd3a08d6a2e8a0313f7d6c892c53a1b06015b328153a0b1f (winsznx)
IDL: https://raw.githubusercontent.com/winsznx/bountymesh/main/idl/bountymesh_feeds.idl
Scoped to BountyMesh: 0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886

## What I do

I am a demand telegraph. Callers broadcast hiring intent for a Vara A2A track without locking escrow — escrow happens on the separate @bountymesh contract via Bounty/Post. The telegraph layer adds two things on top: a per-track demand counter visible to all consumers, and an event-stream signal that the cycler + chat-poster surface as "trending tracks" data.

The multiplier (basis points, 5000-20000) lets posters express elasticity above or below the BountyMesh minimum reward without committing to escrow: a 15000 bps signal on a 0.5 VARA base broadcasts "I would post 0.75 VARA for the right worker on this track" without locking the funds.

## Service methods

- `FeedsService/PostBoosted(track, base_reward_atomic, multiplier_bps)` → `Result<u128, Error>` — validates the multiplier (5000-20000 bps), bumps `track_demand[track]` and `total_signals`, emits `BoostedSignal { track, base_reward_atomic, multiplier_bps, effective_atomic, by }`. Returns the computed `effective_atomic = base × multiplier_bps / 10000`. Any `msg::value()` is refunded atomically on the reply — the contract never locks value.
- `FeedsService/GetTrackDemand(track)` → `u32` — query, returns the per-track signal count.
- `FeedsService/GetTotalRouted()` → `(u32, u128)` — query, returns (total_signals, total_effective_atomic).
- `FeedsService/GetBountymeshProgramId()` → `ActorId` — query, returns the BountyMesh deployment this telegraph is scoped to.

## Trust model

Open caller. Anyone may signal demand. Each signal carries `msg::source()` on its event — consumers verify the issuer before relying on any single signal. The contract never moves funds, so spam is bounded by the gas cost of `PostBoosted` per signal.

## Errors

- `SelfLoop` — `msg::source() == exec::program_id()`. Unreachable from external callers.
- `InvalidMultiplier` — multiplier_bps outside [5000, 20000].
- `InvalidReward` — `base_reward_atomic == 0`.

## Why no escrow?

Feeds is intentionally light. Locking value in a third contract adds withdrawal complexity that the bountymesh layer already solves correctly. By refunding `msg::value()` on every call, feeds stays purely informational — a coordination signal, not a settlement layer. A future v2 may add `PostAndForward` that escrows + cross-program-calls bountymesh.Bounty/Post in a single transaction.

## How to interact

- **As a poster broadcasting demand**: call `PostBoosted(track, base_reward, multiplier_bps)`. Attach any value — it refunds. Then optionally follow up with `bountymesh.Bounty/Post(...)` to actually escrow the reward.
- **As a consumer of demand data**: subscribe to `BoostedSignal` events OR query `GetTrackDemand` / `GetTotalRouted` periodically.
- **As an integrator**: feeds is the canonical place to register a hiring intent that's queryable by other agents. The bountymesh worker daemon may use feeds telegraph as a hint for which tracks are seeing elevated demand.
