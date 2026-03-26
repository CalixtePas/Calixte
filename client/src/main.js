import React, { useMemo, useState, useRef, useEffect } from 'https://esm.sh/react@18.3.1';
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

const OS_APPS = [
  { name: 'Photos', icon: 'photo_library', color: '#fff', bg: '#007AFF' },
  { name: 'Messages', icon: 'chat_bubble', color: '#fff', bg: '#34C759' },
  { name: 'Météo', icon: 'partly_cloudy_day', color: '#fff', bg: '#5AC8FA' },
  { name: 'Réglages', icon: 'settings', color: '#fff', bg: '#8E8E93' },
  { name: 'Maps', icon: 'map', color: '#fff', bg: '#FF9500' },
  { name: 'Bourse', icon: 'show_chart', color: '#fff', bg: '#1c1c1e' },
];

function App() {
  const [deviceView, setDeviceView] = useState('OS_HOME'); 
  const [adminTab, setAdminTab] = useState('CRM');
  const [currentTime, setCurrentTime] = useState('');
  
  const [balance, setBalance] = useState(12450.00);
  const [token, setToken] = useState('');
  const [verified, setVerified] = useState(null); 
  const [payload, setPayload] = useState(null);
  const [interactionId, setInteractionId] = useState('');
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  const [isCardCanceled, setIsCardCanceled] = useState(false);
  const [onlinePayments, setOnlinePayments] = useState(true);
  
  const [incomingCallParams, setIncomingCallParams] = useState(null); 
  const [isPhoneCallActive, setIsPhoneCallActive] = useState(false);
  const [isScreenShared, setIsScreenShared] = useState(false);
  
  const [hasPushNotif, setHasPushNotif] = useState(false);
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  
  const [actionLog, setActionLog] = useState([]);
  const [apiLogs, setApiLogs] = useState([]); 
  const esRef = useRef(null);
  
  const terminalRef = useRef(null);
  const auditRef = useRef(null);

  const [activePage, setActivePage] = useState('HOME');
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [newBeneficiaryIban, setNewBeneficiaryIban] = useState('');
  
  const [pendingConfirmation, setPendingConfirmation] = useState('');
  const [pendingActionName, setPendingActionName] = useState('');
  const [localFaceIdAction, setLocalFaceIdAction] = useState(null); 
  const [pendingActionData, setPendingActionData] = useState(null); 
  const [scanState, setScanState] = useState('idle');
  const [customPrompt, setCustomPrompt] = useState(null); 

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  const actorName = payload?.actor_type === 'AI_AGENT' ? 'Agent IA' : (incomingCallParams?.actorType === 'AI_AGENT' ? 'Agent IA' : 'Service Client');

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [apiLogs, adminTab]);

  useEffect(() => {
    if (auditRef.current) auditRef.current.scrollTop = auditRef.current.scrollHeight;
  }, [actionLog, adminTab]);

  const logAction = (msg, type = 'info') => setActionLog(prev => [...prev, {msg, type, t: new Date().toLocaleTimeString()}].slice(-50));
  const showToast = (msg) => { const id = Date.now(); setToasts(prev => [...prev, { id, msg }]); setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000); };
  const logApiPayload = (direction, route, data) => setApiLogs(prev => [...prev, { t: new Date().toISOString(), direction, route, data }]);

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setScamAlert(''); setHasPushNotif(false); setShowPermissionsPopup(false);
    setIncomingCallParams(null); setIsPhoneCallActive(false); setIsScreenShared(false);
    setPendingConfirmation(''); setPendingActionName(''); setLocalFaceIdAction(null); setPendingActionData(null); setScanState('idle'); setCustomPrompt(null);
  }

  // --- ACTIONS CRM ---
  async function simulateIncomingCall(actorType) {
    setBusy(true); resetState();
    logAction(`Appel téléphonique sortant vers le client...`);
    
    try {
      const startReq = { actor_type: actorType, intent: 'FRAUD_CALLBACK', audience_ref: 'app-mobile-user' };
      logApiPayload('out', 'POST /interactions/start', startReq);

      const resStart = await fetch(`${API}/interactions/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(startReq) });
      const dataStart = await resStart.json();
      logApiPayload('in', '200 OK (Interaction Created)', dataStart);
      
      setIncomingCallParams({ actorType, dataStart });
    } catch (err) { logAction('❌ Échec réseau.', 'err'); } finally { setBusy(false); }
  }

  async function acceptCall() {
    if (!incomingCallParams) return;
    const { dataStart } = incomingCallParams;
    
    setIncomingCallParams(null);
    setIsPhoneCallActive(true);
    logAction(`📞 Le client a décroché. Vérification Castor...`, 'info');

    try {
      setToken(dataStart.token);
      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      const result = await jwtVerify(dataStart.token, key, { issuer: 'castor' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      
      setDeviceView('APP');
      setHasPushNotif(false);
      setShowPermissionsPopup(true);
      logAction(`✅ Preuve cryptographique valide. Canal sécurisé activé.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        logApiPayload('in', 'SSE Event (Server Push)', data);
        if (data.type === 'STEP_UP') {
          logAction(`🔔 Demande d'action distante : ${data.action}.`, 'warn');
          setCustomPrompt({
            title: 'Validation Serveur',
            message: `Le serveur demande de valider l'action distante : ${data.action}.`,
            isDanger: false,
            onConfirm: () => { 
              setCustomPrompt(null);
              setPendingActionName(data.action); 
              setPendingConfirmation(data.confirmation_id); 
            }
          });
        } else if (data.type === 'ALLOW') {
          logAction(`ℹ️ Action autorisée (${data.action}).`); showToast(`Action validée.`);
        } else if (data.type === 'DENY') {
          logAction(`❌ Rejet du serveur (${data.action}).`, 'err');
          setScamAlert(`ALERTE SÉCURITÉ\n\nL'appelant tente une opération bloquée par la sécurité serveur.\n\nRaccrochez.`);
        }
      };
      esRef.current = es;
    } catch (err) { setVerified(null); logAction('❌ Échec cryptographique.', 'err'); }
  }

  function declineCall() {
    setIncomingCallParams(null);
    resetState();
    logAction(`📵 Le client a refusé l'appel.`, 'warn');
  }

  async function simulateCallerAction(action) {
    if (verified !== true) return;
    const reqBody = { interaction_id: interactionId, action };
    logApiPayload('out', 'POST /policy/evaluate', reqBody);
    try { 
        const res = await fetch(`${API}/policy/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) }); 
        const data = await res.json();
        logApiPayload('in', '200 OK (Policy Evaluation)', data);
    } catch (err) {}
  }

  function simulateScreenShare() {
    setIsScreenShared(!isScreenShared);
    if (!isScreenShared) logAction(`⚠️ Prise de contrôle à distance simulée (AnyDesk).`, 'warn');
    else logAction(`Arrêt du partage d'écran.`, 'info');
  }

  function executeFaceIdScan(onSuccess) {
    setScanState('scanning'); setBusy(true);
    setTimeout(() => {
      setScanState('success');
      setTimeout(() => { onSuccess(); setScanState('idle'); setBusy(false); }, 600); 
    }, 1200);
  }

  // VALIDATION SERVEUR
  async function approveServerAction() {
    executeFaceIdScan(async () => {
      logApiPayload('out', `POST /confirmations/${pendingConfirmation}/approve`, {});
      try {
        await fetch(`${API}/confirmations/${pendingConfirmation}/approve`, { method: 'POST' });
        setPendingConfirmation(''); logAction('✅ Validation FaceID réussie.', 'success'); showToast("Action confirmée.");
        if (pendingActionName === 'FREEZE_CARD') setIsCardFrozen(true);
      } catch (err) { showToast("Erreur de validation."); }
    });
  }

  // EXÉCUTION DE L'ACTION CLIENT APRÈS FACE ID
  function executeLocalFaceId() {
    executeFaceIdScan(() => {
      if (localFaceIdAction === 'REPORT_LOST') {
        setIsCardCanceled(true); setIsCardFrozen(true); showToast("Carte en opposition définitive."); setActivePage('HOME');
      } else if (localFaceIdAction === 'FREEZE_CARD') {
        setIsCardFrozen(true); showToast("Carte bloquée temporairement.");
      } else if (localFaceIdAction === 'UNFREEZE_CARD') {
        setIsCardFrozen(false); showToast("Carte débloquée.");
      } else if (localFaceIdAction === 'WIRE_TRANSFER') {
        setBalance(prev => prev - pendingActionData.amount); 
        setTransferAmount(''); setNewBeneficiaryName(''); setNewBeneficiaryIban('');
        setActivePage('HOME'); 
        showToast(`Virement de ${pendingActionData.amount.toFixed(2)} € validé.`);
      } else if (localFaceIdAction === 'ASK_OTP') {
        showToast("Code OTP sécurisé : 849 201");
      } else if (localFaceIdAction === 'DISCUSS_CASE') {
        showToast("Ouverture de la messagerie sécurisée.");
      }
      setLocalFaceIdAction(null);
      setPendingActionData(null);
    });
  }

  // --- INTERCEPTION DES ACTIONS CLIENT ---
  function handleUserAction(actionName) {
    let finalAmount = parseFloat(transferAmount);
    const isNewBen = transferRecipient === RECIPIENTS[0];

    if (actionName === 'WIRE_TRANSFER') {
        if (isNaN(finalAmount) || finalAmount <= 0) return showToast("Veuillez saisir un montant valide.");
        if (isNewBen && (!newBeneficiaryName || !newBeneficiaryIban)) return showToast("Informations du bénéficiaire manquantes.");
    }

    // SI EN APPEL SÉCURISÉ
    if (verified === true) {
      if (actionName === 'WIRE_TRANSFER' && isNewBen) {
          setScamAlert(`ALERTE FRAUDE (MODE OPÉRATOIRE DÉTECTÉ)\n\nVous tentez d'ajouter un bénéficiaire alors qu'un conseiller est en ligne.\n\nC'est la méthode n°1 des fraudeurs. RACCROCHEZ.`);
          return;
      }
        
      if (summary.cannot.includes(actionName) && actionName !== 'WIRE_TRANSFER') { 
          setScamAlert(`ATTENTION\n\nL'appelant tente de vous faire exécuter une action interdite. Raccrochez.`); 
          return; 
      }
      
      if (actionName === 'WIRE_TRANSFER') { 
          setCustomPrompt({
              title: '⚠️ AVERTISSEMENT CRITIQUE ⚠️',
              message: `Vous êtes actuellement au téléphone.\n\nUn conseiller n'a PAS le droit de vous faire faire un virement ou demander un paiement.\n\nSi la personne au bout du fil vous demande de le faire, c'est une fraude. Raccrochez et signalez l'appel.\n\nVoulez-vous forcer ce virement sous votre propre responsabilité ?`,
              isDanger: true,
              onConfirm: () => {
                  setCustomPrompt(null);
                  setPendingActionData({ amount: finalAmount });
                  setLocalFaceIdAction(actionName); 
              }
          });
          return;
      }
      
      setLocalFaceIdAction(actionName);
      return;
    }

    // SI HORS APPEL
    let specificWarning = "";
    if (actionName === 'WIRE_TRANSFER') {
        specificWarning = "Un conseiller n'a pas le droit et ne vous demandera JAMAIS de faire un virement.\n\n";
    } else if (actionName === 'ASK_OTP') {
        specificWarning = "Un conseiller n'a pas le droit et ne vous demandera JAMAIS de lui dicter un code OTP.\n\n";
    }

    setCustomPrompt({
        title: 'SÉCURITÉ PASSIVE',
        message: `RAPPEL : Les vrais conseillers sont toujours authentifiés en haut de l'écran par l'application.\n\n${specificWarning}Êtes-vous sûr de vouloir continuer cette action sensible ?`,
        isDanger: false,
        onConfirm: () => {
            setCustomPrompt(null);
            if (actionName === 'WIRE_TRANSFER') setPendingActionData({ amount: finalAmount });
            setLocalFaceIdAction(actionName);
        }
    });
  }

  function openAppFromHome() {
    setDeviceView('APP');
    setHasPushNotif(false);
    if (verified) setShowPermissionsPopup(true);
  }

  function exportAuditReport() {
    const report = {
      compliance_id: `AUDIT-${Math.random().toString(36).substr(2, 9).toUpperCase()}`, timestamp: new Date().toISOString(),
      session: { interaction_id: interactionId || 'NO_SESSION', is_verified: verified || false, actor: actorName },
      audit_trail: actionLog, cryptographic_payloads: apiLogs
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `castor_compliance_${report.compliance_id}.json`; a.click();
    logAction("📄 Rapport d'Audit de Conformité généré.", "success");
  }

  // --- TEXTE DYNAMIQUE DU MODAL FACE ID ---
  let faceIdMessage = "Autoriser l'action ?";
  if (pendingConfirmation) faceIdMessage = `Le serveur demande de valider l'action : ${pendingActionName}`;
  else if (localFaceIdAction === 'REPORT_LOST') faceIdMessage = "Confirmer l'opposition définitive de votre carte ?";
  else if (localFaceIdAction === 'FREEZE_CARD') faceIdMessage = "Confirmer le blocage de la carte ?";
  else if (localFaceIdAction === 'UNFREEZE_CARD') faceIdMessage = "Confirmer le déblocage de la carte ?";
  else if (localFaceIdAction === 'WIRE_TRANSFER' && pendingActionData) faceIdMessage = `Confirmer le virement de ${pendingActionData.amount.toFixed(2)} € ?`;
  else if (localFaceIdAction === 'ASK_OTP') faceIdMessage = "Confirmer la génération d'un code OTP ?";

  return e('div', { className: 'demo-container' },
    
    // ===============================================
    // APP MOBILE / TELEPHONE
    // ===============================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        incomingCallParams && e('div', { className: 'incoming-call-screen' },
          e('div', { className: 'call-info' },
            e('div', { className: 'call-avatar' }, Icon('person')),
            e('h3', { className: 'call-name' }, actorName === 'Agent IA' ? '01 42 14 55 22' : 'Service Client'),
            e('p', { className: 'call-type' }, 'Appel entrant...')
          ),
          e('div', { className: 'call-actions' },
            e('div', { className: 'call-btn-wrapper' }, e('button', { className: 'call-btn decline', onClick: declineCall }, Icon('call_end')), e('span', { className: 'call-btn-label' }, 'Refuser')),
            e('div', { className: 'call-btn-wrapper' }, e('button', { className: 'call-btn accept', onClick: acceptCall }, Icon('call')), e('span', { className: 'call-btn-label' }, 'Décrocher'))
          )
        ),

        deviceView === 'OS_HOME' && e('div', { className: 'phone-home' },
          isPhoneCallActive && e('div', { className: 'active-call-pill' }, Icon('call'), '00:12'),
          e('div', { className: 'os-clock', style: { marginTop: isPhoneCallActive ? '2rem' : '0'} }, currentTime),
          
          hasPushNotif && e('div', { className: 'os-push', onClick: openAppFromHome },
            e('div', { className: 'icon-box' }, Icon('shield_person')),
            e('div', { className: 'os-push-content' }, e('h4', null, 'CastorBank'), e('p', null, `Appel téléphonique sécurisé. Touchez pour ouvrir.`))
          ),

          e('div', { className: 'app-grid' },
            OS_APPS.map(app => e('div', { key: app.name, className: 'app-icon-wrapper' }, e('div', { className: 'app-icon', style: { background: app.bg, color: app.color } }, Icon(app.icon)), e('div', { className: 'app-label' }, app.name))),
            e('div', { className: 'app-icon-wrapper', onClick: openAppFromHome }, e('div', { className: 'app-icon castor-app' }, Icon('account_balance')), e('div', { className: 'app-label' }, 'CastorBank'))
          )
        ),

        deviceView === 'APP' && e('div', { className: 'app-container' },
          
          isScreenShared && e('div', { className: 'privacy-screen' },
            e('div', { className: 'icon' }, Icon('visibility_off')),
            e('h3', null, 'Écran partagé détecté'),
            e('p', null, 'Pour votre sécurité, CastorBank a masqué vos données. Aucun conseiller ne vous demandera d\'installer AnyDesk.')
          ),

          e('div', { className: 'mobile-header' }, 
            e('div', { style: {display: 'flex', alignItems: 'center', gap:'0.5rem', cursor: 'pointer', color: '#666', fontSize:'0.85rem'}, onClick: () => { setDeviceView('OS_HOME'); setActivePage('HOME'); } }, Icon('arrow_back_ios'), 'Quitter'),
            e('div', { className: 'profile-pic' }, Icon('person'))
          ),

          verified === true && e('div', { className: 'call-banner verified' }, 
            e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, Icon('lock'), `Appel : ${actorName}`),
            e('button', { className: 'end-call-btn', onClick: resetState }, Icon('call_end'))
          ),

          e('div', { className: 'mobile-content' },
            e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, onClick: () => setActivePage('CARD') },
              (isCardFrozen || isCardCanceled) && e('div', { className: `frozen-badge ${isCardCanceled ? 'canceled' : ''}` }, Icon(isCardCanceled ? 'warning' : 'ac_unit'), isCardCanceled ? 'OPPOSITION' : 'BLOQUÉE'),
              e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
              e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'} }, 
                e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** 4092'),
                e('div', { style: { fontSize: '0.8rem', opacity: 0.9, fontWeight:500 } }, 'Gérer >')
              )
            ),

            e('div', { className: 'action-grid' },
              e('button', { className: 'action-btn', onClick: () => setActivePage('TRANSFER') }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
              e('button', { className: 'action-btn', onClick: () => setActivePage('CARD') }, e('div', {className: 'icon'}, Icon('credit_card')), 'Ma Carte'),
              e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
              e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code (OTP)')
            ),
            
            e('h3', { style: { fontSize: '1rem', marginTop: '1.5rem', marginBottom: '1rem' } }, 'Opérations récentes'),
            e('div', { className: 'tx-list' }, 
              e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
              e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
            )
          ),

          activePage === 'TRANSFER' && e('div', { className: 'mobile-page' },
            e('div', { className: 'page-header' }, 
              e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')), 
              e('h3', null, 'Nouveau Virement')
            ),
            e('div', { className: 'page-content' },
              e('div', { className: 'form-group' }, 
                e('label', null, 'Compte à débiter'), 
                e('select', { disabled: true }, e('option', null, `Compte Courant (${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €)`))
              ),
              e('div', { className: 'form-group' }, 
                e('label', null, 'Bénéficiaire'), 
                e('select', { value: transferRecipient, onChange: (e) => setTransferRecipient(e.target.value) }, 
                  RECIPIENTS.map(r => e('option', { key: r, value: r }, r))
                )
              ),
              transferRecipient === RECIPIENTS[0] && e(React.Fragment, null, 
                e('div', { className: 'form-group' }, 
                  e('label', null, 'Nom du bénéficiaire'), 
                  e('input', { type: 'text', placeholder: 'Ex: Garage Martin', value: newBeneficiaryName, onChange: (evt) => setNewBeneficiaryName(evt.target.value) })
                ), 
                e('div', { className: 'form-group' }, 
                  e('label', null, 'IBAN'), 
                  e('input', { type: 'text', placeholder: 'FR76...', value: newBeneficiaryIban, onChange: (evt) => setNewBeneficiaryIban(evt.target.value) })
                )
              ),
              e('div', { className: 'form-group' }, 
                e('label', null, 'Montant du virement (€)'), 
                e('input', { type: 'number', min: '1', placeholder: '0.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })
              ),
              e('button', { className: 'btn-primary', onClick: () => handleUserAction('WIRE_TRANSFER') }, 'Valider le virement')
            )
          ),

          activePage === 'CARD' && e('div', { className: 'mobile-page' },
            e('div', { className: 'page-header' }, e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')), e('h3', null, 'Ma carte')),
            e('div', { className: 'page-content' },
              e('div', { className: `bank-card ${isCardCanceled ? 'canceled' : (isCardFrozen ? 'frozen' : '')}`, style: { margin: '0 0 2rem 0', cursor: 'default' } },
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
                e('div', { className: 'menu-item' }, e('div', { className: 'menu-item-info' }, e('div', { className: 'icon', style: { background: isCardCanceled ? '#eee' : (isCardFrozen ? '#f0f4ff' : '#fff0f0'), color: isCardCanceled ? '#666' : (isCardFrozen ? 'var(--primary)' : 'var(--danger)') } }, Icon(isCardCanceled ? 'block' : (isCardFrozen ? 'lock_open' : 'ac_unit'))), e('div', null, e('h4', null, isCardCanceled ? 'Opposition' : (isCardFrozen ? 'Débloquer' : 'Bloquer temporairement')))),
                  isCardCanceled ? null : e('label', { className: 'switch' }, e('input', { type: 'checkbox', checked: isCardFrozen, onChange: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }), e('span', { className: 'slider' }))
                )
              ),
              !isCardCanceled && e('button', { className: 'btn-danger', onClick: () => setLocalFaceIdAction('REPORT_LOST') }, Icon('warning'), 'Signaler volée ou perdue')
            )
          ),

          showPermissionsPopup && verified === true && e('div', { className: 'modal-overlay' },
            e('div', { className: 'modal' },
              e('h3', { className: 'modal-title' }, Icon('verified_user'), 'Sécurité de l\'appel'),
              e('p', {style: {color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem'}}, `L'application restreint techniquement les actions de l'appelant :`),
              e('ul', { className: 'permissions-list' }, summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check'), e('span', null, x))), summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('close'), e('span', null, x)))),
              e('button', { className: 'modal-btn primary', onClick: () => setShowPermissionsPopup(false) }, 'Continuer')
            )
          ),

          customPrompt && e('div', { className: 'modal-overlay' },
            e('div', { className: 'modal' },
              e('h3', { className: 'modal-title', style: { color: customPrompt.isDanger ? 'var(--danger)' : 'var(--text)' } }, Icon(customPrompt.isDanger ? 'warning' : 'info'), customPrompt.title),
              e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' } }, customPrompt.message),
              e('button', { className: `modal-btn ${customPrompt.isDanger ? 'danger' : 'primary'}`, onClick: customPrompt.onConfirm }, 'Continuer'),
              e('button', { className: 'modal-btn secondary', onClick: () => setCustomPrompt(null) }, 'Annuler')
            )
          ),

          (pendingConfirmation || localFaceIdAction) && e('div', { className: 'modal-overlay' },
            e('div', { className: 'modal' },
              e('div', { style: { textAlign: 'center' } },
                e('div', { className: `face-id-wrapper ${scanState}` }, e('div', { className: 'face-id-icon' }, Icon(scanState === 'success' ? 'check_circle' : 'face')), e('div', { className: 'face-id-scanner' })),
                e('h3', { className: 'modal-title', style: { justifyContent: 'center' } }, scanState === 'success' ? 'Vérifié' : 'Face ID'),
                e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' } }, faceIdMessage),
                e('button', { className: 'modal-btn primary', onClick: pendingConfirmation ? approveServerAction : executeLocalFaceId, disabled: busy || scanState !== 'idle' }, 'Scanner mon visage'),
                e('button', { className: 'modal-btn secondary', onClick: () => { setPendingConfirmation(''); setLocalFaceIdAction(null); setPendingActionData(null); }, disabled: scanState !== 'idle' }, 'Annuler')
              )
            )
          ),

          scamAlert && e('div', { className: 'modal-overlay' },
            e('div', { className: 'modal' },
              e('h3', { className: 'modal-title', style: { color: 'var(--danger)' } }, Icon('warning'), 'Arrêtez tout'),
              e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', marginBottom: '1.5rem' } }, scamAlert),
              e('button', { className: 'modal-btn danger', onClick: () => { resetState(); setDeviceView('OS_HOME'); } }, 'Raccrocher et quitter')
            )
          ),

          e('div', { className: 'toast-container' }, toasts.map(t => e('div', { key: t.id, className: 'toast' }, t.msg)))
        )
      )
    ),

    // ===============================================
    // DROITE : PANNEAU D'ADMINISTRATION
    // ===============================================
    e('div', { className: 'admin-panel' },
      
      e('div', { className: 'admin-tabs' },
        e('button', { className: `admin-tab ${adminTab === 'CRM' ? 'active' : ''}`, onClick: () => setAdminTab('CRM') }, 'Vue Conseiller'),
        e('button', { className: `admin-tab ${adminTab === 'CISO' ? 'active' : ''}`, onClick: () => setAdminTab('CISO') }, 'Vue Global (CISO)'),
        e('button', { className: `admin-tab ${adminTab === 'DEVELOPER' ? 'active' : ''}`, onClick: () => setAdminTab('DEVELOPER') }, 'Développeur & API')
      ),

      adminTab === 'CRM' && e('div', { className: 'admin-content' },
        e('div', { className: 'admin-card', style: { borderTop: '4px solid var(--primary)' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
            e('div', null, e('h3', { style: { margin: '0 0 0.25rem 0', borderBottom: 'none', padding: 0 } }, 'Alexandre Dupont'), e('p', { style: { margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' } }, 'ID : 09843-AX | Seg: Particulier')),
            e('div', { className: `crm-status-badge ${verified ? 'secure' : 'idle'}` }, Icon(verified ? 'lock' : 'lock_open'), verified ? 'Authentifié' : 'Non authentifié')
          ),
          e('div', { className: 'row', style: { marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' } },
            !isPhoneCallActive && !incomingCallParams && e('button', { className: 'control-btn primary', onClick: () => simulateIncomingCall('HUMAN_AGENT'), disabled: busy }, Icon('call'), 'Appeler (Humain)'),
            !isPhoneCallActive && !incomingCallParams && e('button', { className: 'control-btn', onClick: () => simulateIncomingCall('AI_AGENT'), disabled: busy }, Icon('smart_toy'), 'Appeler (Voicebot)'),
            (isPhoneCallActive || incomingCallParams) && e('button', { className: 'control-btn', style: { color: 'var(--danger)', borderColor: 'var(--danger)', marginLeft: 'auto' }, onClick: resetState }, Icon('call_end'), 'Raccrocher')
          )
        ),

        e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
          e('h3', null, Icon('dashboard_customize'), 'Actions (Policy Engine)'),
          e('div', { className: 'row' },
            e('button', { className: 'control-btn', onClick: () => simulateCallerAction('FREEZE_CARD') }, Icon('ac_unit'), 'Geler Carte (Step-Up)'),
            e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Virement (Bloqué)'),
            e('button', { className: `control-btn ${isScreenShared ? 'primary' : 'warning'}`, style: { marginLeft: 'auto'}, onClick: simulateScreenShare }, Icon(isScreenShared ? 'visibility' : 'visibility_off'), isScreenShared ? 'Arrêter AnyDesk' : 'Simuler AnyDesk')
          )
        ),

        e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center'} },
            e('h3', {style: {border: 'none', padding: 0, margin: 0}}, Icon('history'), 'Piste d\'audit'),
            e('button', { className: 'control-btn success', onClick: exportAuditReport }, Icon('download'), 'Export Conformité JSON')
          ),
          e('div', { className: 'logs', ref: auditRef },
            actionLog.length === 0 && e('div', null, '> En attente...'),
            actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
          )
        )
      ),

      adminTab === 'CISO' && e('div', { className: 'admin-content' },
        e('div', { className: 'ciso-grid' },
          e('div', { className: 'ciso-stat-card green' }, e('div', { className: 'icon' }, Icon('verified_user')), e('p', { className: 'value' }, '12 450'), e('p', { className: 'label' }, 'Appels sécurisés (Aujourd\'hui)')),
          e('div', { className: 'ciso-stat-card red' }, e('div', { className: 'icon' }, Icon('gavel')), e('p', { className: 'value' }, '342'), e('p', { className: 'label' }, 'Attaques stoppées par Policy Engine')),
          e('div', { className: 'ciso-stat-card' }, e('div', { className: 'icon' }, Icon('savings')), e('p', { className: 'value' }, '1,2 M €'), e('p', { className: 'label' }, 'Fonds sauvés (APP Fraud)'))
        ),
        e('div', { className: 'admin-card' },
          e('h3', null, Icon('bolt'), 'Prévention des fraudes (Mode Opératoire)'),
          e('p', { style: { color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 } }, "Le protocole Castor empêche nativement les attaques suivantes :"),
          e('ul', { style: { fontSize: '0.9rem', color: '#333', lineHeight: 1.6 } },
            e('li', null, e('strong', null, 'Clonage Vocal / Deepfake :'), ' Bloqué. Sans signature EdDSA, la voix n\'a aucune autorité.'),
            e('li', null, e('strong', null, 'Ingénierie Sociale au Virement :'), ' Bloqué. Action interdite en cours d\'appel.'),
            e('li', null, e('strong', null, 'Prise de contrôle à distance (AnyDesk) :'), ' Bloqué. Détection native de l\'écran partagé uniquement sur l\'app bancaire.')
          )
        )
      ),

      adminTab === 'DEVELOPER' && e('div', { className: 'admin-content' },
        e('h3', { style: { margin: 0, fontSize: '1.1rem' } }, 'Flux API & Preuves Cryptographiques'),
        e('p', { style: { fontSize: '0.85rem', color: '#666', marginTop: 0 } }, 'Visualisez les payloads réels traités par le moteur Castor en temps réel.'),
        e('div', { className: 'api-terminal', ref: terminalRef },
          apiLogs.length === 0 && e('div', null, '// En attente de requêtes API...'),
          apiLogs.map((log, i) => e('div', { key: i, className: 'api-log-entry' },
            e('div', { className: 'api-log-time' }, log.t),
            e('div', { className: `api-log-route ${log.direction}` }, log.direction === 'out' ? `→ ${log.route}` : `← ${log.route}`),
            e('pre', { className: 'json-payload' }, JSON.stringify(log.data, null, 2))
          ))
        )
      )
    )
  );
}

createRoot(document.getElementById('root')).render(e(App));
