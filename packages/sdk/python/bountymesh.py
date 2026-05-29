"""
BountyMesh Python wrapper — thin shell over vara-wallet for non-TS worker bots.

The heavy lifting (signing, SCALE encoding, decoding) lives in vara-wallet itself.
This module's job is argv construction, JSON parsing, and the same client-side
pre-validation as the TS SDK (zero-hash rejection).

Standard library only. No pip deps.

Verified empirically against vara-wallet 0.19.0 and the BountyMesh contract
(bountymesh.opt.wasm). Response shapes:
  - call: {"txHash","blockHash","blockNumber","messageId","voucherId",
           "result":{"kind":"Ok"|"Err","value":...},"events":[]}
  - watch (NDJSON, one line per event): {"event":"UserMessageSent","decoded":
           {"kind":"sails","service":"BountyService","event":<name>,"data":{...}}, ...}

Hard rules (vara-wallet invocation contract):
  - --units raw is appended whenever --value is set (post only). Without --units raw,
    vara-wallet interprets --value as VARA (decimal), which would balloon a 2-VARA
    reward into 2-trillion VARA. The _call_args helper enforces this.
  - --idl <path> on every call AND watch invocation.
  - subprocess.run(argv, shell=False) — no bash -c, no shell interpolation.
  - Zero-hash pre-check fires before any subprocess; raises ValueError /zero hash/i.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from typing import Any, Callable, Optional


class BountyMeshError(Exception):
    """Logical contract-layer error (one of the 17 typed variants from Error.idl)."""


class TransportError(Exception):
    """Subprocess / RPC / decoding failure outside the contract's Result<_, Error>."""


# Pre-validation regexes — must match TS SDK's normalizeAndAssertNonZeroHash semantics.
_ALL_ZERO_BODY = re.compile(r"^0+$")
_HEX_64_LOWER = re.compile(r"^0x[0-9a-f]{64}$")
_NETWORKS = {"mainnet", "testnet", "local"}

_EVENT_NAMES = (
    "BountyPosted",
    "BountyClaimed",
    "BountySubmitted",
    "BountyAccepted",
    "BountyWithdrawn",
)


def _normalize_and_assert_non_zero_hash(value: Any) -> str:
    """
    resultHash normalization for submit(). Mirror of TS normalizeAndAssertNonZeroHash:
      1. Input trimmed and lowercased before any check.
      2. Must start with '0x'.
      3. After '0x': empty or all-'0' (any length) → ValueError /zero hash/i.
      4. Else must match exactly 64 hex chars (32 bytes); else ValueError.
      5. Returns the normalized lowercase hex string.

    Rationale: the contract rejects all-zero H256 via ZeroHashRejected.
    Pre-checking client-side saves a round-trip + gas + a defensive refund.
    """
    if not isinstance(value, str):
        raise ValueError("resultHash must be a 0x-prefixed 32-byte hex string")
    normalized = value.strip().lower()
    if not normalized.startswith("0x"):
        raise ValueError("resultHash must be a 0x-prefixed 32-byte hex string")
    body = normalized[2:]
    if body == "" or _ALL_ZERO_BODY.match(body):
        raise ValueError(
            "resultHash must not be the zero hash (the contract rejects ZeroHashRejected; "
            "pre-check saves a round-trip)"
        )
    if not _HEX_64_LOWER.match(normalized):
        raise ValueError("resultHash must be a 0x-prefixed 32-byte (64 hex char) string")
    return normalized


class Subscription:
    """
    Handle returned by on_bounty_* methods. Call unsubscribe() to remove the
    callback. Usable as a context manager — auto-unsubscribes on __exit__.
    """

    def __init__(self, remove_fn: Callable[[], None]) -> None:
        self._remove = remove_fn
        self._unsubscribed = False

    def unsubscribe(self) -> None:
        if not self._unsubscribed:
            self._remove()
            self._unsubscribed = True

    def __enter__(self) -> "Subscription":
        return self

    def __exit__(self, *_: Any) -> None:
        self.unsubscribe()


class BountyMeshClient:
    """
    Python wrapper over vara-wallet for the BountyMesh Sails program.

    Setup before use:
      - vara-wallet binary on PATH (install per CLAUDE.md).
      - For local dev: `vara-wallet config set network local` (once per machine),
        OR pass network="local" to the constructor.
      - For named accounts: `vara-wallet wallet import --seed '//Alice' --name alice`
        (once per machine).

    All atomic-unit values (reward) MUST be passed as Python ints. The wrapper
    appends `--units raw` to vara-wallet's `--value` to keep semantics matched
    to the contract (1 VARA = 10^12 atomic units). Without --units raw, the
    chain would interpret `--value 2000000000000` as 2 trillion VARA.
    """

    def __init__(
        self,
        account: str,
        program_id: str,
        idl_path: str,
        network: Optional[str] = None,
        ws: Optional[str] = None,
    ) -> None:
        vw = shutil.which("vara-wallet")
        if not vw:
            raise RuntimeError("vara-wallet not on PATH — install per CLAUDE.md")
        if network is not None and network not in _NETWORKS:
            raise ValueError(
                f"network must be one of {sorted(_NETWORKS)} or None; got {network!r}"
            )
        self.vw = vw
        self.account = account
        self.program_id = program_id
        self.idl_path = idl_path
        self.network = network
        self.ws = ws

        self._watch_proc: Optional[subprocess.Popen] = None
        self._watch_thread: Optional[threading.Thread] = None
        self._subs_lock = threading.Lock()
        self._subs: dict[str, list[tuple[Optional[dict], Callable[[dict], None]]]] = {
            name: [] for name in _EVENT_NAMES
        }

    # ---------------- argv construction ----------------

    def _global_args(self) -> list[str]:
        argv = [self.vw, "--account", self.account, "--json"]
        if self.network:
            argv += ["--network", self.network]
        if self.ws:
            argv += ["--ws", self.ws]
        return argv

    def _call_args(self, method: str, args: list, value: Optional[int] = None) -> list[str]:
        argv = self._global_args()
        argv += [
            "call",
            self.program_id,
            method,
            "--args",
            json.dumps(args),
            "--idl",
            self.idl_path,
        ]
        if value is not None:
            # ALWAYS --units raw with atomic-unit ints. See module docstring.
            argv += ["--value", str(value), "--units", "raw"]
        return argv

    # ---------------- call lifecycle ----------------

    def _run(self, argv: list[str]) -> dict:
        completed = subprocess.run(
            argv, shell=False, check=False, capture_output=True, text=True
        )
        if completed.returncode != 0:
            return {
                "ok": False,
                "error": {"kind": "TransportError", "stderr": (completed.stderr or "").strip()},
            }
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as e:
            return {
                "ok": False,
                "error": {
                    "kind": "TransportError",
                    "stderr": f"non-JSON output: {e}: {completed.stdout[:200]!r}",
                },
            }
        return self._parse_call_response(payload)

    @staticmethod
    def _parse_call_response(payload: Any) -> dict:
        """
        Empirically verified shape of `vara-wallet --json call`:
          {
            "txHash":     "0x...",
            "blockHash":  "0x...",
            "blockNumber": <int>,
            "messageId":  "0x...",
            "voucherId":  null|"0x...",
            "result":     {"kind": "Ok",  "value": <T>}
                       OR {"kind": "Err", "value": {"kind": "<ErrorVariant>"}},
            "events":     []
          }
        """
        if not isinstance(payload, dict):
            return {
                "ok": False,
                "error": {"kind": "TransportError", "stderr": f"non-dict response: {payload!r:.200}"},
            }
        tx_hash = payload.get("txHash", "")
        block_hash = payload.get("blockHash", "")
        result = payload.get("result")
        if not isinstance(result, dict) or "kind" not in result:
            return {
                "ok": False,
                "error": {"kind": "UnexpectedResponseShape", "raw": payload},
                "txHash": tx_hash,
                "blockHash": block_hash,
            }
        if result["kind"] == "Ok":
            return {
                "ok": True,
                "value": result.get("value"),
                "txHash": tx_hash,
                "blockHash": block_hash,
            }
        if result["kind"] == "Err":
            err_val = result.get("value", {})
            kind = err_val.get("kind") if isinstance(err_val, dict) else str(err_val)
            return {
                "ok": False,
                "error": {"kind": kind},
                "txHash": tx_hash,
                "blockHash": block_hash,
            }
        return {
            "ok": False,
            "error": {"kind": "UnexpectedResultKind", "raw": result},
            "txHash": tx_hash,
            "blockHash": block_hash,
        }

    # ---------------- mutations ----------------

    def post(
        self,
        title: str,
        description: str,
        acceptance: str,
        reward: int,
        deadline: Optional[int],
        track: str,
    ) -> dict:
        """
        Post a new bounty. Reward is in atomic units (1 VARA = 10^12).
        Payable: --value reward --units raw (always).
        """
        argv = self._call_args(
            "BountyService/Post",
            [title, description, acceptance, str(reward), deadline, track],
            value=reward,
        )
        result = self._run(argv)
        if result.get("ok") and result.get("value") is not None:
            raw_id = result["value"]
            try:
                bounty_id = int(raw_id) if isinstance(raw_id, (int, str)) else int(str(raw_id))
            except (TypeError, ValueError):
                return {
                    "ok": False,
                    "error": {"kind": "TransportError", "stderr": f"could not parse bountyId from {raw_id!r}"},
                    "txHash": result.get("txHash", ""),
                    "blockHash": result.get("blockHash", ""),
                }
            result["value"] = {"bountyId": bounty_id}
        return result

    def claim(self, id: int) -> dict:
        return self._run(self._call_args("BountyService/Claim", [id]))

    def submit(self, id: int, payload: str, result_hash: str) -> dict:
        """Pre-validates result_hash (zero-hash → ValueError) BEFORE subprocess."""
        normalized = _normalize_and_assert_non_zero_hash(result_hash)
        return self._run(self._call_args("BountyService/Submit", [id, payload, normalized]))

    def accept(self, id: int) -> dict:
        return self._run(self._call_args("BountyService/Accept", [id]))

    def withdraw(self, id: int) -> dict:
        return self._run(self._call_args("BountyService/Withdraw", [id]))

    # ---------------- event subscriptions ----------------
    #
    # NOTE: vara-wallet's `watch` NDJSON output exposes messageId but NOT blockHash
    # or txHash per event (limitation of the watch-stream protocol). Event payloads
    # dispatched here include `messageId`; consumers needing tx-level metadata should
    # correlate via the indexer GraphQL or directly via @polkadot/api in TS.

    def on_bounty_posted(
        self, callback: Callable[[dict], None], filter: Optional[dict] = None
    ) -> Subscription:
        return self._register("BountyPosted", callback, filter)

    def on_bounty_claimed(
        self, callback: Callable[[dict], None], filter: Optional[dict] = None
    ) -> Subscription:
        return self._register("BountyClaimed", callback, filter)

    def on_bounty_submitted(
        self, callback: Callable[[dict], None], filter: Optional[dict] = None
    ) -> Subscription:
        return self._register("BountySubmitted", callback, filter)

    def on_bounty_accepted(
        self, callback: Callable[[dict], None], filter: Optional[dict] = None
    ) -> Subscription:
        return self._register("BountyAccepted", callback, filter)

    def on_bounty_withdrawn(
        self, callback: Callable[[dict], None], filter: Optional[dict] = None
    ) -> Subscription:
        return self._register("BountyWithdrawn", callback, filter)

    def _register(
        self, name: str, callback: Callable[[dict], None], filter_: Optional[dict]
    ) -> Subscription:
        entry: tuple[Optional[dict], Callable[[dict], None]] = (filter_, callback)
        with self._subs_lock:
            self._subs[name].append(entry)
            need_open = self._watch_proc is None
        if need_open:
            self._open_watch()

        def _remove() -> None:
            with self._subs_lock:
                try:
                    self._subs[name].remove(entry)
                except ValueError:
                    pass
                total = sum(len(lst) for lst in self._subs.values())
                if total == 0 and self._watch_proc is not None:
                    try:
                        self._watch_proc.terminate()
                        self._watch_proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._watch_proc.kill()
                    except Exception:
                        pass
                    self._watch_proc = None
                    self._watch_thread = None

        return Subscription(_remove)

    def _open_watch(self) -> None:
        argv = self._global_args() + ["watch", self.program_id, "--idl", self.idl_path]
        self._watch_proc = subprocess.Popen(
            argv,
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._watch_thread = threading.Thread(target=self._watch_loop, daemon=True)
        self._watch_thread.start()

    def _watch_loop(self) -> None:
        proc = self._watch_proc
        if proc is None or proc.stdout is None:
            return
        for line in iter(proc.stdout.readline, ""):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                evt = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            decoded = evt.get("decoded")
            if not isinstance(decoded, dict):
                continue
            if decoded.get("kind") != "sails" or decoded.get("service") != "BountyService":
                continue
            event_name = decoded.get("event")
            if event_name not in _EVENT_NAMES:
                continue
            data = decoded.get("data") or {}
            normalized = self._normalize_event(event_name, data, evt.get("messageId", ""))
            with self._subs_lock:
                listeners = list(self._subs.get(event_name, []))
            for filter_, cb in listeners:
                if not self._matches_filter(event_name, normalized, filter_):
                    continue
                try:
                    cb(normalized)
                except Exception as exc:
                    # Fire-and-forget — a slow consumer doesn't block dispatch.
                    print(f"[bountymesh.py] callback error in {event_name}: {exc}")

    @staticmethod
    def _unwrap_kind(value: Any) -> Any:
        """Sails unit-variant enums render as {"kind":"Variant"}. Unwrap for ergonomics."""
        if isinstance(value, dict) and "kind" in value and len(value) == 1:
            return value["kind"]
        return value

    @classmethod
    def _normalize_event(cls, name: str, raw: dict, message_id: str) -> dict:
        """camelCase + int normalization for the event payload."""
        if name == "BountyPosted":
            return {
                "id": int(raw["id"]),
                "poster": raw.get("poster"),
                "reward": int(raw["reward"]),
                "track": cls._unwrap_kind(raw.get("track")),
                "postedAt": raw.get("posted_at"),
                "messageId": message_id,
            }
        if name == "BountyClaimed":
            return {
                "id": int(raw["id"]),
                "worker": raw.get("worker"),
                "claimedAt": raw.get("claimed_at"),
                "messageId": message_id,
            }
        if name == "BountySubmitted":
            return {
                "id": int(raw["id"]),
                "worker": raw.get("worker"),
                "resultHash": raw.get("result_hash"),
                "submittedAt": raw.get("submitted_at"),
                "messageId": message_id,
            }
        if name == "BountyAccepted":
            return {
                "id": int(raw["id"]),
                "poster": raw.get("poster"),
                "worker": raw.get("worker"),
                "reward": int(raw["reward"]),
                "settledAt": raw.get("settled_at"),
                "messageId": message_id,
            }
        if name == "BountyWithdrawn":
            return {
                "id": int(raw["id"]),
                "worker": raw.get("worker"),
                "amount": int(raw["amount"]),
                "withdrawnAt": raw.get("withdrawn_at"),
                "messageId": message_id,
            }
        return {**raw, "messageId": message_id}

    @staticmethod
    def _matches_filter(name: str, event: dict, filter_: Optional[dict]) -> bool:
        if not filter_:
            return True
        if name == "BountyPosted":
            if "track" in filter_ and event.get("track") != filter_["track"]:
                return False
            if "minReward" in filter_ and event.get("reward", 0) < filter_["minReward"]:
                return False
            if "poster" in filter_ and str(event.get("poster", "")).lower() != str(filter_["poster"]).lower():
                return False
        elif name in ("BountyClaimed", "BountySubmitted", "BountyWithdrawn"):
            if "worker" in filter_ and str(event.get("worker", "")).lower() != str(filter_["worker"]).lower():
                return False
        elif name == "BountyAccepted":
            if "poster" in filter_ and str(event.get("poster", "")).lower() != str(filter_["poster"]).lower():
                return False
            if "worker" in filter_ and str(event.get("worker", "")).lower() != str(filter_["worker"]).lower():
                return False
        return True
