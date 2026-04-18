import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { confirmations, interactions, pushAudit, clients, broadcast, telco_state, setTelcoState, type ActorType, type Decision } from './store.ts';
import { getJwks, signToken } from './jwt.ts';

const PREFIX = '/castor/v1';

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: Json) {
  if (res.headersSent) return;
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
    case 'ASK_OTP': return { decision: 'DENY', reason: 'OTP requests are strictly blocked as scam indicators.' };
    case 'WIRE_TRANSFER': return { decision: 'DENY', reason: 'Wire transfers initiated by caller are strictly forbidden, regardless of amount.' };
    case 'FREEZE_CARD': return { decision: 'STEP_UP', reason: 'Card freeze requires out-of-band confirmation.' };
    case 'DISCUSS_CASE': return { decision: 'ALLOW', reason: 'Discussion-only action is permitted.' };
    default: return { decision: 'DENY', reason: 'Unknown action for this policy.' };
  }
}

export function buildServer() {
  const server = createServer(async (req, res) => {
    const origin = process.env.FRONTEND_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Connection, X-Accel-Buffering');
    
    if (req.method === 'OPTIONS') return send(res, 200, {});

    const streamMatch = req.url?.match(new RegExp(`^${PREFIX}/interactions/([^/]+)/stream$`));
    if (req.method === 'GET' && streamMatch) {
      const interaction_id = streamMatch[1];
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); 
      res.write('data: {"type":"CONNECTED"}\n\n');

      if (!clients.has(interaction_id)) clients.set(interaction_id, new Set());
      clients.get(interaction_id)!.add(res);

      req.on('close', () => clients.get(interaction_id)?.delete(res));
      return;
    }

    if (req.method === 'GET' && req.url === `${PREFIX}/jwks`) {
      return send(res, 200, getJwks());
    }

    if (req.method === 'POST' && req.url === `${PREFIX}/interactions/start`) {
      const body = (await readBody(req)) as { actor_type?: ActorType; intent?: 'FRAUD_CALLBACK'; audience_ref?: string; };
      if (!body.actor_type || !body.intent || !body.audience_ref) return send(res, 400, { error: 'Missing fields' });

      const interaction_id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      interactions.set(interaction_id, { interaction_id, actor_type: body.actor_type, intent: body.intent, audience_ref: body.audience_ref, created_at: Date.now() });

      const summary = {
        can: ['DISCUSS_CASE', 'FREEZE_CARD_WITH_STEP_UP'],
        cannot: ['ASK_OTP', 'WIRE_TRANSFER', 'SHARE_SECRETS']
      };

      const token = signToken({ iss: 'castor', sub: interaction_id, aud: body.audience_ref, iat: now, exp: now + 10 * 60, actor_type: body.actor_type, intent: body.intent, summary });
      pushAudit('interaction.start', { interaction_id });
      return send(res, 200, { interaction_id, token, summary });
    }

    if (req.method === 'POST' && req.url === `${PREFIX}/policy/evaluate`) {
      const body = (await readBody(req)) as { interaction_id?: string; action?: string; };
      if (!body.interaction_id || !body.action) return send(res, 200, { decision: 'DENY', reason: 'missing fields' });

      const interaction = interactions.get(body.interaction_id);
      if (!interaction) return send(res, 200, { decision: 'DENY', reason: 'UNVERIFIED' });

      const base = evaluateAction(body.action);
      
      if (base.decision === 'STEP_UP') {
        const id = randomUUID();
        confirmations.set(id, { id, interaction_id: interaction.interaction_id, status: 'PENDING', created_at: Date.now() });
        broadcast(interaction.interaction_id, { type: 'STEP_UP', confirmation_id: id, action: body.action });
        return send(res, 200, { ...base, confirmation_id: id });
      }

      broadcast(interaction.interaction_id, { type: base.decision, action: body.action });
      return send(res, 200, base);
    }

    if (req.method === 'POST' && req.url?.startsWith(`${PREFIX}/confirmations/`) && req.url.endsWith('/approve')) {
      const id = req.url.split('/')[4];
      const confirmation = confirmations.get(id);
      if (!confirmation) return send(res, 404, { error: 'Not found' });
      confirmation.status = 'APPROVED';
      broadcast(confirmation.interaction_id, { type: 'APPROVED', action_id: id });
      return send(res, 200, { status: 'APPROVED' });
    }

    // Routes API Telco ajoutées
    if (req.method === 'GET' && req.url?.startsWith(`${PREFIX}/telco/call-status`)) {
      return send(res, 200, { active_call: telco_state.active_call, network: 'Orange FR' });
    }

    if (req.method === 'POST' && req.url === `${PREFIX}/admin/telco-status`) {
      const body = (await readBody(req)) as { active_call?: boolean };
      if (typeof body.active_call === 'boolean') {
        setTelcoState(body.active_call);
      }
      return send(res, 200, { active_call: telco_state.active_call });
    }

    return send(res, 404, { error: 'Not found' });
  });

  return {
    server,
    listen(port = 3000, host = '0.0.0.0') { return new Promise<void>((resolve) => server.listen(port, host, () => resolve())); },
    close() { return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); }
  };
}
