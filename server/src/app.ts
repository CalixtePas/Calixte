import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { confirmations, interactions, pushAudit, type ActorType, type Decision } from './store.ts';
import { getJwks, signToken } from './jwt.ts';

const PREFIX = '/calixte/v1';

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: Json) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
  } catch {
    return {};
  }
}

function evaluateAction(action: string): { decision: Decision; reason: string } {
  switch (action) {
    case 'ASK_OTP':
      return { decision: 'DENY', reason: 'OTP requests are blocked as scam indicators.' };
    case 'WIRE_TRANSFER':
      return { decision: 'DENY', reason: 'Wire transfer not allowed in fraud callback flow.' };
    case 'FREEZE_CARD':
      return { decision: 'STEP_UP', reason: 'Card freeze requires out-of-band confirmation.' };
    case 'DISCUSS_CASE':
      return { decision: 'ALLOW', reason: 'Discussion-only action is permitted.' };
    default:
      return { decision: 'DENY', reason: 'Unknown action for this policy.' };
  }
}

export function buildServer() {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return send(res, 200, {});

    if (req.method === 'GET' && req.url === `${PREFIX}/jwks`) {
      return send(res, 200, getJwks());
    }

    if (req.method === 'POST' && req.url === `${PREFIX}/interactions/start`) {
      const body = (await readBody(req)) as {
        actor_type?: ActorType;
        intent?: 'FRAUD_CALLBACK';
        audience_ref?: string;
      };

      if (!body.actor_type || !body.intent || !body.audience_ref) {
        return send(res, 400, { error: 'actor_type, intent, audience_ref are required' });
      }

      const interaction_id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 10 * 60;
      interactions.set(interaction_id, {
        interaction_id,
        actor_type: body.actor_type,
        intent: body.intent,
        audience_ref: body.audience_ref,
        created_at: Date.now()
      });

      const summary = {
        can: ['DISCUSS_CASE', 'FREEZE_CARD_WITH_STEP_UP'],
        cannot: ['ASK_OTP', 'WIRE_TRANSFER', 'SHARE_SECRETS']
      };

      const token = signToken({
        iss: 'calixte',
        sub: interaction_id,
        aud: body.audience_ref,
        iat: now,
        exp,
        actor_type: body.actor_type,
        intent: body.intent,
        allow: ['DISCUSS_CASE'],
        deny: ['ASK_OTP', 'WIRE_TRANSFER'],
        summary
      });

      pushAudit('interaction.start', { interaction_id, actor_type: body.actor_type, intent: body.intent });
      return send(res, 200, { interaction_id, token, summary });
    }

    if (req.method === 'POST' && req.url === `${PREFIX}/policy/evaluate`) {
      const body = (await readBody(req)) as { interaction_id?: string; action?: string };
      if (!body.interaction_id || !body.action) {
        return send(res, 200, { decision: 'DENY', reason: 'interaction_id and action are required' });
      }

      const interaction = interactions.get(body.interaction_id);
      if (!interaction) {
        pushAudit('policy.evaluate', {
          interaction_id: body.interaction_id,
          action: body.action,
          decision: 'DENY'
        });
        return send(res, 200, { decision: 'DENY', reason: 'UNVERIFIED interaction_id' });
      }

      const base = evaluateAction(body.action);
      if (base.decision === 'STEP_UP') {
        const id = randomUUID();
        confirmations.set(id, {
          id,
          interaction_id: interaction.interaction_id,
          status: 'PENDING',
          created_at: Date.now()
        });
        pushAudit('confirmation.created', { id, interaction_id: interaction.interaction_id });
        pushAudit('policy.evaluate', {
          interaction_id: interaction.interaction_id,
          action: body.action,
          decision: base.decision
        });
        return send(res, 200, { ...base, confirmation_id: id });
      }

      pushAudit('policy.evaluate', {
        interaction_id: interaction.interaction_id,
        action: body.action,
        decision: base.decision
      });
      return send(res, 200, base);
    }

    if (req.method === 'POST' && req.url?.startsWith(`${PREFIX}/confirmations/`) && req.url.endsWith('/approve')) {
      const id = req.url.slice(`${PREFIX}/confirmations/`.length, -'/approve'.length);
      const confirmation = confirmations.get(id);
      if (!confirmation) return send(res, 404, { error: 'Confirmation not found' });

      confirmation.status = 'APPROVED';
      pushAudit('confirmation.approved', { id, interaction_id: confirmation.interaction_id });
      return send(res, 200, { status: 'APPROVED' });
    }

    return send(res, 404, { error: 'Not found' });
  });

  return {
    server,
    listen(port = 3000, host = '0.0.0.0') {
      return new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
    },
    close() {
      return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  };
}
