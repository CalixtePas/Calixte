import React, { useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/calixte/v1';
const e = React.createElement;

// Helper pour afficher une icône
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon' }, name);

function App() {
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); // null = IDLE
  const [verifyMsg, setVerifyMsg] = useState('');
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  const logAction = (msg) => setActionLog(prev => [msg, ...prev].slice(0, 4));

  function resetState() {
    setToken('');
    setVerified(null);
    setVerifyMsg('');
    setPayload(null);
    setInteractionId('');
    setPendingConfirmation('');
  }

  // UX FLUIDE : Simule la réception silencieuse du push de sécurité + vérification auto
  async function simulateIncomingCall(actorType) {
    setBusy(true);
    resetState();
    logAction(`📞 Appel entrant détecté (${actorType}). Recherche de preuve...`);
    
    try {
      // 1. Appel du backend de la banque (l'appelant) pour démarrer l'interaction
      const resStart = await fetch(`${API}/interactions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'app-mobile-user' })
      });
      const dataStart = await resStart.json();
      const rawToken = dataStart.token || '';
      setToken(rawToken);

      // 2. L'application mobile (le client) vérifie immédiatement la signature
      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      
      const result = await jwtVerify(rawToken, key, { issuer: 'calixte' });
      
      setVerified(true);
      setPayload(result.payload);
      setInteractionId(String(result.payload.sub));
      setVerifyMsg('Identité cryptographique confirmée.');
      logAction('✅ Preuve vérifiée en arrière-plan. Affichage du mode sécurisé.');

    } catch (err) {
      console.error(err);
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

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    setBusy(true);
    logAction(`L'appelant distant tente l'action: ${action}`);
    
    try {
      const res = await fetch(`${API}/policy/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
      const data = await res.json();
      
      if (data.decision === 'STEP_UP' && data.confirmation_id) {
        setPendingConfirmation(data.confirmation_id);
        logAction(`L'action nécessite une confirmation explicite (Step-up).`);
      } else if (data.decision === 'DENY') {
        logAction(`Bloqué par le serveur bancaire (DENY). Action interdite.`);
        alert(`Le serveur de la banque a bloqué la requête de l'appelant car elle est interdite dans ce contexte.`);
      } else if (data.decision === 'ALLOW') {
        logAction(`L'action a été autorisée silencieusement (ALLOW).`);
      }
    } catch (err) {
      logAction(`Erreur réseau lors de l'évaluation de la policy.`);
    } finally {
      setBusy(false);
    }
  }

  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ L\'utilisateur a approuvé l\'action sensible dans son app.');
      alert("Votre carte a été bloquée avec succès.");
    } catch (err) {
      logAction('Erreur lors de la confirmation.');
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    if (verified === true && summary.cannot.includes(actionName)) {
      logAction(`ALERTE : L'utilisateur tente l'action interdite : ${actionName}`);
      alert(`⚠️ RACCROCHEZ IMMÉDIATEMENT ⚠️\nL'appelant tente de vous manipuler pour faire une action (${actionName}) qu'un vrai conseiller ne demanderait jamais.`);
      return;
    }
    logAction(`Utilisateur initie lui-même: ${actionName}`);
    alert(`Vous avez initié manuellement : ${actionName}`);
  }

  return e('div', { className: 'app' },
    e('h1', null, Icon('shield'), 'Mon App Bancaire'),

    // Bannières de statut
    verified === null && e('div', { className: 'alert info' }, 
      Icon('info'), e('div', null, 'Sécurité standard active. Ne donnez jamais vos codes par téléphone.')
    ),
    verified === false && e('div', { className: 'alert danger' }, 
      Icon('warning'), e('div', null, e('strong', null, 'Appel non vérifié ! '), verifyMsg)
    ),
    verified === true && e('div', { className: 'alert warning' }, 
      Icon('verified_user'), e('div', null, e('strong', null, `Conseiller Vérifié (${payload?.actor_type}) en ligne. `), 'Toute action sensible nécessitera une validation dans cette application.')
    ),

    // Simulateur (en haut)
    e('div', { className: 'row', style: { justifyContent: 'center', margin: '2rem 0' } },
      e('button', { onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('support_agent'), 'Recevoir Appel (Vérifié)'),
      e('button', { className: 'secondary', onClick: simulateUnknownCall, disabled: busy }, Icon('phone_callback'), 'Recevoir Appel (Inconnu)')
    ),

    // Grille 2 colonnes
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

      // Colonne APPELANT (Seulement si vérifié)
      e('div', { className: 'card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', { style: { marginTop: 0 } }, 'Ce que fait le conseiller (API)'),
        verified ? e(React.Fragment, null,
          e('div', { style: { fontSize: '0.85rem', marginBottom: '1rem' } }, 
            e('span', { style: { color: '#0e7a0d', fontWeight: 'bold' } }, 'Peut demander : '), summary.can.join(', '), e('br'),
            e('span', { style: { color: '#da1e28', fontWeight: 'bold' } }, 'Interdit : '), summary.cannot.join(', ')
          ),
          e('div', { className: 'row', style: { flexDirection: 'column' } },
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('gavel'), 'Serveur: Initier Blocage Carte (Policy)'),
            e('button', { className: 'secondary', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('gavel'), 'Serveur: Initier Demande OTP (Policy)')
          )
        ) : e('p', { style: { fontSize: '0.9rem', color: '#666' } }, 'Impossible d\'interagir avec le serveur bancaire sans preuve d\'identité.')
      )
    ),

    // Modale Step-Up
    pendingConfirmation && e('div', { className: 'modal-overlay' },
      e('div', { className: 'modal' },
        e('h2', null, Icon('error'), 'Validation requise'),
        e('p', null, 'Votre conseiller tente de bloquer votre carte bancaire. Confirmez-vous cette action ?'),
        e('div', { className: 'row', style: { justifyContent: 'flex-end', marginTop: '2rem' } },
          e('button', { className: 'secondary', onClick: () => setPendingConfirmation('') }, 'Annuler'),
          e('button', { className: 'danger', onClick: approveAction, disabled: busy }, 'Bloquer la carte')
        )
      )
    ),

    // Outils de Dev (Cachés par défaut)
    e('details', null,
      e('summary', null, '🛠️ Afficher les logs et outils de développeur'),
      e('h4', { style: { margin: '1rem 0 0.5rem 0' } }, 'Logs API'),
      e('ul', { style: { fontSize: '0.85rem', color: '#444' } }, actionLog.map((log, i) => e('li', { key: i }, log))),
      e('h4', { style: { margin: '1rem 0 0.5rem 0' } }, 'Preuve JWT (Read-only)'),
      e('textarea', { readOnly: true, value: token })
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
