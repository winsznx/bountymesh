/**
 * InflightSerializer — P2 §8 Main FSM ceiling=1 gate.
 *
 * Holds zero-or-one bountyId at any moment. tryAcquire returns false if
 * already inflight; release frees the slot. The serializer does NOT auto-
 * release on any error — release is the FSM's (P3.x) responsibility, fired
 * exactly when the Main FSM closes on Submit-confirmed (per P2 §8 decoupled
 * design: Main FSM = active work; Pending-Accept Monitor = passive wait).
 *
 * The pipeline (pipeline.ts) acquires the slot speculatively at filter
 * stage 2, releases on filter rejection in stages 3-4, hands ownership to
 * onAccepted on filter pass. From that point P3.x FSM owns the slot.
 */

export class InflightSerializer {
  private current: bigint | null = null;

  tryAcquire(id: bigint): boolean {
    if (this.current !== null) return false;
    this.current = id;
    return true;
  }

  release(): void {
    this.current = null;
  }

  isInflight(): boolean {
    return this.current !== null;
  }

  inflightId(): bigint | null {
    return this.current;
  }
}
