import React, { useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/calixte/v1';
const e = React.createElement;

function App() {
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); // null = IDLE
  const [verifyMsg, setVerifyMsg] = useState('');
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  const [policyResult, setPolicyResult] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);

  const logAction = (msg) => setActionLog(prev => [msg, ...prev].slice(0, 5));

  function resetState(keepToken = false) {
    if (!keepToken) setToken('');
    setVerified(null);
    setVerifyMsg('');
    setPayload(null);
    setInteractionId('');
    setPolicyResult(null);
    setPendingConfirmation('');
  }

  async function startCall(actorType) {
    setBusy(true);
    resetState();
    logAction(`Réception appel simulé (${actorType})...`);
    try {
      const res = await fetch(`${API}/interactions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'web-verifier' })
      });
      const data = await res.json();
      setToken(data.token || '');
      logAction(`Preuve cryptographique reçue.`);
    } catch (err) {
      console.error(err);
      logAction('Erreur réseau au démarrage.');
    } finally {
      setBusy(false);
    }
  }

  function simulateUnknownCall() {
    resetState();
    logAction('Appel entrant inconnu (aucun token). L\'app reste en sécurité habituelle.');
  }

  async function verifyToken() {
    if (!token) return;
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
      setInteractionId(String(result.payload.sub));
      setVerifyMsg('Preuve valide : identité et contexte confirmés.');
      logAction('Appel vérifié avec succès.');
    } catch (err) {
      console.error(err);
      // CORRECTION DU BUG D'ÉTAT ICI
      setVerified(false);
      setVerifyMsg('Preuve invalide ou falsifiée. Confiance révoquée.');
      setPayload(null);
      setInteractionId('');
      setPendingConfirmation('');
      setPolicyResult(null);
      logAction('Échec de la vérification de la preuve.');
    } finally {
      setBusy(false);
    }
  }

  async function simulateCallerAction(action) {
    if (verified !== true) {
      logAction(`Refusé: L'appelant tente ${action} mais n'est pas vérifié.`);
      return;
    }
    setBusy(true);
    setPolicyResult(null);
    logAction(`L'appelant initie l'action: ${action}`);
    try {
      const res = await fetch(`${API}/policy/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
      const data = await res.json();
      setPolicyResult(data);
      if (data.decision === 'STEP_UP' && data.confirmation_id) {
        setPendingConfirmation(data.confirmation_id);
        logAction(`Action requiert un Step-Up.`);
      } else if (data.decision === 'DENY') {
        logAction(`Action bloquée par le Policy Engine (DENY).`);
      }
    } catch (err) {
      console.error(err);
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
      setPendingConfirmation('');
      logAction('L\'utilisateur a approuvé le Step-Up.');
    } catch (err) {
      console.error(err);
      setPolicyResult((prev) => ({ ...prev, approve: { error: 'Erreur approve' } }));
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName, isSensitive) {
    if (verified === true && summary.cannot.includes(actionName)) {
      logAction(`ALERTE: Tentative de ${actionName} pendant un appel qui l'interdit !`);
      alert(`⚠️ ATTENTION ⚠️\nL'appelant vérifié a interdiction de vous demander cela (${actionName}). S'il vous y pousse, c'est une manipulation. Raccrochez.`);
      return;
    }
    logAction(`L'utilisateur effectue lui-même: ${actionName}`);
    if (isSensitive) alert(`Action utilisateur : ${actionName} exécutée.`);
  }

  return e('div', { className: 'app' },
    e('h1', null, '🛡️ Calixte App'),
    e('p', null, 'Simulation du comportement de l\'application bancaire face aux appels entrants.'),

    e('div', { className: 'row' },
      e('button', { onClick: () => startCall('AI_AGENT'), disabled: busy }, '📞 Appel entrant (IA)'),
      e('button', { onClick: simulateUnknownCall, disabled: busy, className: 'secondary' }, '📞 Appel entrant (Inconnu)'),
      e('button', { onClick: verifyToken, disabled: busy || !token }, '🔐 Vérifier la preuve (JWKS)')
    ),

    e('textarea', {
      placeholder: 'JWT Token (généré ou collé ici)...',
      value: token,
      onChange: (evt) => setToken(evt.target.value.trim())
    }),

    verified === null && e('div', { className: 'alert info' }, 'ℹ️ Mode IDLE : Sécurité habituelle. Ne réalisez aucune action sensible sous la pression d\'un appelant inconnu.'),
    verified === false && e('div', { className: 'alert danger' }, '❌ SCAM DÉTECTÉ : La preuve fournie est invalide. ' + verifyMsg),
    verified === true && e('div', { className: 'alert warning' }, `✅ APPEL VÉRIFIÉ : Conseiller distant (${payload?.actor_type}). Écoutez ses conseils, mais validez systématiquement les actions sensibles via l'application.`),

    e('div', { className: 'grid' },
      e('div', { className: 'card' },
        e('h3', null, 'Actions de l\'Appelant'),
        e('p', { style: { fontSize: '0.85rem', color: '#666' } }, 'Ce que la personne au téléphone essaie de faire via l\'API serveur.'),
        
        verified === true && e(React.Fragment, null,
          e('div', null, e('strong', null, 'Permissions (Policy) :')),
          e('ul', null, 
            summary.can.map(x => e('li', { key: `can-${x}`, style: { color: '#0e7a0d' } }, `✅ Peut initier : ${x}`)),
            summary.cannot.map(x => e('li', { key: `cannot-${x}`, style: { color: '#da1e28' } }, `❌ Ne peut PAS demander : ${x}`))
          )
        ),

        e('div', { className: 'row', style: { flexDirection: 'column', alignItems: 'flex-start' } },
          e('button', { className: 'secondary', onClick: () => simulateCallerAction('ASK_OTP'), disabled: busy || !interactionId }, 'Appelant demande un OTP'),
          e('button', { className: 'secondary', onClick: () => simulateCallerAction('FREEZE_CARD'), disabled: busy || !interactionId }, 'Appelant initie FREEZE_CARD'),
          e('button', { className: 'secondary', onClick: () => simulateCallerAction('WIRE_TRANSFER'), disabled: busy || !interactionId }, 'Appelant demande un Virement')
        ),
        policyResult && e('pre', { style: { background: '#f4f4f4', padding: '0.5rem', borderRadius: '4px', fontSize: '0.8rem', whiteSpace: 'pre-wrap' } }, JSON.stringify(policyResult, null, 2))
      ),

      e('div', { className: 'card' },
        e('h3', null, 'Actions de l\'Utilisateur'),
        e('p', { style: { fontSize: '0.85rem', color: '#666' } }, 'Ce que vous faites vous-même dans l\'application.'),
        
        pendingConfirmation && e('div', { className: 'alert warning' },
          e('strong', null, '⚠️ Action requise'),
          e('p', null, 'L\'appelant a initié le blocage de votre carte. Confirmez-vous cette action ?'),
          e('button', { onClick: approve, disabled: busy }, '✅ Approuver (Step-up)')
        ),

        e('div', { className: 'row', style: { flexDirection: 'column', alignItems: 'flex-start' } },
          e('button', { className: 'secondary', onClick: () => handleUserAction('FREEZE_CARD', true) }, 'Je bloque ma carte moi-même'),
          e('button', { className: 'danger', onClick: () => handleUserAction('ASK_OTP', true) }, 'Je saisis un OTP manuellement'),
          e('button', { className: 'danger', onClick: () => handleUserAction('WIRE_TRANSFER', true) }, 'Je fais un virement manuellement')
        )
      )
    ),

    e('div', { style: { marginTop: '2rem', fontSize: '0.85rem', color: '#555' } },
      e('h4', { style: { margin: '0 0 0.5rem 0' } }, 'Console Debug'),
      e('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
        actionLog.map((log, i) => e('li', { key: i, style: { padding: '0.2rem 0', borderBottom: '1px solid #eee' } }, `> ${log}`))
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
