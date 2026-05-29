/**
 * Boot orchestrator types.
 *
 * 7-stage sequence (P2 §1 + P3.9 operator-locked):
 *   B-1: loadConfig          — env validation + WorkerConfig assembly
 *   B-2: loadSigner          — keystore-or-env Sr25519 keypair
 *   B-3: connectChain        — GearApi + BountyMeshClient
 *   B-4: loadState           — WorkerStateFile + WorkHistoryDedup
 *   B-5: assemble            — mutex + serializer + adapter + FSM + filter pipeline
 *   B-6: goLive              — setupDiscovery + PendingAcceptMonitor.start
 *   B-7: ready               — log + return BootHandle
 *
 * Each stage that allocates a teardown resource pushes a rollback closure onto
 * a LIFO stack. On any boot failure the rollback unwinds reverse-of-construction.
 * Post-boot shutdown uses a SEPARATE operator-locked sequence (shutdown.ts).
 */

import type { Logger } from 'pino';
import type { GearApi } from '@gear-js/api';
import type { BountyMeshClient, BountyMeshClientOptions } from '@bountymesh/sdk';
import type { WorkAdapter } from '../adapter/index.js';
import type { WorkerConfig } from '../config/index.js';
import type { DiscoveryHandle } from '../discovery/types.js';
import type { SetupDiscoveryOptions } from '../discovery/index.js';
import type { LoadSignerOptions, LoadedSigner } from '../signer/index.js';
import type {
  PendingAcceptMonitor,
  PendingAcceptMonitorDeps,
} from '../fsm/pending-accept-monitor.js';

export type BootStage = 'B-1' | 'B-2' | 'B-3' | 'B-4' | 'B-5' | 'B-6' | 'B-7';

export interface BootHandle {
  /** Graceful teardown via operator-locked ShutdownSequence. Idempotent. */
  shutdown: () => Promise<void>;
}

/**
 * BootOptions — production usage passes only `logger`. Tests inject specific
 * stage hooks to control behavior and assert ordering / rollback.
 */
export interface BootOptions {
  logger?: Logger;
  loadConfig?: () => WorkerConfig;
  loadSigner?: (opts: LoadSignerOptions) => Promise<LoadedSigner>;
  createGearApi?: (rpcUrl: string) => Promise<GearApi>;
  createClient?: (opts: BountyMeshClientOptions) => BountyMeshClient;
  selectAdapter?: (config: WorkerConfig) => WorkAdapter;
  setupDiscovery?: (opts: SetupDiscoveryOptions) => Promise<DiscoveryHandle>;
  createMonitor?: (deps: PendingAcceptMonitorDeps) => PendingAcceptMonitor;
}
