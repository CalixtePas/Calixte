import React, { useMemo, useState, useRef } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/castor/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon' }, name);

const RECIPIENTS = [
  'Nouveau bénéficiaire...',
  'Bailleur (Loyer Mensuel)',
  'Maître Leblanc (Notaire Immo)',
  'Jean Dupont (Remboursement)',
  'Compte Épargne Externe'
];

function App() {
  const [balance, setBalance] = useState(12450.00);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); 
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  
  const [isTransferPageOpen, setIsTransferPageOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const esRef = useRef(null);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  
  // Formatage propre du nom de l'appelant
  const actorName = payload?.actor_type === 'AI_AGENT' ? 'Agent IA' : 'Conseiller Humain';

  const logAction = (msg, type = 'info') => setActionLog(prev => [{msg, type, t: new Date().toLocaleTimeString()}, ...prev].slice(0, 50));
  
  const showToast = (msg) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setPendingConfirmation(''); setPendingActionName(''); setScamAlert('');
    setIsTransferPageOpen(false); setShowPermissionsPopup(false);
    logAction("Session réinitialisée.", 'info');
  }

  // --- ACTIONS DU SIMULATEUR ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    const displayActor = actorType === 'AI_AGENT' ? 'Agent IA' : 'Conseiller Humain';
    logAction(`Connexion sécurisée avec ${displayActor} en cours...`);
    
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
      
      const result = await jwtVerify(dataStart.token, key, { issuer: 'castor' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      
      setShowPermissionsPopup(true);
      logAction(`✅ Preuve EdDSA valide. Canal temps réel ouvert.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 PUSH DU SERVEUR: Validation client requise pour ${data.action}.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ PUSH DU SERVEUR: Action autorisée (${data.action}).`);
          showToast(`Info : action ${data.action} exécutée.`);
        } else if (data.type === 'DENY') {
          logAction(`❌ PUSH DU SERVEUR: Action interdite bloquée (${data.action}).`, 'err');
          setScamAlert(`ALERTE DE SÉCURITÉ\nL'appelant a tenté une action interdite : ${data.action}.\n\nCeci est une fraude, raccrochez immédiatement.`);
        }
      };
      esRef.current = es;
    } catch (err) {
      setVerified(null);
      logAction('❌ Impossible de vérifier l\'appelant.', 'err');
      showToast("Erreur de sécurité serveur.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    logAction(`[API Distante] Demande au serveur : ${action}`);
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
    } catch (err) { logAction(`Erreur réseau.`, 'err'); }
  }

  // --- ACTIONS DE L'UTILISATEUR ---
  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ Step-Up approuvé.', 'success');
      showToast("🛡️ Action confirmée et sécurisée.");
      if (pendingActionName === 'FREEZE_CARD') showToast("💳 Carte bloquée.");
    } catch (err) {
      showToast("Erreur lors de la confirmation.");
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    let finalAmount = 0;

    if (actionName === 'WIRE_TRANSFER') {
      finalAmount = parseFloat(transferAmount);
      if (isNaN(finalAmount) || finalAmount <= 0) {
        showToast("Veuillez saisir un montant de virement valide.");
        return;
      }
    }

    logAction(`Utilisateur initie : ${actionName}...`);

    if (verified === true) {
      if (summary.cannot.includes(actionName)) {
          logAction(`❌ ALERTE : Tentative action interdite pendant appel!`, 'err');
          setScamAlert(`⚠️ RACCROCHEZ IMMÉDIATEMENT ⚠️\nL'appelant tente de vous manipuler pour faire une action interdite (${actionName}).`);
          setIsTransferPageOpen(false);
          return;
      }

      if (actionName === 'WIRE_TRANSFER') {
          logAction(`❌ ALERTE : Tentative Virement pendant appel.`, 'err');
          setScamAlert(`🛡️ RAPPEL DE SÉCURITÉ\nVous tentez d'envoyer ${finalAmount.toFixed(2)}€ à "${transferRecipient}" alors qu'un appel est en cours.\n\nSi l'appelant vous a demandé de faire ça, c'est une manipulation. RACCROCHEZ.`);
          setIsTransferPageOpen(false);
          return;
      }

      logAction(`✅ Action (Mode Sécurisé) : ${actionName}`, 'success');
      showToast(`Action exécutée : ${actionName}`);
      return;
    }

    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50) {
      logAction(`✅ Petit virement validé.`, 'success');
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setIsTransferPageOpen(false);
      showToast(`✅ Virement de ${finalAmount.toFixed(2)} € envoyé.`);
      return;
    }

    logAction(`Affichage sécurité passive pour ${actionName}.`, 'warn');
    const isSafe = confirm(`🛡️ AVERTISSEMENT DE SÉCURITÉ\n\nVous vous apprêtez à faire une opération sensible (${actionName}${actionName === 'WIRE_TRANSFER' ? ' de ' + finalAmount.toFixed(2) + '€' : ''}).\n\nRAPPEL : Tous les appels de nos vrais conseillers (ou de notre Agent IA) sont automatiquement authentifiés en haut de cette application.\n\nSi quelqu'un au téléphone vous demande de faire ceci sans s'être identifié via l'app, C'EST UNE FRAUDE.\n\nÊtes-vous sûr de vouloir continuer de vous-même ?`);
    
    if (!isSafe) { 
      logAction(`Action annulée.`, 'info'); 
      return; 
    }

    logAction(`✅ Action validée : ${actionName}`, 'success');
    if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setIsTransferPageOpen(false);
      showToast(`✅ Virement de ${finalAmount.toFixed(2)} € envoyé.`);
    } else {
      showToast(`Action exécutée : ${actionName}`);
    }
  }

  return e('div', { className: 'demo-container' },
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        e('div', { className: 'mobile-header' },
          e('h2', null, 'Bonjour, Alex 👋'),
          e('p', null, 'Dernière connexion : Aujourd\'hui 14:15')
        ),

        verified === true && e('div', { className: 'call-banner verified' }, Icon(payload?.actor_type === 'AI_AGENT' ? 'smart_toy' : 'headset_mic'), `Appel sécurisé : ${actorName}`),

        e('div', { className: 'mobile-content' },
          e('div', { className: 'bank-card' },
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8, fontWeight: 500 } }, 'Compte Courant Principal'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { fontFamily: 'monospace', opacity: 0.7, fontSize: '0.9rem' } }, 'FR76 1234 **** **** **** 4092')
          ),

          e('div', { className: 'action-grid' },
            e('div', { className: 'action-btn', onClick: () => setIsTransferPageOpen(true) }, Icon('sync_alt'), 'Nouveau Virement'),
            e('div', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, Icon('chat'), 'Messagerie'),
            e('div', { className: 'action-btn danger', onClick: () => handleUserAction('FREEZE_CARD') }, Icon('credit_card_off'), 'Bloquer carte'),
            e('div', { className: 'action-btn danger', onClick: () => handleUserAction('ASK_OTP') }, Icon('password'), 'Code (OTP)')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.75rem' } }, 'Historique transactions'),
          e('div', { style: { fontSize: '0.85rem', color: '#555', padding: '1rem', background: 'white', borderRadius: '10px', border: '1px solid #eee' } }, 
            e('div', {style: {display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem'}}, e('span', null, 'Netflix Subscription'), e('span', {style: {color: '#da1e28'}}, '- 13,99 €')),
            e('div', {style: {display: 'flex', justifyContent: 'space-between'}}, e('span', null, 'Virement Salaire'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
          )
        ),

        isTransferPageOpen && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setIsTransferPageOpen(false) }, Icon('arrow_back')),
            e('h3', { style: { margin: 0, fontSize: '1.1rem' } }, 'Nouveau Virement')
          ),
          e('div', { className: 'page-content' },
            e('div', { className: 'form-group' },
              e('label', null, 'Compte à débiter'),
              e('select', { disabled: true }, e('option', null, `Compte Courant (${balance.toFixed(2)} €)`))
            ),
            e('div', { className: 'form-group' },
              e('label', null, 'Bénéficiaire'),
              e('select', { value: transferRecipient, onChange: (e) => setTransferRecipient(e.target.value) },
                RECIPIENTS.map(r => e('option', { key: r, value: r }, r))
              )
            ),
            e('div', { className: 'form-group' },
              e('label', null, 'Montant du virement (€)'),
              e('input', { type: 'number', min: '1', placeholder: 'Ex: 150.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })
            ),
            e('button', { className: `action-btn full-width ${verified === true ? 'danger' : 'primary'}`, style: { marginTop: '2rem', border: '0' }, onClick: () => handleUserAction('WIRE_TRANSFER') }, Icon('send'), 'Valider le virement')
          )
        ),

        // LA FAMEUSE POPUP MISE À JOUR (Humain / IA Agent)
        showPermissionsPopup && verified === true && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal', style: { borderTop: '6px solid var(--success)' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
              e('h3', { style: { margin: 0, color: '#0e7a0d', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' } }, Icon('gavel'), 'Contrat de Confiance'),
              e('button', { className: 'icon-btn-close', onClick: () => setShowPermissionsPopup(false) }, Icon('close'))
            ),
            e('p', {style: {margin: '0 0 1rem 0', color: '#555', textAlign: 'left', fontSize: '0.9rem', lineHeight: '1.4'}}, `Un ${actorName} a été authentifié avec succès.\n\nVoici ce qu'il a le droit de faire :`),
            e('ul', { className: 'permissions-list' },
              summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check_circle'), e('span', null, x))),
              summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('cancel'), e('span', null, x)))
            ),
            e('button', { className: 'modal-btn grey', style: { marginTop: '1.5rem' }, onClick: () => setShowPermissionsPopup(false) }, 'J\'ai compris')
          )
        ),

        pendingConfirmation && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('div', { style: { color: 'var(--primary)', marginBottom: '1.25rem' } }, Icon('fingerprint')),
            e('h3', { style: { margin: '0 0 0.5rem', fontSize: '1.1rem' } }, 'Validation Requise'),
            e('p', { style: { fontSize: '0.85rem', color: '#666', lineHeight: '1.4' } }, `Confirmez-vous l'action : ${pendingActionName} ?`),
            e('button', { className: 'modal-btn red', onClick: approveAction, disabled: busy }, 'Confirmer (FaceID)'),
            e('button', { className: 'modal-btn grey', onClick: () => setPendingConfirmation('') }, 'Annuler')
          )
        ),

        scamAlert && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal danger' },
            e('div', { style: { color: 'var(--danger)', marginBottom: '0.5rem' } }, Icon('error')),
            e('h3', { style: { margin: '0 0 1rem', color: 'var(--danger)' } }, 'ARRÊTEZ TOUT !'),
            e('p', { style: { fontSize: '0.9rem', whiteSpace: 'pre-wrap', lineHeight: '1.5', fontWeight: 500 } }, scamAlert),
            e('button', { className: 'modal-btn grey', onClick: resetState }, 'J\'ai raccroché')
          )
        ),

        e('div', { className: 'toast-container' },
          toasts.map(t => e('div', { key: t.id, className: 'toast' }, t.msg))
        )
      )
    ),

    // CONSOLE ADMIN MISE À JOUR
    e('div', { className: 'admin-panel' },
      e('div', { className: 'admin-card' },
        e('h3', null, Icon('settings_phone'), '1. Simuler l\'appel vers le client'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, 'Ouvre un canal sécurisé Castor avec l\'application client.'),
        e('div', { className: 'row' },
          // NOUVEAU : Deux boutons distincts pour choisir la source de l'appel
          e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, Icon('headset_mic'), 'Appel Vérifié (Humain)'),
          e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('smart_toy'), 'Appel Vérifié (Agent IA)')
        )
      ),

      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('admin_panel_settings'), '2. Actions distantes (Serveur API)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, verified ? `Canal ouvert avec le client. Tentez de déclencher des actions via l'API.` : 'Connectez un appel vérifié pour activer l\'API.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('credit_card_off'), 'Serveur : Bloquer Carte (Passe)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Serveur : Virement (Bloqué)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('password'), 'Serveur : OTP (Bloqué)')
        )
      ),

      e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
        e('h3', null, Icon('terminal'), 'Logs d\'audit (Temps Réel)'),
        e('div', { className: 'logs' },
          actionLog.length === 0 && e('div', null, '> En attente d\'événements...'),
          actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
