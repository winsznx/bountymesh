/**
 * GearApi factory + reconnect plumbing (Boot Stage 3).
 *
 * - Creates a GearApi connected to config.varaRpcUrl.
 * - Awaits api.isReady before returning.
 * - Registers api.on('disconnected') and api.on('connected') handlers.
 *   The 'connected' handler awaits api.isReady AND issues a probe RPC
 *   (api.rpc.chain.getFinalizedHead) before invoking onReconnect — per
 *   concern #4, @polkadot/api may emit 'connected' before the chain is
 *   queryable in some races.
 *
 * The indexer owns the GearApi instance; SDK's BountyMeshClient receives it
 * constructor-injected. Disconnect events surface to the indexer, not the SDK.
 */

import { GearApi } from '@gear-js/api';
import type { Logger } from 'pino';
import type { IndexerConfig } from '../config.js';

export interface ChainApiHandle {
  api: GearApi;
  disconnect(): Promise<void>;
}

export interface ChainApiOptions {
  config: IndexerConfig;
  logger: Logger;
  /**
   * Called on api.on('disconnected'). Fire-and-forget; thrown errors are
   * logged but do NOT block subsequent reconnection.
   */
  onDisconnect: () => void | Promise<void>;
  /**
   * Called on api.on('connected') AFTER readiness probe succeeds.
   *
   * api.isReady is a one-shot promise (stays fulfilled across reconnects),
   * so we follow it with a small RPC to confirm WS-level liveness before
   * re-arming subscriptions. If the probe throws, we log and bail — the
   * next 'connected' event (which the api auto-emits after metadata refresh)
   * will retry.
   */
  onReconnect: () => void | Promise<void>;
}

export async function createChainApi(opts: ChainApiOptions): Promise<ChainApiHandle> {
  const { config, logger, onDisconnect, onReconnect } = opts;

  logger.info({ op: 'boot', rpcUrl: config.vararRpcUrl }, 'chain: connecting');
  const api = await GearApi.create({ providerAddress: config.vararRpcUrl });
  await api.isReady;
  logger.info({ op: 'boot' }, 'chain: ready');

  const disconnectListener = (): void => {
    logger.warn({ op: 'ws_disconnect' }, 'chain: ws disconnected');
    void Promise.resolve(onDisconnect()).catch((err: unknown) => {
      logger.error(
        { op: 'ws_disconnect', err: String(err) },
        'onDisconnect handler threw',
      );
    });
  };

  const connectListener = (): void => {
    void (async () => {
      try {
        await api.isReady;
        await api.rpc.chain.getFinalizedHead();
        logger.info({ op: 'ws_reconnect' }, 'chain: ws reconnected and probe ok');
        await onReconnect();
      } catch (err: unknown) {
        logger.error(
          { op: 'ws_reconnect', err: String(err) },
          'onReconnect probe or handler failed; will retry on next connected event',
        );
      }
    })();
  };

  api.on('disconnected', disconnectListener);
  api.on('connected', connectListener);

  const disconnect = async (): Promise<void> => {
    api.off('disconnected', disconnectListener);
    api.off('connected', connectListener);
    await api.disconnect();
  };

  return { api, disconnect };
}
