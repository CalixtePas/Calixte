import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { buildServer } from '../src/app.ts';
import { confirmations, resetStore } from '../src/store.ts';

function decodePart(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, 'base64').toString('utf8');
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json() };
}

test('start -> token verifiable via JWKS', async () => {
  const app = buildServer();
  await app.listen(3401);

  const start = await json('http://127.0.0.1:3401/calixte/v1/interactions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_type: 'AI_AGENT', intent: 'FRAUD_CALLBACK', audience_ref: 'aud-123' })
  });

  assert.equal(start.status, 200);
  assert.ok(start.body.interaction_id);

  const jwks = await json('http://127.0.0.1:3401/calixte/v1/jwks');
  assert.equal(jwks.status, 200);
  assert.ok(Array.isArray(jwks.body.keys));

  const token = start.body.token as string;
  const [h, p, s] = token.split('.');
  const payload = JSON.parse(decodePart(p));

  assert.equal(payload.exp - payload.iat, 600);
  assert.ok(payload.allow.includes('DISCUSS_CASE'));
  assert.ok(payload.deny.includes('ASK_OTP'));

  const key = createPublicKey({ key: jwks.body.keys[0], format: 'jwk' });
  const ok = verify(
    null,
    Buffer.from(`${h}.${p}`),
    key,
    Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  );
  assert.equal(ok, true);

  await app.close();
  resetStore();
});

test('evaluate ASK_OTP -> DENY', async () => {
  const app = buildServer();
  await app.listen(3402);

  const start = await json('http://127.0.0.1:3402/calixte/v1/interactions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_type: 'HUMAN_AGENT', intent: 'FRAUD_CALLBACK', audience_ref: 'aud-askotp' })
  });

  const evaluate = await json('http://127.0.0.1:3402/calixte/v1/policy/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interaction_id: start.body.interaction_id, action: 'ASK_OTP' })
  });

  assert.equal(evaluate.body.decision, 'DENY');
  await app.close();
  resetStore();
});

test('evaluate FREEZE_CARD -> STEP_UP + confirmation_id', async () => {
  const app = buildServer();
  await app.listen(3403);

  const start = await json('http://127.0.0.1:3403/calixte/v1/interactions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_type: 'AI_AGENT', intent: 'FRAUD_CALLBACK', audience_ref: 'aud-freeze' })
  });

  const evaluate = await json('http://127.0.0.1:3403/calixte/v1/policy/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interaction_id: start.body.interaction_id, action: 'FREEZE_CARD' })
  });

  assert.equal(evaluate.body.decision, 'STEP_UP');
  assert.ok(evaluate.body.confirmation_id);
  await app.close();
  resetStore();
});

test('approve confirmation -> status APPROVED', async () => {
  const app = buildServer();
  await app.listen(3404);

  const start = await json('http://127.0.0.1:3404/calixte/v1/interactions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_type: 'AI_AGENT', intent: 'FRAUD_CALLBACK', audience_ref: 'aud-confirm' })
  });

  const evaluate = await json('http://127.0.0.1:3404/calixte/v1/policy/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interaction_id: start.body.interaction_id, action: 'FREEZE_CARD' })
  });

  const id = evaluate.body.confirmation_id as string;
  const approve = await json(`http://127.0.0.1:3404/calixte/v1/confirmations/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  assert.equal(approve.body.status, 'APPROVED');
  assert.equal(confirmations.get(id)?.status, 'APPROVED');
  await app.close();
  resetStore();
});

test('evaluate unknown interaction -> DENY', async () => {
  const app = buildServer();
  await app.listen(3405);

  const evaluate = await json('http://127.0.0.1:3405/calixte/v1/policy/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interaction_id: 'unknown', action: 'DISCUSS_CASE' })
  });

  assert.equal(evaluate.body.decision, 'DENY');
  assert.match(evaluate.body.reason, /UNVERIFIED/);
  await app.close();
  resetStore();
});
