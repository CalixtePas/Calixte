import React, { useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = 'http://localhost:3001/calixte/v1';

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function App() {
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  const [policyResult, setPolicyResult] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);

  async function startVerified() {
    setBusy(true);
    setVerifyMsg('');
    try {
      const res = await fetch(`${API}/interactions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_type: 'AI_AGENT', intent: 'FRAUD_CALLBACK', audience_ref: 'web-verifier' })
      });
      const data = await res.json();
      setToken(data.token || '');
      setInteractionId(data.interaction_id || '');
      setPolicyResult(null);
      setPendingConfirmation('');
      if (data.token) {
        setPayload(decodeJwtPayload(data.token));
      }
    } catch (e) {
      console.error(e);
      setVerifyMsg('Erreur au démarrage de la démo.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyToken() {
    setBusy(true);
    setVerifyMsg('');
    try {
      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const keyJwk = jwks?.keys?.[0];
      if (!keyJwk) throw new Error('JWKS vide');
      const key = await importJWK(keyJwk, 'EdDSA');
      const result = await jwtVerify(token, key, { issuer: 'calixte' });

      setVerified(true);
      setPayload(result.payload);
      if (!interactionId && result.payload?.sub) setInteractionId(String(result.payload.sub));
      setVerifyMsg('Token valide et signé par Calixte.');
    } catch (err) {
      console.error(err);
      setVerified(false);
      setVerifyMsg('Token non vérifié.');
      const p = decodeJwtPayload(token);
      if (p) setPayload(p);
    } finally {
      setBusy(false);
    }
  }

  async function simulateFreezeCard() {
    setBusy(true);
    setPolicyResult(null);
    try {
      const res = await fetch(`${API}/policy/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action: 'FREEZE_CARD' })
      });
      const data = await res.json();
      setPolicyResult(data);
      if (data.decision === 'STEP_UP' && data.confirmation_id) {
        setPendingConfirmation(data.confirmation_id);
      }
    } catch (e) {
      console.error(e);
      setPolicyResult({ error: 'Erreur policy/evaluate' });
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!pendingConfirmation) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      const data = await res.json();
      setPolicyResult((prev) => ({ ...prev, approve: data }));
    } catch (e) {
      console.error(e);
      setPolicyResult((prev) => ({ ...prev, approve: { error: 'Erreur approve' } }));
    } finally {
      setBusy(false);
    }
  }

  return React.createElement('div', { className: 'app' },
    React.createElement('h1', null, 'Calixte Verifier'),
    React.createElement('p', null, 'Flow: Start Verified → Verify → FREEZE_CARD → Approve'),

    React.createElement('div', { className: 'row' },
      React.createElement('button', { onClick: startVerified, disabled: busy }, 'Start Verified AI Call'),
      React.createElement('button', { onClick: verifyToken, disabled: busy || !token }, 'Verify')
    ),

    React.createElement('label', null, 'JWT token'),
    React.createElement('textarea', {
      value: token,
      onChange: (e) => setToken(e.target.value.trim())
    }),

    React.createElement('div', { className: 'card' },
      React.createElement('div', { className: verified ? 'ok' : 'warn' }, verified ? '✅ Vérifié' : '⚠️ Non vérifié'),
      React.createElement('div', null, verifyMsg || 'Collez un token puis cliquez Verify.'),
      React.createElement('div', null, 'interaction_id: ', React.createElement('code', null, interactionId || '-')),
      React.createElement('div', null, 'actor_type: ', React.createElement('strong', null, payload?.actor_type || '-')),
      React.createElement('div', null, 'intent: ', React.createElement('strong', null, payload?.intent || '-')),
      React.createElement('div', { className: 'row' },
        React.createElement('div', null,
          React.createElement('div', null, 'summary.can'),
          React.createElement('ul', null,
            ...(summary?.can || []).slice(0, 3).map((x) => React.createElement('li', { key: `can-${x}` }, x))
          )
        ),
        React.createElement('div', null,
          React.createElement('div', null, 'summary.cannot'),
          React.createElement('ul', null,
            ...(summary?.cannot || []).slice(0, 3).map((x) => React.createElement('li', { key: `cannot-${x}` }, x))
          )
        )
      )
    ),

    React.createElement('div', { className: 'row' },
      React.createElement('button', { className: 'secondary', onClick: simulateFreezeCard, disabled: busy || !interactionId }, 'Simuler FREEZE_CARD'),
      pendingConfirmation ? React.createElement('button', { onClick: approve, disabled: busy }, 'Approve') : null
    ),

    policyResult ? React.createElement('pre', { className: 'card' }, JSON.stringify(policyResult, null, 2)) : null
  );
}

createRoot(document.getElementById('root')).render(React.createElement(App));
