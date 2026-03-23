import React, { useMemo, useState, useRef } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/castor/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon' }, name);

function App() {
  const [balance, setBalance] = useState(12450.00);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null);
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  
  // NOUVEAU : État gérant la saisie libre au clavier
  const [selectedAmount, setSelectedAmount] = useState(''); 
  
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const esRef = useRef(null);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
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
    logAction("Session réinitialisée (Mode IDLE).", 'info');
  }

  // --- ACTIONS DU SIMULATEUR ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    logAction(`Simulation d'appel entrant de la Banque (${actorType})...`);
    
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
      
      // Validation avec le nouvel émetteur CASTOR
      const result = await jwtVerify(dataStart.token, key, { issuer: 'castor' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      
      showToast("🔐 Appel de la banque vérifié. Mode sécurisé activé.");
      logAction(`✅ Preuve EdDSA valide (Issuer: castor). Canal temps réel ouvert.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 PUSH DU SERVEUR: Validation client requise pour ${data.action}.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ PUSH DU SERVEUR: Action autorisée par la politique (${data.action}).`);
          showToast(`Info conseiller : action ${data.action} exécutée.`);
        } else if (data.type === 'DENY') {
          logAction(`❌ PUSH DU SERVEUR: Action interdite bloquée par le serveur (${data.action}).`, 'err');
          setScamAlert(`ALERTE DE SÉCURITÉ\nL'appelant a tenté une action interdite : ${data.action}.\n\nUn vrai conseiller bancaire ne demandera JAMAIS cela. Ceci est une fraude avérée, raccrochez immédiatement.`);
        }
      };
      esRef.current = es;
    } catch (err) {
      setVerified(false);
      logAction('❌ Impossible de vérifier l\'appelant. (Faux token ou erreur)', 'err');
      showToast("⚠️ Impossible de vérifier l'appelant. Prudence.");
    } finally {
      setBusy(false);
    }
  }

  function simulateUnknownCall() {
    resetState();
    setVerified(false);
    logAction('📞 Appel entrant classique détecté. Aucune preuve reçue.', 'warn');
    showToast("📞 Appel entrant (Inconnu). Sécurité habituelle.");
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    logAction(`[API Conseiller] Tente d'initier : ${action}`);
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
    } catch (err) { logAction(`Erreur réseau lors de l'appel API Caller.`, 'err'); }
  }

  // --- ACTIONS DE L'UTILISATEUR ---
  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ Step-Up approuvé cryptographiquement via l\'App.', 'success');
      showToast("🛡️ Action confirmée et sécurisée.");
      if (pendingActionName === 'FREEZE_CARD') showToast("💳 Carte bloquée temporairement.");
    } catch (err) {
      showToast("Erreur lors de la confirmation.");
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    let finalAmount = 0;

    // Si c'est un virement, on valide le montant saisi manuellement
    if (actionName === 'WIRE_TRANSFER') {
      finalAmount = parseFloat(selectedAmount);
      if (isNaN(finalAmount) || finalAmount <= 0) {
        showToast("Veuillez saisir un montant de virement valide.");
        logAction("Virement annulé : montant invalide saisi.", 'warn');
        return;
      }
    }

    logAction(`Utilisateur initie : ${actionName}...`);

    if (verified === true) {
      if (summary.cannot.includes(actionName)) {
          logAction(`❌ ALERTE : Tentative action interdite par utilisateur pendant appel!`, 'err');
          setScamAlert(`⚠️ RACCROCHEZ IMMÉDIATEMENT ⚠️\nL'appelant tente de vous manipuler pour faire une action interdite (${actionName}).\n\nCeci est une fraude.`);
          return;
      }

      if (actionName === 'WIRE_TRANSFER') {
          logAction(`❌ ALERTE : Tentative Virement initié par utilisateur pendant appel sécurisé.`, 'err');
          setScamAlert(`🛡️ RAPPEL DE SÉCURITÉ\nVous tentez de faire un virement de ${finalAmount.toFixed(2)}€ alors qu'un conseiller est en ligne.\n\nS'il vous l'a demandé, c'est une manipulation. RACCROCHEZ.\n\nFaites cette opération vous-même plus tard.`);
          return;
      }

      logAction(`✅ Action utilisateur exécutée (Mode Sécurisé) : ${actionName}`, 'success');
      showToast(`✅ Action exécutée : ${actionName}`);
      return;
    }

    if (actionName === 'WIRE_TRANSFER' && finalAmount < 50) {
      logAction(`✅ Petit virement (<50€) validé silencieusement (Mode standard).`, 'success');
      setBalance(prev => prev - finalAmount);
      setSelectedAmount(''); // Reset de l'input après succès
      showToast(`✅ Virement de ${finalAmount.toFixed(2)} € effectué.`);
      return;
    }

    logAction(`Affichage popup sécurité standard pour ${actionName}.`, 'warn');
    const isSafe = confirm(`🛡️ RAPPEL DE SÉCURITÉ\n\nVous vous apprêtez à faire une action sensible (${actionName}${actionName === 'WIRE_TRANSFER' ? ' ' + finalAmount.toFixed(2) + '€' : ''}).\n\nSi un soi-disant "conseiller" au téléphone vous demande de faire cela sans s'être identifié via l'application, C'EST UNE FRAUDE.\n\nÊtes-vous sûr de vouloir continuer cette action vous-même ?`);
    
    if (!isSafe) { 
      logAction(`Action annulée par l'utilisateur par précaution.`, 'info'); 
      return; 
    }

    logAction(`✅ Action validée par utilisateur : ${actionName}`, 'success');
    if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount);
      setSelectedAmount('');
      showToast(`✅ Virement de ${finalAmount.toFixed(2)} € effectué.`);
    } else {
      showToast(`✅ Action exécutée : ${actionName}`);
    }
  }

  // Permet de formater l'affichage du bouton
  const parsedAmount = parseFloat(selectedAmount);
  const btnAmountText = (isNaN(parsedAmount) || parsedAmount <= 0) ? '...' : parsedAmount.toFixed(2);

  return e('div', { className: 'demo-container' },
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        e('div', { className: 'mobile-header' },
          e('h2', null, 'Bonjour, Alex 👋'),
          e('p', null, 'Dernière connexion : Aujourd\'hui 14:15')
        ),

        verified === true && e('div', { className: 'call-banner verified' }, Icon('verified_user'), 'Appel sécurisé : Banque en ligne'),
        verified === false && e('div', { className: 'call-banner unknown' }, Icon('phone_in_talk'), 'Appel entrant inconnu'),

        e('div', { className: 'mobile-content' },
          e('div', { className: 'bank-card' },
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8, fontWeight: 500 } }, 'Compte Courant Principal'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { fontFamily: 'monospace', opacity: 0.7, fontSize: '0.9rem' } }, 'FR76 1234 **** **** **** 4092')
          ),

          verified === true && e('div', { className: 'permissions-card' },
            e('h4', null, Icon('gavel'), 'Contrat de Confiance (Castor 🛡️)'),
            e('p', {style: {margin: '0 0 0.75rem 0', color: '#555'}}, `Voici ce que le conseiller (${payload?.actor_type || 'IA'}) peut faire :`),
            e('ul', null,
              summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check_circle'), e('span', null, x))),
              summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('cancel'), e('span', null, x)))
            )
          ),

          e('div', { className: 'virement-section' },
            e('div', { className: 'amount-selector' },
              e('span', null, 'Montant à virer :'),
              // NOUVEAU : Champ de saisie manuel (Input Number)
              e('input', { 
                type: 'number', 
                min: '1', 
                placeholder: 'Ex: 15.00',
                value: selectedAmount, 
                onChange: (evt) => setSelectedAmount(evt.target.value), 
                disabled: verified === true 
              })
            ),
            e('div', { className: `action-btn full-width ${verified === true ? 'danger' : ''}`, onClick: () => handleUserAction('WIRE_TRANSFER') }, Icon('sync_alt'), `Faire un virement de ${btnAmountText} €`)
          ),

          e('div', { className: 'action-grid' },
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

    e('div', { className: 'admin-panel' },
      e('div', { className: 'admin-card' },
        e('h3', null, Icon('settings_phone'), '1. Simuler l\'appel vers le client'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, 'Déclenche l\'appel et envoie la preuve cryptographique Castor à l\'App.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('IA_AGENT'), disabled: busy }, Icon('smart_toy'), 'Appel Vérifié (IA Conseil)'),
          e('button', { className: 'control-btn', onClick: simulateUnknownCall, disabled: busy }, Icon('call_error'), 'Appel Inconnu (Arnaqueur)')
        )
      ),

      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('admin_panel_settings'), '2. Actions du conseiller (Serveur API)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, verified ? 'Canal ouvert. Le conseiller tente de déclencher des actions via l\'API Castor.' : 'Connectez un appel vérifié pour activer l\'API Caller.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('credit_card_off'), 'Serveur : Bloquer Carte (Step-Up)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Serveur : Demander Virement (Bloqué)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('password'), 'Serveur : Demander OTP (Bloqué)')
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
