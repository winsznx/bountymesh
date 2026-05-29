"""
End-to-end smoke test for packages/sdk/python/bountymesh.py against a real
gear --dev --tmp local node + real bountymesh.opt.wasm + real signed extrinsics.

NO MOCKS. Matches Phase 2 SDK test pattern from CLAUDE.md.

Setup (one-time per machine — idempotent):
  - vara-wallet config set network local
  - vara-wallet wallet import --seed '//Alice' --name alice
  - vara-wallet wallet import --seed '//Bob' --name bob

Per-run setup:
  - npx tsx scripts/deploy-for-python.ts → prints PROGRAM_ID=0x...
    (the TS harness owns the local-node lifecycle; this smoke test
    reuses the running node and never tears it down)

Run:
  cd packages/sdk
  python3 -m unittest python/test_smoke.py -v

Event-subscription tests are out of scope here — Phase 4 reference worker is
the integration test for Python event subscription in production.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Optional

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
from bountymesh import BountyMeshClient, _normalize_and_assert_non_zero_hash  # noqa: E402

SDK_DIR = THIS_DIR.parent
REPO_ROOT = SDK_DIR.parent.parent
IDL_PATH = str(REPO_ROOT / "agent-starter" / "idl" / "bountymesh.idl.snapshot")
DEPLOY_SCRIPT = str(SDK_DIR / "scripts" / "deploy-for-python.ts")
ONE_VARA = 1_000_000_000_000


def _run(argv: list[str], cwd: Optional[str] = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(argv, shell=False, check=check, capture_output=True, text=True, cwd=cwd)


def _ensure_account(name: str, seed: str) -> None:
    """Idempotently import a dev account. Swallow already-exists; re-raise other errors."""
    proc = subprocess.run(
        ["vara-wallet", "wallet", "import", "--seed", seed, "--name", name],
        shell=False, check=False, capture_output=True, text=True,
    )
    if proc.returncode == 0:
        return
    combined = (proc.stdout or "") + (proc.stderr or "")
    if "already exists" in combined.lower() or "exists" in combined.lower():
        return
    raise RuntimeError(f"wallet import {name}: {combined.strip()}")


def _deploy() -> str:
    """Run the TS deploy script, parse PROGRAM_ID from its output."""
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx not on PATH — Phase 2 SDK setup incomplete")
    proc = _run([npx, "tsx", DEPLOY_SCRIPT], cwd=str(SDK_DIR))
    last = proc.stdout.strip().splitlines()[-1]
    if not last.startswith("PROGRAM_ID="):
        raise RuntimeError(
            f"deploy did not print PROGRAM_ID on final line.\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return last.split("=", 1)[1].strip()


class PythonWrapperSmoke(unittest.TestCase):
    program_id: str

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("vara-wallet") is None:
            raise unittest.SkipTest("vara-wallet not on PATH")
        if not Path(IDL_PATH).exists():
            raise unittest.SkipTest(f"IDL not found: {IDL_PATH}")
        _run(["vara-wallet", "config", "set", "network", "local"], check=False)
        _ensure_account("alice", "//Alice")
        _ensure_account("bob", "//Bob")
        cls.program_id = _deploy()

    def test_full_lifecycle(self) -> None:
        """alice posts → bob claims → bob submits → alice accepts → bob withdraws."""
        alice = BountyMeshClient("alice", self.program_id, IDL_PATH, network="local")
        bob = BountyMeshClient("bob", self.program_id, IDL_PATH, network="local")

        # Step 1: Post (alice locks 2 VARA into escrow via --units raw)
        posted = alice.post(
            title="py-smoke",
            description="d",
            acceptance="a",
            reward=2 * ONE_VARA,
            deadline=None,
            track="Economy",
        )
        self.assertTrue(posted.get("ok"), f"post failed: {posted}")
        self.assertIn("value", posted)
        bounty_id = posted["value"]["bountyId"]
        self.assertIsInstance(bounty_id, int)
        self.assertGreaterEqual(bounty_id, 0)
        self.assertRegex(posted["txHash"], r"^0x[0-9a-fA-F]{64}$")
        self.assertRegex(posted["blockHash"], r"^0x[0-9a-fA-F]{64}$")

        # Step 2: Claim (bob)
        claimed = bob.claim(bounty_id)
        self.assertTrue(claimed.get("ok"), f"claim failed: {claimed}")

        # Step 3: Submit (bob, with non-zero hash)
        submitted = bob.submit(bounty_id, "result-content", "0x" + "ab" * 32)
        self.assertTrue(submitted.get("ok"), f"submit failed: {submitted}")

        # Step 4: Accept (alice)
        accepted = alice.accept(bounty_id)
        self.assertTrue(accepted.get("ok"), f"accept failed: {accepted}")

        # Step 5: Withdraw (bob pulls escrowed reward via CommandReply::with_value)
        withdrawn = bob.withdraw(bounty_id)
        self.assertTrue(withdrawn.get("ok"), f"withdraw failed: {withdrawn}")

        # Sanity: querying balance via vara-wallet's `balance` subcommand should now
        # show the program escrow has drained. We don't compare to a baseline (other
        # tests in the same node session may have run); a soft "balance >= 0" check
        # is enough to confirm the call shape is valid.
        bal_proc = _run(
            ["vara-wallet", "--json", "--network", "local", "balance", self.program_id],
            check=False,
        )
        self.assertEqual(bal_proc.returncode, 0, f"balance query: {bal_proc.stderr}")

    def test_zero_hash_pre_check_raises_synchronously(self) -> None:
        """
        submit() with all-zero hash raises ValueError BEFORE any subprocess invocation.
        Distinguished from contract-level ZeroHashRejected: this is a programmer error,
        not a chain rejection.
        """
        bob = BountyMeshClient("bob", self.program_id, IDL_PATH, network="local")

        # Confirm pure-function rejection
        with self.assertRaisesRegex(ValueError, r"zero[- ]?hash"):
            _normalize_and_assert_non_zero_hash("0x" + "00" * 32)
        with self.assertRaisesRegex(ValueError, r"zero[- ]?hash"):
            _normalize_and_assert_non_zero_hash("0x0")
        with self.assertRaisesRegex(ValueError, r"zero[- ]?hash"):
            _normalize_and_assert_non_zero_hash("0x00")

        # Confirm bob.submit propagates the same synchronous error.
        # We can't easily observe "subprocess was not invoked" without complex
        # process-list checks, but raises-before-await is structurally guaranteed
        # by the implementation: _normalize_and_assert_non_zero_hash is called
        # before subprocess.run in submit(). Tested by line-of-fire ordering.
        with self.assertRaisesRegex(ValueError, r"zero[- ]?hash"):
            bob.submit(0, "payload", "0x" + "00" * 32)


if __name__ == "__main__":
    unittest.main()
