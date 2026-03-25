import React, { useMemo, useState, useRef, useEffect } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/castor/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon', style: { fontSize: 'inherit' } }, name);

const RECIPIENTS = ['Nouveau bénéficiaire...', 'Bailleur (Loyer Mensuel)', 'Maître Leblanc (Notaire)'];

function App() {
  const [balance, setBalance] = useState(12450.00);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); 
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  
  // États de la carte et du téléphone
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  const [isCardCanceled, setIsCardCanceled] = useState(false); 
  const [isScreenShared, setIsScreenShared] = useState(false); // Mode AnyDesk
  
  // Navigation & UI
  const [activePage, setActivePage] = useState('LOCKED'); // LOCKED, HOME, TRANSFER, CARD
  const [adminTab, setAdminTab] = useState('CRM'); // CRM, CISO
  const [currentTime, setCurrentTime] = useState('');
  const [hasPushNotif, setHasPushNotif] = useState(false);
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  
  // Formulaires
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  
  // Modales
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [localFaceIdAction, setLocalFaceIdAction] = useState(null); 
  const [scanState, setScanState] = useState('idle'); 
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  
  const esRef = useRef(null);
  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  const actorName = payload?.actor_type === 'AI_AGENT' ? 'Agent IA' : 'Conseiller';

  // Horloge pour l'écran de verrouillage
  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  const logAction = (msg, type = 'info') => setActionLog(prev => [{msg, type, t: new Date().toLocaleTimeString()}, ...prev].slice(0, 50));
  const showToast = (msg) => { const id = Date.now(); setToasts(prev => [...prev, { id, msg }]); setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000); };

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setPendingConfirmation(''); setPendingActionName(''); setScamAlert(''); setLocalFaceIdAction(null); setScanState('idle');
    setActivePage('LOCKED'); setShowPermissionsPopup(false); setHasPushNotif(false); setIsScreenShared(false);
  }

  // --- ACTIONS CRM ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    logAction(`Initialisation du protocole Castor (${actorType})...`);
    
    try {
      const resStart = await fetch(`${API}/interactions/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'app-mobile-user' }) });
      const dataStart = await resStart.json();
      
      setToken(dataStart.token);
      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      const result = await jwtVerify(dataStart.token, key, { issuer: 'castor' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      
      // SCÉNARIO : Le téléphone est verrouillé, on envoie la notification Push
      setActivePage('LOCKED');
      setHasPushNotif(true);
      logAction(`✅ Handshake réussi. Notification Push envoyée au client.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.type === 'STEP_UP') {
          setPendingActionName(data.action); setPendingConfirmation(data.confirmation_id); logAction(`🔔 En attente de FaceID.`, 'warn');
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ Action autorisée (${data.action}).`); showToast(`Action validée : ${data.action}`);
        } else if (data.type === 'DENY') {
          logAction(`❌ Rejet du serveur (${data.action}).`, 'err');
          setScamAlert(`ALERTE SÉCURITÉ\n\nL'appelant tente une opération bloquée par la sécurité serveur.\n\nRaccrochez.`);
        }
      };
      esRef.current = es;
    } catch (err) { setVerified(null); logAction('❌ Échec cryptographique.', 'err'); showToast("Erreur de sécurité."); } finally { setBusy(false); }
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    try { await fetch(`${API}/policy/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interaction_id: interactionId, action }) }); } catch (err) {}
  }

  function simulateScreenShare() {
    setIsScreenShared(!isScreenShared);
    if (!isScreenShared) logAction(`⚠️ Prise de contrôle à distance simulée (AnyDesk).`, 'warn');
    else logAction(`Arrêt du partage d'écran.`, 'info');
  }

  // --- ANIMATION FACE ID ET DÉVERROUILLAGE ---
  function executeFaceIdScan(onSuccess) {
    setScanState('scanning'); setBusy(true);
    setTimeout(() => {
      setScanState('success');
      setTimeout(() => { onSuccess(); setScanState('idle'); setBusy(false); }, 500);
    }, 1200);
  }

  function openAppFromPush() {
    executeFaceIdScan(() => {
      setHasPushNotif(false);
      setActivePage('HOME');
      setShowPermissionsPopup(true); // Affiche le contrat de confiance dès l'ouverture
    });
  }

  async function approveServerAction() {
    executeFaceIdScan(async () => {
      try {
        await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
        setPendingConfirmation(''); logAction('✅ Validation FaceID réussie.', 'success'); showToast("Action confirmée via FaceID.");
        if (pendingActionName === 'FREEZE_CARD') setIsCardFrozen(true);
      } catch (err) { showToast("Erreur de validation."); }
    });
  }

  function executeLocalFaceId() {
    executeFaceIdScan(() => {
      if (localFaceIdAction === 'REPORT_LOST') {
        setIsCardCanceled(true); setIsCardFrozen(true); showToast("Carte en opposition définitive."); setActivePage('HOME');
      } else if (localFaceIdAction === 'UNLOCK_APP') {
        setActivePage('HOME');
      }
      setLocalFaceIdAction(null);
    });
  }

  function handleUserAction(actionName) {
    let finalAmount = parseFloat(transferAmount);
    const isNewBen = transferRecipient === RECIPIENTS[0];

    if (actionName === 'WIRE_TRANSFER' && (isNaN(finalAmount) || finalAmount <= 0)) return showToast("Montant invalide.");

    if (verified === true) {
      if (actionName === 'WIRE_TRANSFER' && isNewBen) { setScamAlert(`ALERTE FRAUDE (MODE OPÉRATOIRE DÉTECTÉ)\n\nAjout de bénéficiaire pendant un appel. RACCROCHEZ.`); setActivePage('HOME'); return; }
      if (summary.cannot.includes(actionName) || actionName === 'WIRE_TRANSFER') { setScamAlert(`ALERTE FRAUDE\n\nTENTATIVE DE MANIPULATION.`); setActivePage('HOME'); return; }
      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
      if (actionName === 'UNFREEZE_CARD') setIsCardFrozen(false);
      showToast(`Action exécutée.`); return;
    }

    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50 && !isNewBen) {
      setBalance(prev => prev - finalAmount); setTransferAmount(''); setActivePage('HOME'); showToast(`Virement envoyé.`); return;
    }

    if (!confirm(`SÉCURITÉ PASSIVE\n\nOpération sensible.\nRAPPEL : Les vrais conseillers sont authentifiés en haut de l'écran.\nContinuer ?`)) return;

    if (actionName === 'FREEZE_CARD') { setIsCardFrozen(true); showToast("Carte bloquée."); } 
    else if (actionName === 'UNFREEZE_CARD') { setIsCardFrozen(false); showToast("Carte débloquée."); } 
    else if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount); setTransferAmount(''); setActivePage('HOME'); showToast(`Virement envoyé.`);
    }
  }

  return e('div', { className: 'demo-container' },
    
    // ===============================================
    // APP MOBILE
    // ===============================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        // ECRAN DE VERROUILLAGE
        activePage === 'LOCKED' && e('div', { className: 'lock-screen', onClick: () => !hasPushNotif && setLocalFaceIdAction('UNLOCK_APP') },
          e('div', { className: 'clock' }, currentTime),
          hasPushNotif && e('div', { className: 'push-notif', onClick: (e) => { e.stopPropagation(); openAppFromPush(); } },
            e('div', { className: 'push-header' }, Icon('shield_person'), 'CASTORBANK'),
            e('p', { className: 'push-title' }, `Appel sécurisé : ${actorName}`),
            e('p', { className: 'push-body' }, 'Touchez pour ouvrir et vérifier l\'identité de l\'appelant.')
          ),
          !hasPushNotif && e('div', { style: { position: 'absolute', bottom: '2rem', fontSize: '0.8rem', opacity: 0.8 } }, 'Touchez pour déverrouiller')
        ),

        // ECRAN ANYDESK (Protection)
        isScreenShared && e('div', { className: 'privacy-screen' },
          e('div', { className: 'icon' }, Icon('visibility_off')),
          e('h3', null, 'Partage d\'écran détecté'),
          e('p', null, 'Pour votre sécurité, CastorBank a masqué vos données bancaires. Aucun "conseiller" ne vous demandera jamais d\'installer AnyDesk ou TeamViewer.')
        ),

        // APPLICATION NORMALE
        e('div', { className: 'mobile-header' }, e('h2', null, 'CastorBank'), e('div', { className: 'profile-pic' }, Icon('person'))),

        verified === true && e('div', { className: 'call-banner verified' }, 
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, Icon('lock'), `Appel : ${actorName}`),
          e('button', { className: 'end-call-btn', onClick: resetState }, Icon('call_end'))
        ),

        e('div', { className: 'mobile-content' },
          e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, onClick: () => setActivePage('CARD') },
            (isCardFrozen || isCardCanceled) && e('div', { className: `frozen-badge ${isCardCanceled ? 'canceled' : ''}` }, Icon(isCardCanceled ? 'warning' : 'ac_unit'), isCardCanceled ? 'OPPOSITION' : 'BLOQUÉE'),
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'} }, e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** 4092'), e('div', { style: { fontSize: '0.75rem', opacity: 0.8 } }, 'Gérer >'))
          ),

          e('div', { className: 'action-grid' },
            e('button', { className: 'action-btn', onClick: () => setActivePage('TRANSFER') }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
            e('button', { className: 'action-btn', onClick: () => setActivePage('CARD') }, e('div', {className: 'icon'}, Icon('credit_card')), 'Carte'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code (OTP)')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '1rem', marginBottom: '1rem' } }, 'Opérations récentes'),
          e('div', { className: 'tx-list' }, 
            e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
            e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
          )
        ),

        activePage === 'TRANSFER' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' }, e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')), e('h3', null, 'Virement')),
          e('div', { className: 'page-content' },
            e('div', { className: 'form-group' }, e('label', null, 'Depuis'), e('select', { disabled: true }, e('option', null, `Compte Courant (${balance.toFixed(2)} €)`))),
            e('div', { className: 'form-group' }, e('label', null, 'Vers'), e('select', { value: transferRecipient, onChange: (e) => setTransferRecipient(e.target.value) }, RECIPIENTS.map(r => e('option', { key: r, value: r }, r)))),
            e('div', { className: 'form-group' }, e('label', null, 'Montant (€)'), e('input', { type: 'number', min: '1', placeholder: '0.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })),
            e('button', { className: 'btn-primary', onClick: () => handleUserAction('WIRE_TRANSFER') }, 'Confirmer')
          )
        ),

        activePage === 'CARD' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' }, e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')), e('h3', null, 'Ma carte')),
          e('div', { className: 'page-content' },
            e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, style: { margin: '0 0 2rem 0', cursor: 'default' } },
              (isCardFrozen || isCardCanceled) && e('div', { className: `frozen-badge ${isCardCanceled ? 'canceled' : ''}` }, Icon(isCardCanceled ? 'warning' : 'ac_unit'), isCardCanceled ? 'OPPOSITION' : 'BLOQUÉE'),
              e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Visa Premier'),
              e('div', { className: 'balance', style: { fontSize: '1.5rem', marginTop: '2rem' } }, isCardCanceled ? 'XXXX XXXX XXXX' : '**** **** 4092')
            ),
            e('div', { className: 'menu-list' },
              e('div', { className: 'menu-item' }, e('div', { className: 'menu-item-info' }, e('div', { className: 'icon', style: { background: isCardCanceled ? '#eee' : (isCardFrozen ? '#f0f4ff' : '#fff0f0'), color: isCardCanceled ? '#666' : (isCardFrozen ? 'var(--primary)' : 'var(--danger)') } }, Icon(isCardCanceled ? 'block' : (isCardFrozen ? 'lock_open' : 'ac_unit'))), e('div', null, e('h4', null, isCardCanceled ? 'Opposition' : (isCardFrozen ? 'Débloquer' : 'Bloquer temporairement')))),
                isCardCanceled ? null : e('label', { className: 'switch' }, e('input', { type: 'checkbox', checked: isCardFrozen, onChange: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }), e('span', { className: 'slider' }))
              )
            ),
            !isCardCanceled && e('button', { className: 'btn-danger', onClick: () => setLocalFaceIdAction('REPORT_LOST') }, Icon('warning'), 'Signaler volée ou perdue')
          )
        ),

        // MODALES GLOBALES
        showPermissionsPopup && verified === true && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('h3', { className: 'modal-title' }, Icon('verified_user'), 'Sécurité de l\'appel'),
            e('p', {style: {color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem'}}, `${isAI?"Une IA":"Un conseiller"} est en ligne. Ses actions sont limitées :`),
            e('ul', { className: 'permissions-list' }, summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check'), e('span', null, x))), summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('close'), e('span', null, x)))),
            e('button', { className: 'modal-btn primary', onClick: () => setShowPermissionsPopup(false) }, 'Continuer')
          )
        ),

        (pendingConfirmation || localFaceIdAction) && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('div', { style: { textAlign: 'center' } },
              e('div', { className: `face-id-wrapper ${scanState}` }, e('div', { className: 'face-id-icon' }, Icon(scanState === 'success' ? 'check_circle' : 'face')), e('div', { className: 'face-id-scanner' })),
              e('h3', { className: 'modal-title', style: { justifyContent: 'center' } }, scanState === 'success' ? 'Vérifié' : 'Face ID requis'),
              e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' } }, `Autoriser : ${pendingConfirmation ? pendingActionName : 'Déverrouillage'} ?`),
              e('button', { className: 'modal-btn primary', onClick: pendingConfirmation ? approveServerAction : executeLocalFaceId, disabled: busy || scanState !== 'idle' }, 'Scanner mon visage'),
              e('button', { className: 'modal-btn secondary', onClick: () => { setPendingConfirmation(''); setLocalFaceIdAction(null); }, disabled: scanState !== 'idle' }, 'Annuler')
            )
          )
        ),

        scamAlert && e('div', { className: 'modal-overlay' },
          e('div', { className: 'modal' },
            e('h3', { className: 'modal-title', style: { color: 'var(--danger)' } }, Icon('warning'), 'Arrêtez tout'),
            e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' } }, scamAlert),
            e('button', { className: 'modal-btn danger', onClick: resetState }, 'Raccrocher et signaler')
          )
        ),

        e('div', { className: 'toast-container' }, toasts.map(t => e('div', { key: t.id, className: 'toast' }, t.msg)))
      )
    ),

    // ===============================================
    // DROITE : DASHBOARDS ADMIN
    // ===============================================
    e('div', { className: 'admin-panel' },
      
      // Les Onglets (Tabs)
      e('div', { className: 'admin-tabs' },
        e('button', { className: `admin-tab ${adminTab === 'CRM' ? 'active' : ''}`, onClick: () => setAdminTab('CRM') }, 'Vue Conseiller (CRM)'),
        e('button', { className: `admin-tab ${adminTab === 'CISO' ? 'active' : ''}`, onClick: () => setAdminTab('CISO') }, 'Vue Global (CISO)')
      ),

      // CONTENU ONGLET 1 : CRM (CONSEILLER)
      adminTab === 'CRM' && e('div', { className: 'admin-content' },
        e('div', { className: 'admin-card', style: { borderTop: '4px solid var(--primary)' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
            e('div', null, e('h3', { style: { margin: '0 0 0.25rem 0', borderBottom: 'none', padding: 0 } }, 'Alexandre Dupont'), e('p', { style: { margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' } }, 'ID : 09843-AX | Seg: Particulier')),
            e('div', { className: `crm-status-badge ${verified ? 'secure' : 'idle'}` }, Icon(verified ? 'lock' : 'lock_open'), verified ? 'Authentifié' : 'Non authentifié')
          ),
          e('div', { className: 'row', style: { marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' } },
            !verified && e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, Icon('shield'), 'Authentifier client'),
            !verified && e('button', { className: 'control-btn', onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('smart_toy'), 'Lancer Voicebot IA'),
            verified && e('button', { className: 'control-btn', style: { color: 'var(--danger)', borderColor: 'var(--danger)', marginLeft: 'auto' }, onClick: resetState }, Icon('call_end'), 'Clôturer')
          )
        ),

        e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
          e('h3', null, Icon('dashboard_customize'), 'Actions Conseiller & Hackers'),
          e('div', { className: 'row' },
            e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('ac_unit'), 'Geler (Step-Up)'),
            e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Virement (Bloqué)'),
            // LE BOUTON ANYDESK
            e('button', { className: `control-btn ${isScreenShared ? 'primary' : 'warning'}`, style: { marginLeft: 'auto'}, onClick: simulateScreenShare }, Icon(isScreenShared ? 'visibility' : 'visibility_off'), isScreenShared ? 'Arrêter AnyDesk' : 'Simuler Hack AnyDesk')
          )
        ),

        e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
          e('h3', null, Icon('history'), 'Piste d\'audit (Compliance)'),
          e('div', { className: 'logs' },
            actionLog.length === 0 && e('div', null, '> En attente...'),
            actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
          )
        )
      ),

      // CONTENU ONGLET 2 : CISO (DIRECTEUR SÉCURITÉ)
      adminTab === 'CISO' && e('div', { className: 'admin-content' },
        e('div', { className: 'ciso-grid' },
          e('div', { className: 'ciso-stat-card green' }, e('div', { className: 'icon' }, Icon('verified_user')), e('p', { className: 'value' }, '12 450'), e('p', { className: 'label' }, 'Appels sécurisés (Aujourd\'hui)')),
          e('div', { className: 'ciso-stat-card red' }, e('div', { className: 'icon' }, Icon('gavel')), e('p', { className: 'value' }, '342'), e('p', { className: 'label' }, 'Attaques stoppées par le Policy Engine')),
          e('div', { className: 'ciso-stat-card' }, e('div', { className: 'icon' }, Icon('savings')), e('p', { className: 'value' }, '1,2 M €'), e('p', { className: 'label' }, 'Fonds sauvés des fraudes (APP Fraud)'))
        ),
        e('div', { className: 'admin-card' },
          e('h3', null, Icon('bolt'), 'Prévention des fraudes (Mode Opératoire)'),
          e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 } }, "Le protocole Castor empêche nativement les attaques suivantes :"),
          e('ul', { style: { fontSize: '0.9rem', color: '#333', lineHeight: 1.6 } },
            e('li', null, e('strong', null, 'Clonage Vocal / Deepfake :'), ' Bloqué. Sans la signature EdDSA du serveur, la voix n\'a aucune autorité.'),
            e('li', null, e('strong', null, 'Ingénierie Sociale au Virement :'), ' Bloqué. Si le client tente un virement pendant l\'appel, Castor coupe la session.'),
            e('li', null, e('strong', null, 'Prise de contrôle à distance (AnyDesk) :'), ' Bloqué. Castor masque l\'interface dès la détection de l\'écran partagé.')
          )
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
