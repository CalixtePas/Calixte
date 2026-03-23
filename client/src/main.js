import React, { useMemo, useState, useRef } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/calixte/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon' }, name);

function App() {
  // États de l'application
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); // null = IDLE, true = VÉRIFIÉ, false = SCAM
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  
  // Modales et Toasts
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const esRef = useRef(null);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);

  // Système de logs et de notifications in-app
  const logAction = (msg, type = 'info') => setActionLog(prev => [{msg, type, t: new Date().toLocaleTimeString()}, ...prev].slice(0, 50));
  
  const showToast = (msg) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setPendingConfirmation(''); setPendingActionName(''); setScamAlert('');
  }

  // --- ACTIONS DU SIMULATEUR (APPELANT) ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    logAction(`Simulation d'appel entrant (${actorType})...`);
    
    try {
      const resStart = await fetch(`${API}/interactions/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'app-mobile-user' })
      });
      const dataStart = await resStart.json();
      setToken(dataStart.token || '');

      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      const result = await jwtVerify(dataStart.token, key, { issuer: 'calixte' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      logAction(`✅ Preuve EdDSA vérifiée. Canal sécurisé ouvert.`, 'success');

      // Connexion Temps Réel
      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 PUSH: Le serveur demande une validation client pour ${data.action}.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ PUSH: Action serveur autorisée (${data.action}).`);
        } else if (data.type === 'DENY') {
          logAction(`❌ PUSH: Action interdite bloquée par le serveur (${data.action}).`, 'err');
          setScamAlert(`L'appelant tente d'exécuter une action interdite : ${data.action}.\n\nUn vrai conseiller bancaire ne demandera JAMAIS cela. Ceci est une fraude, raccrochez immédiatement.`);
        }
      };
      esRef.current = es;
    } catch (err) {
      setVerified(false);
      logAction('❌ Impossible de vérifier l\'appelant. (Faux token ou erreur)', 'err');
    } finally {
      setBusy(false);
    }
  }

  function simulateUnknownCall() {
    resetState();
    setVerified(false); // Mode appel non vérifié
    logAction('Appel entrant classique. Aucune preuve cryptographique reçue.');
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    logAction(`Le conseiller demande à l'API : ${action}`);
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
    } catch (err) { logAction(`Erreur réseau (Caller API).`, 'err'); }
  }

  // --- ACTIONS DE L'UTILISATEUR (IN-APP) ---
  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ L\'utilisateur a approuvé avec succès via l\'App.', 'success');
      showToast("Opération confirmée et sécurisée.");
    } catch (err) {
      showToast("Erreur lors de la confirmation.");
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    if (verified === true && summary.cannot.includes(actionName)) {
      logAction(`L'utilisateur tente une action dangereuse (${actionName}) pendant un appel!`, 'err');
      setScamAlert(`Vous tentez de réaliser une action (${actionName}) alors qu'un conseiller est en ligne.\n\nS'il vous a demandé de le faire, c'est une manipulation. Raccrochez.`);
      return;
    }
    if (verified === false) { // Appel inconnu en cours
      const isSafe = confirm(`🛡️ SÉCURITÉ\nUn appel non vérifié est en cours. Ne faites aucune opération sensible sous la dictée d'un inconnu. Continuer ?`);
      if (!isSafe) return;
    }
    showToast(`Vous avez cliqué sur : ${actionName}`);
  }

  // Rendu
  return e('div', { className: 'demo-container' },
    
    // ==========================================
    // COLONNE GAUCHE : LE TÉLÉPHONE (APP MOBILE)
    // ==========================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        // Header de l'app
        e('div', { className: 'mobile-header' },
          e('h2', null, 'Bonjour, Alex 👋'),
          e('p', null, 'Vos comptes sont à jour')
        ),

        // Bannière d'appel dynamique
        verified === true && e('div', { className: 'call-banner verified' }, Icon('verified_user'), 'Appel sécurisé en cours'),
        verified === false && e('div', { className: 'call-banner unknown' }, Icon('phone_in_talk'), 'Appel entrant inconnu'),

        // Contenu de l'app
        e('div', { className: 'mobile-content' },
          e('div', { className: 'bank-card' },
            e('div', { style: { fontSize: '0.85rem', opacity: 0.8 } }, 'Compte Courant'),
            e('div', { className: 'balance' }, '12 450,00 €'),
            e('div', { style: { fontFamily: 'monospace', opacity: 0.7 } }, '**** **** **** 4092')
          ),

          e('div', { className: 'action-grid' },
            e('div', { className: 'action-btn', onClick: () => handleUserAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Virement'),
            e('div', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, Icon('chat'), 'Messagerie'),
            e('div', { className: 'action-btn danger', onClick: () => handleUserAction('FREEZE_CARD') }, Icon('credit_card_off'), 'Bloquer carte'),
            e('div', { className: 'action-btn danger', onClick: () => handleUserAction('ASK_OTP') }, Icon('password'), 'Code (OTP)')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '1rem' } }, 'Transactions récentes'),
          e('div', { style: { fontSize: '0.9rem', color: '#555', padding: '1rem', background: 'white', borderRadius: '8px' } }, 'Netflix - 13,99 €')
        ),

        // Superposition : Modale Step-Up (Validation)
        pendingConfirmation && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('div', { style: { color: 'var(--primary)', marginBottom: '1rem' } }, Icon('fingerprint')),
            e('h3', { style: { margin: '0 0 0.5rem' } }, 'Validation requise'),
            e('p', { style: { fontSize: '0.85rem', color: '#666' } }, `Autorisez-vous l'action : ${pendingActionName} ?`),
            e('button', { className: 'modal-btn red', onClick: approveAction, disabled: busy }, 'Autoriser (FaceID)'),
            e('button', { className: 'modal-btn grey', onClick: () => setPendingConfirmation('') }, 'Annuler')
          )
        ),

        // Superposition : Modale Alerte Fraude (Scam)
        scamAlert && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal danger' },
            e('div', { style: { color: 'var(--danger)', marginBottom: '0.5rem' } }, Icon('warning')),
            e('h3', { style: { margin: '0 0 0.5rem', color: 'var(--danger)' } }, 'Tentative de Fraude'),
            e('p', { style: { fontSize: '0.85rem', whiteSpace: 'pre-wrap' } }, scamAlert),
            e('button', { className: 'modal-btn grey', onClick: resetState }, 'J\'ai raccroché')
          )
        ),

        // Notifications (Toasts)
        e('div', { className: 'toast-container' },
          toasts.map(t => e('div', { key: t.id, className: 'toast' }, t.msg))
        )
      )
    ),

    // ==========================================
    // COLONNE DROITE : CONSOLE D'ADMINISTRATION
    // ==========================================
    e('div', { className: 'admin-panel' },
      
      // Bloc 1 : Déclenchement des appels
      e('div', { className: 'admin-card' },
        e('h3', null, Icon('settings_phone'), '1. Simuler un appel vers le client'),
        e('p', { style: { fontSize: '0.85rem', color: '#555' } }, 'Déclenche un appel et génère la preuve cryptographique (Token JWT).'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, 'Appel Vérifié (Banque)'),
          e('button', { className: 'control-btn', onClick: simulateUnknownCall, disabled: busy }, 'Appel Normal (Arnaqueur)')
        )
      ),

      // Bloc 2 : Actions du serveur (Policy Engine)
      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('admin_panel_settings'), '2. Actions du conseiller (Serveur)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555' } }, verified ? 'Le canal est ouvert. Le conseiller tente de déclencher des actions via l\'API.' : 'Connectez un appel vérifié pour interagir avec l\'API.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, 'Demander Blocage Carte (Passe)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, 'Demander Virement (Bloqué)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('ASK_OTP') }, 'Demander Code OTP (Bloqué)')
        )
      ),

      // Bloc 3 : Logs en temps réel
      e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
        e('h3', null, Icon('terminal'), 'Logs d\'audit (Temps Réel)'),
        e('div', { className: 'logs' },
          actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
