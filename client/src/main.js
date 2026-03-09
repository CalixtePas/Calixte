import React, { useMemo, useState, useRef } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/calixte/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon' }, name);

function App() {
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  
  // NOUVEAU : Référence pour garder la connexion temps réel ouverte
  const esRef = useRef(null);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  const logAction = (msg) => setActionLog(prev => [msg, ...prev].slice(0, 5));

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken('');
    setVerified(null);
    setVerifyMsg('');
    setPayload(null);
    setInteractionId('');
    setPendingConfirmation('');
    setPendingActionName('');
  }

  async function simulateIncomingCall(actorType) {
    setBusy(true);
    resetState();
    logAction(`📞 Appel entrant détecté (${actorType}). Recherche de preuve...`);
    
    try {
      const resStart = await fetch(`${API}/interactions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'app-mobile-user' })
      });
      const dataStart = await resStart.json();
      setToken(dataStart.token || '');

      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      const result = await jwtVerify(dataStart.token, key, { issuer: 'calixte' });
      
      setVerified(true);
      setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      setVerifyMsg('Identité cryptographique confirmée.');
      logAction('✅ Preuve vérifiée en arrière-plan. Affichage du mode sécurisé.');

      // MAGIE TEMPS RÉEL : L'appli se connecte au flux du serveur
      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(`${data.action} ${data.amount ? '(' + data.amount + '€)' : ''}`);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 PUSH REÇU : Validation requise pour ${data.action}.`);
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ INFO PUSH : Le conseiller a pu exécuter ${data.action} ${data.amount ? '('+data.amount+'€)' : ''}.`);
        } else if (data.type === 'DENY') {
          logAction(`❌ INFO PUSH : Le serveur a bloqué l'action du conseiller (${data.action}).`);
        }
      };
      esRef.current = es;

    } catch (err) {
      setVerified(false);
      setVerifyMsg('Preuve absente ou falsifiée.');
      logAction('❌ Impossible de vérifier l\'appelant.');
    } finally {
      setBusy(false);
    }
  }

  function simulateUnknownCall() {
    resetState();
    logAction('📞 Appel entrant normal (réseau classique, sans preuve de la banque).');
  }

  // Cette fonction simule l'interface d'administration du conseiller (à distance)
  async function simulateCallerAction(action, amount) {
    if (verified !== true) return;
    logAction(`[API Conseiller] Tente d'initier : ${action} ${amount ? amount+'€' : ''}`);
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action, amount })
      });
      // Plus besoin de gérer la modale ici ! Le Server-Sent Event s'en occupe tout seul.
    } catch (err) {
      logAction(`[API Conseiller] Erreur réseau.`);
    }
  }

  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ L\'utilisateur a approuvé le Step-Up.');
      alert("L'action a été validée cryptographiquement avec succès.");
    } catch (err) {
      logAction('Erreur lors de la confirmation.');
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    if (verified === true && summary.cannot.includes(actionName)) {
      logAction(`ALERTE : L'utilisateur tente l'action interdite : ${actionName}`);
      alert(`⚠️ RACCROCHEZ IMMÉDIATEMENT ⚠️\nL'appelant tente de vous manipuler pour faire une action interdite. C'est une fraude.`);
      return;
    }
    if (verified !== true) {
      const isSafe = confirm(`🛡️ RAPPEL DE SÉCURITÉ\n\nVous vous apprêtez à faire une action sensible (${actionName}).\n\nSi un soi-disant "conseiller" au téléphone vous demande de faire cela sans s'être identifié via l'application, C'EST UNE FRAUDE.\n\nÊtes-vous sûr de vouloir continuer cette action vous-même ?`);
      if (!isSafe) { logAction(`Action annulée par précaution.`); return; }
    }
    logAction(`Utilisateur initie lui-même: ${actionName}`);
    alert(`✅ Action exécutée : ${actionName}`);
  }

  return e('div', { className: 'app' },
    e('h1', null, Icon('shield'), 'Mon App Bancaire'),

    verified === null && e('div', { className: 'alert info' }, Icon('info'), e('div', null, 'Sécurité standard active. Ne donnez jamais vos codes par téléphone.')),
    verified === false && e('div', { className: 'alert danger' }, Icon('warning'), e('div', null, e('strong', null, 'Appel non vérifié ! '), verifyMsg)),
    verified === true && e('div', { className: 'alert warning' }, Icon('verified_user'), e('div', null, e('strong', null, `Conseiller Vérifié (${payload?.actor_type}). `), 'Toute action sensible nécessitera une validation dans cette app.')),

    e('div', { className: 'row', style: { justifyContent: 'center', margin: '2rem 0' } },
      e('button', { onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('support_agent'), 'Recevoir Appel (Vérifié)'),
      e('button', { className: 'secondary', onClick: simulateUnknownCall, disabled: busy }, Icon('phone_callback'), 'Recevoir Appel (Inconnu)')
    ),

    e('div', { className: 'grid' },
      // Colonne UTILISATEUR
      e('div', { className: 'card' },
        e('h3', { style: { marginTop: 0 } }, 'Ce que je fais (Mon App)'),
        e('div', { className: 'row', style: { flexDirection: 'column' } },
          e('button', { className: 'secondary', onClick: () => handleUserAction('FREEZE_CARD') }, Icon('credit_card_off'), 'Bloquer ma carte'),
          e('button', { className: 'secondary', onClick: () => handleUserAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Faire un virement'),
          e('button', { className: 'danger', onClick: () => handleUserAction('ASK_OTP') }, Icon('password'), 'Saisir un code de validation')
        )
      ),

      // Colonne APPELANT
      e('div', { className: 'card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', { style: { marginTop: 0 } }, 'Ce que fait le conseiller (API)'),
        verified ? e(React.Fragment, null,
          e('div', { style: { fontSize: '0.85rem', marginBottom: '1rem' } }, 
            e('span', { style: { color: '#0e7a0d', fontWeight: 'bold' } }, 'Peut demander : '), summary.can.join(', '), e('br'),
            e('span', { style: { color: '#da1e28', fontWeight: 'bold' } }, 'Interdit : '), summary.cannot.join(', ')
          ),
          e('div', { className: 'row', style: { flexDirection: 'column' } },
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('gavel'), 'Serveur: Bloquer Carte'),
            // NOUVEAU : Test de l'intelligence artificielle du moteur de règles (Montants)
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('WIRE_TRANSFER', 15) }, Icon('payments'), 'Serveur: Virement 15€ (Petit)'),
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('WIRE_TRANSFER', 2000) }, Icon('account_balance'), 'Serveur: Virement 2000€ (Gros)'),
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('gavel'), 'Serveur: Demander OTP')
          )
        ) : e('p', { style: { fontSize: '0.9rem', color: '#666' } }, 'Impossible d\'interagir avec le serveur sans identité.')
      )
    ),

    // Modale Step-Up
    pendingConfirmation && e('div', { className: 'modal-overlay' },
      e('div', { className: 'modal' },
        e('h2', null, Icon('error'), 'Validation requise'),
        e('p', null, `Votre conseiller tente de : `),
        e('h3', {style: {textAlign: 'center'}}, pendingActionName),
        e('p', null, 'Confirmez-vous cette action ?'),
        e('div', { className: 'row', style: { justifyContent: 'flex-end', marginTop: '2rem' } },
          e('button', { className: 'secondary', onClick: () => setPendingConfirmation('') }, 'Annuler'),
          e('button', { className: 'danger', onClick: approveAction, disabled: busy }, 'Autoriser')
        )
      )
    ),

    e('details', null,
      e('summary', null, '🛠️ Afficher les logs (Temps réel)'),
      e('ul', { style: { fontSize: '0.85rem', color: '#444' } }, actionLog.map((log, i) => e('li', { key: i }, log))),
      e('h4', { style: { margin: '1rem 0 0.5rem 0' } }, 'Preuve JWT'),
      e('textarea', { readOnly: true, value: token })
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
