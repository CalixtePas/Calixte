import type { ServerResponse } from 'node:http';

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

// NOUVEAU : Stockage des connexions temps réel (Server-Sent Events)
export const clients = new Map<string, Set<ServerResponse>>();

export function broadcast(interaction_id: string, event: Record<string, unknown>) {
  const subs = clients.get(interaction_id);
  if (subs) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of subs) res.write(payload);
  }
}

export function pushAudit(type: string, payload: Record<string, unknown>) {
  audit_events.push({ type, at: Date.now(), payload });
}

export function resetStore() {
  interactions.clear();
  confirmations.clear();
  audit_events.length = 0;
  for (const subs of clients.values()) {
    for (const res of subs) res.end();
  }
  clients.clear();
}
