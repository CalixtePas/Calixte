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
  'Jean Dupont (Remboursement)'
];

function App() {
  const [balance, setBalance] = useState(12450.00);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); 
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  
  // États de la carte
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  const [isCardCanceled, setIsCardCanceled] = useState(false); 
  const [onlinePayments, setOnlinePayments] = useState(true);
  
  // Navigation
  const [activePage, setActivePage] = useState('HOME');
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  
  // États Virement
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [newBeneficiaryIban, setNewBeneficiaryIban] = useState('');
  
  // Modales
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [localFaceIdAction, setLocalFaceIdAction] = useState(null); 
  
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const esRef = useRef(null);

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  
  const isAI = payload?.actor_type === 'AI_AGENT';
  const actorName = isAI ? 'Agent IA' : 'Conseiller';
  const callerDescription = isAI ? "Une IA authentifiée" : "Un conseiller authentifié";

  const logAction = (msg, type = 'info') => setActionLog(prev => [{msg, type, t: new Date().toLocaleTimeString()}, ...prev].slice(0, 50));
  
  const showToast = (msg) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setPendingConfirmation(''); setPendingActionName(''); setScamAlert(''); setLocalFaceIdAction(null);
    setActivePage('HOME'); setShowPermissionsPopup(false);
  }

  // --- ACTIONS CRM ---
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
      setInteractionId(String(result.payload.sub));
      setShowPermissionsPopup(true);
      logAction(`✅ Handshake cryptographique réussi.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${result.payload.sub}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action);
          setPendingConfirmation(data.confirmation_id);
          logAction(`🔔 Demande envoyée : En attente de validation client.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ Action autorisée (${data.action}).`);
          showToast(`Action validée : ${data.action}`);
        } else if (data.type === 'DENY') {
          logAction(`❌ Rejet du serveur : Action bloquée (${data.action}).`, 'err');
          setScamAlert(`ALERTE SÉCURITÉ\n\nL'appelant tente une opération bloquée par la sécurité serveur.\n\nCeci est une fraude, raccrochez immédiatement.`);
        }
      };
      esRef.current = es;
    } catch (err) {
      setVerified(null); logAction('❌ Échec cryptographique.', 'err'); showToast("Erreur de sécurité.");
    } finally { setBusy(false); }
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    try {
      await fetch(`${API}/policy/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: interactionId, action })
      });
    } catch (err) {}
  }

  // --- ACTIONS CLIENT ---
  async function approveServerAction() {
    setBusy(true);
    try {
      await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
      setPendingConfirmation('');
      logAction('✅ Validation FaceID (Serveur) réussie.', 'success');
      showToast("Action confirmée.");
      if (pendingActionName === 'FREEZE_CARD') setIsCardFrozen(true);
    } catch (err) { showToast("Erreur de validation."); } finally { setBusy(false); }
  }

  function executeLocalFaceId() {
    setBusy(true);
    setTimeout(() => {
      if (localFaceIdAction === 'REPORT_LOST') {
        setIsCardCanceled(true);
        setIsCardFrozen(true);
        showToast("Carte mise en opposition définitive.");
        setActivePage('HOME');
        logAction("✅ Opposition carte confirmée par biométrie.", "success");
      }
      setLocalFaceIdAction(null);
      setBusy(false);
    }, 800); 
  }

  function handleUserAction(actionName) {
    let finalAmount = 0;
    const isNewBeneficiary = transferRecipient === RECIPIENTS[0];

    if (actionName === 'WIRE_TRANSFER') {
      finalAmount = parseFloat(transferAmount);
      if (isNaN(finalAmount) || finalAmount <= 0) return showToast("Montant invalide.");
      if (isNewBeneficiary && (!newBeneficiaryName || !newBeneficiaryIban)) return showToast("Informations manquantes.");
    }

    if (verified === true) {
      if (actionName === 'WIRE_TRANSFER' && isNewBeneficiary) {
          setScamAlert(`ALERTE FRAUDE (MODE OPÉRATOIRE DÉTECTÉ)\n\nVous tentez d'ajouter un bénéficiaire alors qu'un conseiller est en ligne.\n\nC'est la méthode n°1 des fraudeurs. RACCROCHEZ.`);
          setActivePage('HOME'); return;
      }
      if (summary.cannot.includes(actionName)) {
          setScamAlert(`ATTENTION\n\nL'appelant tente de vous faire exécuter une action interdite. Raccrochez.`);
          setActivePage('HOME'); return;
      }
      if (actionName === 'WIRE_TRANSFER') {
          setScamAlert(`ALERTE FRAUDE\n\nVous tentez d'envoyer ${finalAmount.toFixed(2)}€ pendant un appel. Manipulation détectée.`);
          setActivePage('HOME'); return;
      }
      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
      if (actionName === 'UNFREEZE_CARD') setIsCardFrozen(false);
      showToast(`Action exécutée : ${actionName}`); return;
    }

    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50 && !isNewBeneficiary) {
      setBalance(prev => prev - finalAmount); setTransferAmount(''); setActivePage('HOME');
      showToast(`Virement envoyé.`); return;
    }

    const isSafe = confirm(`SÉCURITÉ PASSIVE\n\nRAPPEL : Les vrais conseillers sont automatiquement authentifiés en haut de l'écran.\n\nContinuer de vous-même ?`);
    if (!isSafe) return;

    if (actionName === 'FREEZE_CARD') { setIsCardFrozen(true); showToast("Carte bloquée."); } 
    else if (actionName === 'UNFREEZE_CARD') { setIsCardFrozen(false); showToast("Carte débloquée."); } 
    else if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount); setTransferAmount(''); setNewBeneficiaryName(''); setNewBeneficiaryIban('');
      setActivePage('HOME'); showToast(`Virement envoyé.`);
    } else {
      showToast(`Action exécutée : ${actionName}`);
    }
  }

  function endCallClient() { resetState(); }
  function endCallServer() { resetState(); }

  return e('div', { className: 'demo-container' },
    
    // ===============================================
    // GAUCHE : APP MOBILE
    // ===============================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        e('div', { className: 'mobile-header' },
          e('h2', null, 'CastorBank'),
          e('div', { className: 'profile-pic' }, Icon('person'))
        ),

        verified === true && e('div', { className: 'call-banner verified' }, 
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, Icon('lock'), `Appel : ${actorName}`),
          e('button', { className: 'end-call-btn', onClick: endCallClient }, Icon('call_end'))
        ),

        e('div', { className: 'mobile-content' },
          e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, onClick: () => setActivePage('CARD') },
            (isCardFrozen || isCardCanceled) && e('div', { className: `frozen-badge ${isCardCanceled ? 'canceled' : ''}` }, Icon(isCardCanceled ? 'warning' : 'ac_unit'), isCardCanceled ? 'OPPOSITION' : 'BLOQUÉE'),
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'} },
              e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** **** 4092'),
              e('div', { style: { fontSize: '0.75rem', opacity: 0.8 } }, 'Gérer ma carte >')
            )
          ),

          // RETOUR DU BOUTON OTP !
          e('div', { className: 'action-grid' },
            e('button', { className: 'action-btn', onClick: () => setActivePage('TRANSFER') }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
            e('button', { className: 'action-btn', onClick: () => setActivePage('CARD') }, e('div', {className: 'icon'}, Icon('credit_card')), 'Carte'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code (OTP)')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '1rem', marginBottom: '1rem' } }, 'Dernières opérations'),
          e('div', { className: 'tx-list' }, 
            e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
            e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
          )
        ),

        // ===============================================
        // PAGE : VIREMENT
        // ===============================================
        activePage === 'TRANSFER' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')),
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
            transferRecipient === RECIPIENTS[0] && e(React.Fragment, null, 
              e('div', { className: 'form-group' }, e('label', null, 'Nom du bénéficiaire'), e('input', { type: 'text', placeholder: 'Ex: Garage', value: newBeneficiaryName, onChange: (evt) => setNewBeneficiaryName(evt.target.value) })),
              e('div', { className: 'form-group' }, e('label', null, 'IBAN'), e('input', { type: 'text', placeholder: 'FR76...', value: newBeneficiaryIban, onChange: (evt) => setNewBeneficiaryIban(evt.target.value) }))
            ),
            e('div', { className: 'form-group' },
              e('label', null, 'Montant (€)'), e('input', { type: 'number', min: '1', placeholder: '0.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })
            ),
            e('button', { className: 'btn-primary', onClick: () => handleUserAction('WIRE_TRANSFER') }, 'Confirmer le virement')
          )
        ),

        // ===============================================
        // PAGE : GESTION DE LA CARTE
        // ===============================================
        activePage === 'CARD' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')),
            e('h3', null, 'Gérer ma carte')
          ),
          e('div', { className: 'page-content' },
            e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, style: { margin: '0 0 2rem 0', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', cursor: 'default' } },
              (isCardFrozen || isCardCanceled) && e('div', { className: `frozen-badge ${isCardCanceled ? 'canceled' : ''}` }, Icon(isCardCanceled ? 'warning' : 'ac_unit'), isCardCanceled ? 'OPPOSITION' : 'BLOQUÉE'),
              e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Visa Premier'),
              e('div', { className: 'balance', style: { fontSize: '1.5rem', marginTop: '2rem' } }, isCardCanceled ? 'XXXX XXXX XXXX XXXX' : '**** **** **** 4092'),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', opacity: 0.8, fontSize: '0.9rem' } },
                e('span', null, 'ALEXANDRE DUPONT'), e('span', null, '12/28')
              )
            ),

            e('div', { className: 'menu-list' },
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, e('div', { className: 'icon' }, Icon('speed')), e('div', null, e('h4', null, 'Plafonds de paiement'), e('p', null, 'Utilisé : 450€ / 2500€'))), Icon('chevron_right')
              ),
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, e('div', { className: 'icon' }, Icon('language')), e('div', null, e('h4', null, 'Paiements sur internet'), e('p', null, onlinePayments && !isCardCanceled ? 'Activés' : 'Désactivés'))),
                e('label', { className: 'switch' }, e('input', { type: 'checkbox', disabled: isCardCanceled, checked: onlinePayments && !isCardCanceled, onChange: () => setOnlinePayments(!onlinePayments) }), e('span', { className: 'slider' }))
              )
            ),

            e('div', { className: 'menu-list' },
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, 
                  e('div', { className: 'icon', style: { background: isCardCanceled ? '#eee' : (isCardFrozen ? '#f0f4ff' : '#fff0f0'), color: isCardCanceled ? '#666' : (isCardFrozen ? 'var(--primary)' : 'var(--danger)') } }, Icon(isCardCanceled ? 'block' : (isCardFrozen ? 'lock_open' : 'ac_unit'))), 
                  e('div', null, e('h4', null, isCardCanceled ? 'Opposition définitive' : (isCardFrozen ? 'Débloquer la carte' : 'Bloquer temporairement')), e('p', null, isCardCanceled ? 'Carte invalide' : (isCardFrozen ? 'Réactiver les paiements' : 'En cas de doute')))
                ),
                isCardCanceled ? null : e('label', { className: 'switch' }, e('input', { type: 'checkbox', checked: isCardFrozen, onChange: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }), e('span', { className: 'slider' }))
              )
            ),
            
            !isCardCanceled && e('button', { className: 'btn-danger', onClick: () => setLocalFaceIdAction('REPORT_LOST') }, Icon('warning'), 'Signaler volée ou perdue')
          )
        ),

        // MODALES
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

        (pendingConfirmation || localFaceIdAction) && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('div', { style: { textAlign: 'center' } },
              e('div', { style: { color: 'var(--primary)', fontSize: '3rem', marginBottom: '1rem' } }, Icon('face')),
              e('h3', { className: 'modal-title', style: { justifyContent: 'center' } }, 'Face ID requis'),
              e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' } }, `Autoriser l'action : ${pendingConfirmation ? pendingActionName : 'Opposition définitive'} ?`),
              e('button', { className: 'modal-btn primary', onClick: pendingConfirmation ? approveServerAction : executeLocalFaceId, disabled: busy }, 'Confirmer'),
              e('button', { className: 'modal-btn secondary', onClick: () => { setPendingConfirmation(''); setLocalFaceIdAction(null); } }, 'Annuler')
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

      e('div', { className: 'admin-card', style: { borderTop: '4px solid var(--primary)' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          e('div', null,
            e('h3', { style: { margin: '0 0 0.25rem 0', borderBottom: 'none', padding: 0 } }, 'Alexandre Dupont'),
            e('p', { style: { margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' } }, 'ID Client : 09843-AX | Seg: Particulier')
          ),
          e('div', { className: `crm-status-badge ${verified ? 'secure' : 'idle'}` },
            Icon(verified ? 'lock' : 'lock_open'), verified ? 'Authentifié (Castor)' : 'Non authentifié'
          )
        ),
        e('div', { className: 'row', style: { marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' } },
          !verified && e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, Icon('shield'), 'Authentifier le client'),
          !verified && e('button', { className: 'control-btn', onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('smart_toy'), 'Lancer Voicebot IA'),
          verified && e('button', { className: 'control-btn', style: { color: 'var(--danger)', borderColor: 'var(--danger)', marginLeft: 'auto' }, onClick: endCallServer }, Icon('call_end'), 'Clôturer la session')
        )
      ),

      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('dashboard_customize'), 'Actions Conseiller (Distantes)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, verified ? `Canal ouvert avec le client. Actions limitées par l'API.` : 'Connectez un appel pour activer l\'API.'),
        e('div', { className: 'row' },
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('ac_unit'), 'Geler la carte (Step-Up)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Initier virement (Bloqué)'),
          e('button', { className: 'control-btn', onClick: () => simulateCallerAction('ASK_OTP') }, Icon('key'), 'Générer OTP (Bloqué)')
        )
      ),

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
