/**
 * Vara A2A chat indexer queries (PostGraphile at agents-api.vara.network).
 *
 * getRecentMentions — fetches ChatMentions whose recipient is one of our
 *   3 Applications, since a given timestamp, in chronological order so
 *   the cursor advances monotonically.
 *
 * findOurExistingReply — cross-deploy dedup. Because Railway's filesystem
 *   is ephemeral, the local SQLite resets on redeploy. To avoid double-
 *   replying to a message after a restart, this checks whether any of
 *   our 3 Applications have already posted a ChatMessage with
 *   replyTo == msgId.
 */

const A2A_GRAPHQL_URL = process.env.A2A_GRAPHQL_URL ?? 'https://agents-api.vara.network/graphql';

export type OurAppHandle = 'bountymesh' | 'bountymesh-rep' | 'bountymesh-feeds';

export interface ChatMention {
  /** Composite mention id from the indexer (program:block:event:idx:n). */
  id: string;
  /** Composite messageId FK from the indexer (program:block:event:idx). */
  messageId: string;
  /** Hub's on-chain msgId — the u64 for reply_to. String-form BigInt. */
  msgId: string;
  /** Handle being mentioned — one of our 3. */
  recipientHandle: OurAppHandle;
  /** Author handle of the parent ChatMessage. */
  authorHandle: string | null;
  /** "Application:0x.." or "Participant:0x.." string from the indexer. */
  authorRef: string;
  /** Message body (UTF-8). */
  body: string;
  /** All recipient handles mentioned in the same message. */
  recipientHandlesInMessage: OurAppHandle[];
  /** Substrate block of the post. */
  substrateBlockNumber: number;
  /** ISO timestamp from the indexer (ts column). */
  ts: string;
  /** replyTo from the parent ChatMessage — non-null means this message is itself a reply. */
  replyTo: string | null;
}

interface RawMentionNode {
  id: string;
  messageId: string;
  recipientHandle: string;
  substrateBlockNumber: number;
  chatMessageByMessageId: {
    msgId: string;
    authorHandle: string | null;
    authorRef: string;
    body: string;
    replyTo: string | null;
    ts: string;
    chatMentionsByMessageId: { nodes: Array<{ recipientHandle: string }> };
  } | null;
}

const OUR_HANDLES: readonly OurAppHandle[] = ['bountymesh', 'bountymesh-rep', 'bountymesh-feeds'];

function isOurHandle(h: string | null | undefined): h is OurAppHandle {
  return h !== null && h !== undefined && (OUR_HANDLES as readonly string[]).includes(h);
}

export async function getRecentMentions(since: Date, limit = 50): Promise<ChatMention[]> {
  const query = `
    query Mentions($recipients: [String!]!, $since: Datetime!, $limit: Int!) {
      allChatMentions(
        filter: {
          recipientHandle: { in: $recipients }
          chatMessageByMessageId: { ts: { greaterThan: $since } }
        }
        orderBy: SUBSTRATE_BLOCK_NUMBER_ASC
        first: $limit
      ) {
        nodes {
          id
          messageId
          recipientHandle
          substrateBlockNumber
          chatMessageByMessageId {
            msgId
            authorHandle
            authorRef
            body
            replyTo
            ts
            chatMentionsByMessageId { nodes { recipientHandle } }
          }
        }
      }
    }
  `;
  const res = await fetch(A2A_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { recipients: [...OUR_HANDLES], since: since.toISOString(), limit },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`A2A mentions query HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { allChatMentions?: { nodes?: RawMentionNode[] } };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(body.errors[0].message);

  const nodes = body.data?.allChatMentions?.nodes ?? [];
  const mentions: ChatMention[] = [];
  for (const n of nodes) {
    if (!n.chatMessageByMessageId) continue;
    if (!isOurHandle(n.recipientHandle)) continue;
    const m = n.chatMessageByMessageId;
    const recipientsInMessage = (m.chatMentionsByMessageId?.nodes ?? [])
      .map((r) => r.recipientHandle)
      .filter(isOurHandle);
    mentions.push({
      id: n.id,
      messageId: n.messageId,
      msgId: m.msgId,
      recipientHandle: n.recipientHandle,
      authorHandle: m.authorHandle,
      authorRef: m.authorRef,
      body: m.body,
      recipientHandlesInMessage: recipientsInMessage.length > 0 ? recipientsInMessage : [n.recipientHandle],
      substrateBlockNumber: n.substrateBlockNumber,
      ts: m.ts,
      replyTo: m.replyTo,
    });
  }
  return mentions;
}

/**
 * Returns true if any of our 3 Applications has already posted a ChatMessage
 * with replyTo == targetMsgId. Used for cross-deploy dedup when SQLite has
 * lost state.
 */
export async function findOurExistingReply(targetMsgId: string): Promise<boolean> {
  const query = `
    query Replies($targetMsgId: BigInt!, $authors: [String!]!) {
      allChatMessages(
        filter: {
          replyTo: { equalTo: $targetMsgId }
          authorHandle: { in: $authors }
        }
        first: 1
      ) { nodes { msgId } }
    }
  `;
  try {
    const res = await fetch(A2A_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { targetMsgId, authors: [...OUR_HANDLES] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      data?: { allChatMessages?: { nodes?: Array<{ msgId: string }> } };
    };
    return (body.data?.allChatMessages?.nodes?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
