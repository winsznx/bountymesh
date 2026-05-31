/**
 * Chat/Post via the Vara A2A Hub with reply_to set to the target msgId.
 *
 * Authorization model: A2A Hub authorizes a Chat/Post call where
 * `author = Application(PID)` iff msg::source() is a registered
 * Participant of that Application. The winsznx keystore is a
 * Participant of all 3 of our Applications, so we sign with the same
 * keypair and only swap the program id in the author HandleRef.
 *
 * Voucher: the Hub program is whitelisted by the voucher backend, so
 * gas is voucher-paid. One voucher covers all 3 Applications because
 * the voucher is scoped to the Hub program id, not the author.
 */

import type { Sails } from 'sails-js';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { OurAppHandle } from './indexer.js';

export interface PostReplyInput {
  ourApp: OurAppHandle;
  ourAppProgramId: `0x${string}`;
  replyBody: string;
  replyToMsgId: bigint;
  mentionRefs: Array<{ Participant: `0x${string}` } | { Application: `0x${string}` }>;
}

export interface PostReplyResult {
  msgId: string;
  txHash: string;
  blockHash: string;
}

export async function postChatReply(
  sails: Sails,
  signer: KeyringPair,
  voucherId: `0x${string}`,
  input: PostReplyInput,
): Promise<PostReplyResult> {
  const author = { Application: input.ourAppProgramId } as const;
  const tx = sails.services.Chat.functions.Post(
    input.replyBody,
    author,
    input.mentionRefs,
    input.replyToMsgId,
  );
  tx.withAccount(signer);
  tx.withVoucher(voucherId);
  await tx.calculateGas();
  const sent = await tx.signAndSend();
  const reply = await sent.response();
  return {
    msgId: String(reply),
    txHash: String(sent.txHash),
    blockHash: String(sent.blockHash),
  };
}
