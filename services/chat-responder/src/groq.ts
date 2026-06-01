/**
 * Groq adapter — composeReply() returns a 1-3 sentence chat reply grounded
 * in supplementary state. The model is forced to ONLY use numeric facts
 * present in the prompt; the system message includes 4 few-shots that
 * demonstrate the voice for each of the 3 Applications.
 *
 * Temperature 0.3 — low enough for fact-grounded output, high enough to
 * keep replies varied across cycles.
 */

import type { OurAppHandle } from './indexer.js';
import { formatVara, type SupplementaryState } from './supplementary.js';
import type { AgentPulsePost } from './external.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

interface GroqChoice { message: { content: string } }
interface GroqResponse { choices?: GroqChoice[]; error?: { message: string } }

export interface EcosystemContext {
  varaUsd: number | null;
  pulseFeed: AgentPulsePost[] | null;
}

export interface ComposeReplyInput {
  originalMessage: string;
  mentionedApp: OurAppHandle;
  authorHandle: string | null;
  supplementaryState: SupplementaryState;
  ecosystemContext?: EcosystemContext;
}

const SYSTEM_PROMPT = `You are the on-chain voice for one of three BountyMesh Applications on the Vara Agent Network. You write short chat replies (1-3 sentences) when another agent mentions you.

ABSOLUTE RULES
- Never invent numeric facts. Only state numbers that appear in the supplementaryState section of the user message.
- Reference the original message specifically — paraphrase what they said before replying.
- 1-3 sentences. Hard cap. No bullet lists.
- Plain prose. No markdown, no code blocks, no emojis.
- No sign-offs, no "Cheers", no "Best,", no signatures.
- No "thanks for the mention" filler unless the original message is itself a thank-you.

VOICE BY APP
- bountymesh: product-focused. You broker bounties; you talk about open bounties, settle events, the bountymesh.xyz UI, the contract escrow guarantee.
- bountymesh-rep: data-focused. You track worker reputation across BountyMesh's lifecycle. You speak in counts: submissions, accepts, distinct workers.
- bountymesh-feeds: routing-focused. You are a demand telegraph. You speak in signals, multipliers, atomic routed totals. You are not the escrow contract — you are the discovery layer.

LINK GUIDANCE
- If a CTA fits naturally, the canonical URL is https://bountymesh.xyz (or /agents, /stats, /bounties/{id} for direct links).
- agents.vara.network/agents/{handle} is the A2A profile page; use it sparingly.
- Never embed more than one URL.

FEW-SHOT EXAMPLES

Example 1 — bountymesh replying to an invitation
Original: "@bountymesh @varabridge — interested in cross-mention?"
SupplementaryState: { app: bountymesh, openCount: 12, totalCount: 47 }
Reply: Cross-mention works for us — we have 12 open bounties right now (47 lifetime). Anyone reading this can browse them at bountymesh.xyz/bounties and post their own without us touching the funds.

Example 2 — bountymesh-rep replying to a worker-stats question
Original: "Anyone tracking which workers are actually shipping on Vara?"
SupplementaryState: { app: bountymesh-rep, uniqueWorkers: 6, totalSubmissions: 84, totalAccepted: 78 }
Reply: We do — 6 distinct workers have submitted 84 deliveries to BountyMesh with 78 accepted. The reputation read is free on chain; the projection follows BountyMesh's lifecycle events.

Example 3 — bountymesh-feeds replying to a cross-mention from a routing agent
Original: "Welcome @bountymesh-feeds! Curious what you actually route."
SupplementaryState: { app: bountymesh-feeds, signalCount: 14, totalEffectiveAtomic: 9000000000000 }
Reply: We've routed 14 demand signals through PostBoosted so far, totalling 9 VARA-equivalent at the rotating multipliers. We never lock value — every call refunds on reply.

Example 4 — bountymesh replying to a fact mention (no question)
Original: "Reminder: @bountymesh has the contract-enforced two-phase settlement everyone's asking about."
SupplementaryState: { app: bountymesh, openCount: 8, totalCount: 47, recentSettle: { bountyId: "32", rewardAtomic: 500000000000, workerShortHex: "0x14e8…2b3a" } }
Reply: Confirmed — last settle was bounty #32, 0.5 VARA paid out to 0x14e8…2b3a directly from program escrow. 8 still open if anyone wants the same flow.

ECOSYSTEM CONTEXT (optional, may be absent)
- If an ecosystemContext block appears in the user message, it carries facts pulled from sibling agents (a live VARA/USD rate from @varabridge, recent posts from @agent-pulse). Use them only if they reinforce the reply naturally — never force them in, never invent new numbers from them. If they don't fit, ignore them.

OUTPUT FORMAT
Return ONLY the reply text. No JSON, no preamble, no quotes around it.`;

function formatSupplementary(state: SupplementaryState): string {
  switch (state.app) {
    case 'bountymesh':
      return JSON.stringify({
        app: state.app,
        openCount: state.openCount,
        totalCount: state.totalCount,
        recentSettle: state.recentSettle
          ? {
              bountyId: state.recentSettle.bountyId,
              rewardAtomic: state.recentSettle.rewardAtomic.toString(),
              rewardVara: formatVara(state.recentSettle.rewardAtomic),
              workerShortHex: state.recentSettle.workerShortHex,
            }
          : null,
      });
    case 'bountymesh-rep':
      return JSON.stringify({
        app: state.app,
        uniqueWorkers: state.uniqueWorkers,
        totalSubmissions: state.totalSubmissions,
        totalAccepted: state.totalAccepted,
      });
    case 'bountymesh-feeds':
      return JSON.stringify({
        app: state.app,
        signalCount: state.signalCount,
        totalEffectiveAtomic: state.totalEffectiveAtomic.toString(),
        totalEffectiveVara: formatVara(state.totalEffectiveAtomic),
      });
  }
}

export async function composeReply(input: ComposeReplyInput): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const lines = [
    `You are replying as @${input.mentionedApp}.`,
    `Original message author: @${input.authorHandle ?? '<unknown>'}`,
    `Original message body:`,
    input.originalMessage,
    ``,
    `supplementaryState: ${formatSupplementary(input.supplementaryState)}`,
  ];
  const ecoBlock = formatEcosystemContext(input.ecosystemContext);
  if (ecoBlock) {
    lines.push('', `ecosystemContext: ${ecoBlock}`);
  }
  lines.push(
    '',
    'Write the reply now. Plain prose, 1-3 sentences, grounded only in supplementaryState (ecosystemContext is supporting flavor only).',
  );
  const userPrompt = lines.join('\n');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 220,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as GroqResponse;
  if (body.error) throw new Error(`Groq error: ${body.error.message}`);
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Groq returned empty content');
  return sanitizeReply(content);
}

function formatEcosystemContext(ctx: EcosystemContext | undefined): string | null {
  if (!ctx) return null;
  const hasVara = typeof ctx.varaUsd === 'number' && Number.isFinite(ctx.varaUsd) && ctx.varaUsd > 0;
  const hasFeed = Array.isArray(ctx.pulseFeed) && ctx.pulseFeed.length > 0;
  if (!hasVara && !hasFeed) return null;
  return JSON.stringify({
    varaUsd: hasVara ? Number((ctx.varaUsd as number).toFixed(4)) : null,
    recentPulsePosts: hasFeed
      ? ctx.pulseFeed!.map((p) => ({
          id: p.id,
          author: p.authorShortHex,
          body: p.bodyShort,
        }))
      : null,
  });
}

function sanitizeReply(raw: string): string {
  let text = raw.trim();
  // Strip surrounding quotes if the model wrapped its own reply.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  // Strip leading "Reply:" / "Response:" labels.
  text = text.replace(/^(reply|response)\s*:\s*/i, '');
  // Collapse 3+ newlines (defense against bullet-like output).
  text = text.replace(/\n{2,}/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
  // Hard cap at 480 chars (Vara A2A chat body has a limit; 480 leaves room).
  if (text.length > 480) text = text.slice(0, 477).trimEnd() + '…';
  return text;
}
