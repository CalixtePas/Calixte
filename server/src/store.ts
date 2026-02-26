export type ActorType = 'AI_AGENT' | 'HUMAN_AGENT';
export type Intent = 'FRAUD_CALLBACK';
export type Decision = 'ALLOW' | 'DENY' | 'STEP_UP';

export interface Interaction {
  interaction_id: string;
  actor_type: ActorType;
  intent: Intent;
  audience_ref: string;
  created_at: number;
}

export interface Confirmation {
  id: string;
  interaction_id: string;
  status: 'PENDING' | 'APPROVED';
  created_at: number;
}

export interface AuditEvent {
  type: string;
  at: number;
  payload: Record<string, unknown>;
}

export const interactions = new Map<string, Interaction>();
export const confirmations = new Map<string, Confirmation>();
export const audit_events: AuditEvent[] = [];

export function pushAudit(type: string, payload: Record<string, unknown>) {
  audit_events.push({ type, at: Date.now(), payload });
}

export function resetStore() {
  interactions.clear();
  confirmations.clear();
  audit_events.length = 0;
}
