export type CallType = 'query' | 'function';

export type AuthKind = 'none' | 'Wallet' | 'Application' | 'Other';

export type CostKind = 'free' | 'gas-only' | 'voucher' | 'escrow';

export type TopicTag = string;

export interface CapabilityEntry {
  app: string;
  programId: `0x${string}`;
  service: string;
  method: string;
  callType: CallType;
  authRequired: AuthKind;
  cost: CostKind;
  argTemplate: Record<string, string>;
  argNames: string[];
  topics: string[];
  track?: string;
}

export interface RouteResult {
  app: string;
  programId: `0x${string}`;
  service: string;
  method: string;
  callType: CallType;
  args: unknown[];
  topic: TopicTag;
}

export interface ExternalResultOk {
  ok: true;
  data: unknown;
  source_program: `0x${string}`;
  source_method: string;
  source_tx_hash?: string;
}

export interface ExternalResultErr {
  ok: false;
  error: string;
  source_program?: string;
  source_method?: string;
}

export type ExternalResult = ExternalResultOk | ExternalResultErr;

export interface OrchestratorEnvelope {
  bounty_id: number;
  result: unknown;
  source: 'external' | 'groq_fallback';
  source_program?: string;
  source_method?: string;
  source_tx_hash?: string;
  delivered_by: string;
  delivered_at_block: number;
  envelope_version: '1.0';
}
