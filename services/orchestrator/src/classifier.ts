import { TOPIC_KEYWORDS } from './capability-index.js';
import type { TopicTag } from './types.js';

const MIN_TOKEN_LEN_FOR_SUBSTRING = 4;
const SCORE_THRESHOLD = 0.3;
const MAX_TOPICS = 3;
const TOKEN_SPLIT_RE = /[^a-z0-9]+/;

function tokenize(content: string): string[] {
  return content
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter((t) => t.length > 0);
}

function scoreBucket(bucket: string, keywords: readonly string[], tokens: string[]): number {
  const tokenSet = new Set(tokens);
  let raw = 0;

  if (tokenSet.has(bucket)) {
    raw += 1;
  }

  for (const kw of keywords) {
    if (tokenSet.has(kw)) {
      raw += 1;
      continue;
    }
    for (const tok of tokens) {
      if (tok.length >= MIN_TOKEN_LEN_FOR_SUBSTRING && tok.includes(kw)) {
        raw += 0.5;
        break;
      }
    }
  }

  if (tokens.length === 0) return 0;
  return raw / Math.sqrt(tokens.length);
}

function computeAllScores(content: string): Record<TopicTag, number> {
  const tokens = tokenize(content);
  const scores: Record<TopicTag, number> = {};
  for (const [bucket, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (bucket === 'fallback') {
      scores[bucket] = 0;
      continue;
    }
    scores[bucket] = scoreBucket(bucket, keywords, tokens);
  }
  return scores;
}

export function classify(bountyContent: string): TopicTag[] {
  const scores = computeAllScores(bountyContent);
  const ranked = Object.entries(scores)
    .filter(([, score]) => score >= SCORE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS)
    .map(([topic]) => topic);

  if (ranked.length === 0) return ['fallback'];
  return ranked;
}

export interface ClassifyOneResult {
  topic: TopicTag;
  score: number;
  allScores: Record<TopicTag, number>;
}

export function classifyOne(content: string): ClassifyOneResult {
  const allScores = computeAllScores(content);
  let bestTopic: TopicTag = 'fallback';
  let bestScore = 0;
  for (const [topic, score] of Object.entries(allScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }
  if (bestScore < SCORE_THRESHOLD) {
    return { topic: 'fallback', score: bestScore, allScores };
  }
  return { topic: bestTopic, score: bestScore, allScores };
}
