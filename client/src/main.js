import React, { useMemo, useState, useRef } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/castor/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon', style: { fontSize: 'inherit' } }, name);

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
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  
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
  
  const isAI = payload?.actor_type === 'AI_AGENT';
  const actorName = isAI ? 'Agent IA' : 'Conseiller';
  const callerDescription = isAI ? "Une IA authentifiée" : "Un conseiller authentifié";

  // Des logs orientés CRM
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
  }

  // --- ACTIONS DU CRM ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    logAction(`Initialisation du protocole Castor (${actorType})...`);
    
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
      logAction(`✅ Handshake cryptographique réussi. Session chiffrée.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 Demande envoyée : En attente de validation client pour ${data.action}.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ Action autorisée par le Policy Engine (${data.action}).`);
          showToast(`Action validée : ${data.action}`);
        } else if (data.type === 'DENY') {
          logAction(`❌ Rejet du serveur : Action bloquée par la politique de sécurité (${data.action}).`, 'err');
          setScamAlert(`ALERTE SÉCURITÉ\n\nL'appelant tente une opération bloquée par votre contrat (${data.action}).\n\nCeci est une fraude, raccrochez immédiatement.`);
        }
      };
      esRef.current = es;
    } catch (err) {
      setVerified(null);
      logAction('❌ Échec de la poignée de main cryptographique.', 'err');
      showToast("Erreur de sécurité.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    logAction(`[CRM] Tentative d'action via API : ${action}`);
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
    } catch (err) { logAction(`Erreur de connexion API.`, 'err'); }
  }

  // --- ACTIONS DU CLIENT (MOBILE) ---
  async function approveAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ Client a validé l\'opération (Biométrie confirmée).', 'success');
      showToast("Action confirmée via FaceID.");
      
      if (pendingActionName === 'FREEZE_CARD') {
        setIsCardFrozen(true);
        showToast("Carte bloquée.");
      }
    } catch (err) {
      showToast("Erreur de validation.");
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    let finalAmount = 0;

    if (actionName === 'WIRE_TRANSFER') {
      finalAmount = parseFloat(transferAmount);
      if (isNaN(finalAmount) || finalAmount <= 0) {
        showToast("Saisissez un montant valide.");
        return;
      }
    }

    logAction(`Le client initie : ${actionName}...`);

    if (verified === true) {
      if (summary.cannot.includes(actionName)) {
          setScamAlert(`ATTENTION\n\nL'appelant tente de vous faire exécuter une action interdite (${actionName}). Raccrochez.`);
          setIsTransferPageOpen(false);
          return;
      }

      if (actionName === 'WIRE_TRANSFER') {
          setScamAlert(`ALERTE FRAUDE\n\nVous tentez d'envoyer ${finalAmount.toFixed(2)}€ alors qu'un appel est en cours.\n\nSi l'interlocuteur vous le demande, c'est une manipulation. Raccrochez.`);
          setIsTransferPageOpen(false);
          return;
      }

      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
      if (actionName === 'UNFREEZE_CARD') setIsCardFrozen(false);

      showToast(`Action exécutée : ${actionName}`);
      return;
    }

    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50) {
      logAction(`✅ Virement standard validé (<50€).`, 'success');
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setIsTransferPageOpen(false);
      showToast(`Virement de ${finalAmount.toFixed(2)} € envoyé.`);
      return;
    }

    const isSafe = confirm(`SÉCURITÉ PASSIVE\n\nVous initiez une opération sensible.\nRAPPEL : Les vrais conseillers sont automatiquement authentifiés en haut de l'écran.\n\nSi quelqu'un vous guide au téléphone sans cette bannière, c'est une fraude.\n\nContinuer ?`);
    
    if (!isSafe) return;

    logAction(`✅ Opération client validée : ${actionName}`, 'success');
    
    if (actionName === 'FREEZE_CARD') {
      setIsCardFrozen(true);
      showToast("Carte bloquée avec succès.");
    } else if (actionName === 'UNFREEZE_CARD') {
      setIsCardFrozen(false);
      showToast("Carte débloquée.");
    } else if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setIsTransferPageOpen(false);
      showToast(`Virement de ${finalAmount.toFixed(2)} € envoyé.`);
    } else {
      showToast(`Action exécutée : ${actionName}`);
    }
  }

  function endCallClient() {
    logAction("📞 Session interrompue par le client.", 'warn');
    showToast("Appel terminé.");
    resetState();
  }

  function endCallServer() {
    logAction("📞 Session clôturée par le conseiller.", 'info');
    showToast("Le conseiller a raccroché.");
    resetState();
  }

  return e('div', { className: 'demo-container' },
    
    // ===============================================
    // GAUCHE : APP MOBILE DU CLIENT (iOS/Android)
    // ===============================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        e('div', { className: 'mobile-header' },
          e('h2', null, 'CastorBank'),
          e('div', { className: 'profile-pic' }, Icon('person'))
        ),

        verified === true && e('div', { className: 'call-banner verified' }, 
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
            Icon('lock'), `Appel : ${actorName}`
          ),
          e('button', { className: 'end-call-btn', onClick: endCallClient }, Icon('call_end'))
        ),

        e('div', { className: 'mobile-content' },
          e('div', { className: `bank-card ${isCardFrozen ? 'frozen' : ''}` },
            isCardFrozen && e('div', { className: 'frozen-badge' }, Icon('ac_unit'), 'BLOQUÉE'),
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** **** 4092')
          ),

          e('div', { className: 'action-grid' },
            e('button', { className: 'action-btn', onClick: () => setIsTransferPageOpen(true) }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
            e('button', { className: `action-btn`, onClick: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }, 
              e('div', {className: 'icon', style: { color: isCardFrozen ? 'var(--primary)' : 'var(--danger)' }}, Icon(isCardFrozen ? 'lock_open' : 'ac_unit')), 
              isCardFrozen ? 'Débloquer' : 'Bloquer'
            ),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '2rem', marginBottom: '1rem' } }, 'Dernières opérations'),
          e('div', { className: 'tx-list' }, 
            e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
            e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
          )
        ),

        // PAGES ET MODALES MOBILE
        isTransferPageOpen && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setIsTransferPageOpen(false) }, Icon('arrow_back')),
            e('h3', null, 'Virement')
          ),
          e('div', { className: 'page-content' },
            e('div', { className: 'form-group' },
              e('label', null, 'Depuis'),
              e('select', { disabled: true }, e('option', null, `Compte Courant (${balance.toFixed(2)} €)`))
            ),
            e('div', { className: 'form-group' },
              e('label', null, 'Vers'),
              e('select', { value: transferRecipient, onChange: (e) => setTransferRecipient(e.target.value) },
                RECIPIENTS.map(r => e('option', { key: r, value: r }, r))
              )
            ),
            e('div', { className: 'form-group' },
              e('label', null, 'Montant (€)'),
              e('input', { type: 'number', min: '1', placeholder: '0.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })
            ),
            e('button', { className: 'btn-primary', onClick: () => handleUserAction('WIRE_TRANSFER') }, 'Continuer')
          )
        ),

        showPermissionsPopup && verified === true && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('h3', { className: 'modal-title' }, Icon('verified_user'), 'Sécurité de l\'appel'),
            e('p', {style: {color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4'}}, `${callerDescription} est en ligne. L'application restreint techniquement ses actions :`),
            e('ul', { className: 'permissions-list' },
              summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check'), e('span', null, x))),
              summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('close'), e('span', null, x)))
            ),
            e('button', { className: 'modal-btn primary', onClick: () => setShowPermissionsPopup(false) }, 'Continuer')
          )
        ),

        pendingConfirmation && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('div', { style: { textAlign: 'center' } },
              e('div', { style: { color: 'var(--primary)', fontSize: '3rem', marginBottom: '1rem' } }, Icon('face')),
              e('h3', { className: 'modal-title', style: { justifyContent: 'center' } }, 'Face ID requis'),
              e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' } }, `Autoriser l'action : ${pendingActionName} ?`),
              e('button', { className: 'modal-btn primary', onClick: approveAction, disabled: busy }, 'Confirmer'),
              e('button', { className: 'modal-btn secondary', onClick: () => setPendingConfirmation('') }, 'Annuler')
            )
          )
        ),

        scamAlert && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('h3', { className: 'modal-title', style: { color: 'var(--danger)' } }, Icon('warning'), 'Arrêtez tout'),
            e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', lineHeight: '1.5', marginBottom: '1.5rem' } }, scamAlert),
            e('button', { className: 'modal-btn danger', onClick: resetState }, 'Raccrocher et signaler')
          )
        ),

        e('div', { className: 'toast-container' },
          toasts.map(t => e('div', { key: t.id, className: 'toast' }, t.msg))
        )
      )
    ),

    // ===============================================
    // DROITE : PORTAIL CONSEILLER (CRM B2B)
    // ===============================================
    e('div', { className: 'admin-panel' },
      e('h2', { className: 'crm-header' }, Icon('support_agent'), 'Portail Conseiller (CRM)'),

      // FICHE CLIENT & AUTHENTIFICATION
      e('div', { className: 'admin-card', style: { borderTop: '4px solid var(--primary)' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          e('div', null,
            e('h3', { style: { margin: '0 0 0.25rem 0', borderBottom: 'none', padding: 0 } }, 'Alexandre Dupont'),
            e('p', { style: { margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' } }, 'ID Client : 09843-AX | Seg: Particulier')
          ),
          e('div', { className: `crm-status-badge ${verified ? 'secure' : 'idle'}` },
            Icon(verified ? 'lock' : 'lock_open'),
            verified ? 'Authentifié (Castor)' : 'Non authentifié'
          )
        ),
        e('div', { className: 'row', style: { marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' } },
          !verified && e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, Icon('shield'), 'Authentifier le client (Castor)'),
          !verified && e('button', { className: 'control-btn', onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('smart_toy'), 'Lancer Voicebot IA (Castor)'),
          verified && e('button', { className: 'control-btn', style: { color: 'var(--danger)', borderColor: 'var(--danger)' }, onClick: endCallServer }, Icon('call_end'), 'Clôturer la session sécurisée')
        )
      ),

      // ACTIONS DISTANTES DU CRM
      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('dashboard_customize'), 'Actions Conseiller (Distantes)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, verified ? 'Le canal est sécurisé. Vos actions sont limitées par la politique du serveur.' : 'Veuillez authentifier le client pour activer les actions.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('ac_unit'), 'Geler la carte (Step-Up)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Initier virement (Bloqué)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('key'), 'Générer OTP (Bloqué)')
        )
      ),

      // PISTE D'AUDIT
      e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
        e('h3', null, Icon('history'), 'Piste d\'audit (Compliance)'),
        e('div', { className: 'logs' },
          actionLog.length === 0 && e('div', null, '> En attente d\'interactions...'),
          actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
