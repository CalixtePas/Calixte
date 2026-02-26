export type Intent = 'FRAUD_CALLBACK';
export type ActorType = 'AI_AGENT' | 'HUMAN_AGENT';
export type Action = 'FREEZE_CARD' | 'ASK_OTP' | 'WIRE_TRANSFER' | 'DISCUSS_CASE';

export interface DecisionRequest {
  intent: Intent;
  actor_type: ActorType;
  action: Action;
}

export interface DecisionResponse {
  verdict: 'VERIFIED' | 'SCAM';
  result: 'ALLOW' | 'DENY' | 'STEP_UP';
  reason: string;
  step_up?: {
    method: 'OUT_OF_BAND_CONFIRMATION';
    challenge_id: string;
  };
}

export function evaluateDecision(input: DecisionRequest): DecisionResponse {
  if (input.intent !== 'FRAUD_CALLBACK') {
    return {
      verdict: 'SCAM',
      result: 'DENY',
      reason: 'Unsupported intent.'
    };
  }

  switch (input.action) {
    case 'FREEZE_CARD':
      return {
        verdict: 'VERIFIED',
        result: 'STEP_UP',
        reason: 'Sensitive action requires customer confirmation.',
        step_up: {
          method: 'OUT_OF_BAND_CONFIRMATION',
          challenge_id: `chlg_${Math.random().toString(36).slice(2, 10)}`
        }
      };
    case 'ASK_OTP':
      return {
        verdict: 'SCAM',
        result: 'DENY',
        reason: 'OTP disclosure request is classified as social engineering.'
      };
    case 'WIRE_TRANSFER':
      return {
        verdict: 'SCAM',
        result: 'DENY',
        reason: 'Transfer requests are blocked in fraud callback context.'
      };
    case 'DISCUSS_CASE':
      return {
        verdict: 'VERIFIED',
        result: 'ALLOW',
        reason: 'Discussion-only action is allowed.'
      };
    default:
      return {
        verdict: 'SCAM',
        result: 'DENY',
        reason: 'Unknown action.'
      };
  }
}
