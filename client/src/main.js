import React, { useMemo, useState, useRef, useEffect } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { importJWK, jwtVerify } from 'https://cdn.jsdelivr.net/npm/jose@5.9.6/+esm';

const API = window.ENV?.API_BASE_URL || 'http://localhost:3001/castor/v1';
const e = React.createElement;
const Icon = (name) => e('span', { className: 'material-symbols-outlined icon', style: { fontSize: 'inherit' } }, name);

// RETOUR DE LA LISTE COMPLÈTE
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
  
  const [incomingCallParams, setIncomingCallParams] = useState(null); 
  const [isPhoneCallActive, setIsPhoneCallActive] = useState(false);
  
  const [hasPushNotif, setHasPushNotif] = useState(false);
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  const [scamAlert, setScamAlert] = useState('');
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  
  const [actionLog, setActionLog] = useState([]);
  const [apiLogs, setApiLogs] = useState([]); 
  const esRef = useRef(null);

  // ÉTATS COMPLETS POUR LE VIREMENT
  const [activePage, setActivePage] = useState('HOME');
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [newBeneficiaryIban, setNewBeneficiaryIban] = useState('');

  const summary = useMemo(() => payload?.summary ?? { can: [], cannot: [] }, [payload]);
  const actorName = payload?.actor_type === 'AI_AGENT' ? 'Agent IA' : (incomingCallParams?.actorType === 'AI_AGENT' ? 'Agent IA' : 'Conseiller');

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  const logAction = (msg, type = 'info') => setActionLog(prev => [{msg, type, t: new Date().toLocaleTimeString()}, ...prev].slice(0, 50));
  const showToast = (msg) => { const id = Date.now(); setToasts(prev => [...prev, { id, msg }]); setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000); };
  const logApiPayload = (direction, route, data) => setApiLogs(prev => [{ t: new Date().toISOString(), direction, route, data }, ...prev]);

  function resetState() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setToken(''); setVerified(null); setPayload(null); setInteractionId('');
    setScamAlert(''); setHasPushNotif(false); setShowPermissionsPopup(false);
    setIncomingCallParams(null); setIsPhoneCallActive(false);
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
    logAction(`📞 Le client a décroché. Vérification Castor en arrière-plan...`, 'info');

    try {
      setToken(dataStart.token);
      const jwksRes = await fetch(`${API}/jwks`);
      const jwks = await jwksRes.json();
      const key = await importJWK(jwks.keys[0], 'EdDSA');
      const result = await jwtVerify(dataStart.token, key, { issuer: 'castor' });
      
      setVerified(true); setPayload(result.payload);
      const id = String(result.payload.sub);
      setInteractionId(id);
      
      if (deviceView === 'OS_HOME') {
        setHasPushNotif(true);
      } else {
        setShowPermissionsPopup(true);
      }
      logAction(`✅ Preuve cryptographique valide. Canal sécurisé activé.`, 'success');

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`${API}/interactions/${id}/stream`);
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        logApiPayload('in', 'SSE Event (Server Push)', data);
        if (data.type === 'STEP_UP') {
          logAction(`🔔 Demande d'action distante : ${data.action}.`, 'warn');
          if(confirm(`Le serveur demande de valider l'action : ${data.action}. Confirmer ?`)) {
              approveServerAction(data.confirmation_id, data.action);
          }
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

  async function approveServerAction(confId, actionName) {
    logApiPayload('out', `POST /confirmations/${confId}/approve`, {});
    try {
      await fetch(`${API}/confirmations/${confId}/approve`, { method: 'POST' });
      logAction('✅ Validation client réussie.', 'success'); showToast("Action confirmée.");
      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
    } catch (err) { showToast("Erreur de validation."); }
  }

  // --- ACTIONS CLIENT ---
  function handleUserAction(actionName) {
    let finalAmount = parseFloat(transferAmount);
    const isNewBen = transferRecipient === RECIPIENTS[0];

    if (actionName === 'WIRE_TRANSFER') {
        if (isNaN(finalAmount) || finalAmount <= 0) return showToast("Veuillez saisir un montant valide.");
        if (isNewBen && (!newBeneficiaryName || !newBeneficiaryIban)) return showToast("Informations du bénéficiaire manquantes.");
    }

    if (verified === true) {
      if (summary.cannot.includes(actionName)) { setScamAlert(`ALERTE FRAUDE\n\nTentative d'opération interdite pendant un appel.`); return; }
      if (actionName === 'WIRE_TRANSFER') { setScamAlert(`ALERTE FRAUDE\n\nVirement bloqué pendant l'appel.`); return; }
      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
      if (actionName === 'UNFREEZE_CARD') setIsCardFrozen(false);
      showToast(`Action exécutée.`); return;
    }

    // Hors appel
    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50 && !isNewBen) {
        setBalance(prev => prev - finalAmount); 
        setTransferAmount(''); 
        setActivePage('HOME');
        showToast(`Virement de ${finalAmount.toFixed(2)} € envoyé.`); 
        return;
    }

    if (!confirm(`SÉCURITÉ PASSIVE\n\nRAPPEL : Les vrais conseillers sont authentifiés en haut de l'écran.\nContinuer de vous-même ?`)) return;
    
    if (actionName === 'FREEZE_CARD') { setIsCardFrozen(true); showToast("Carte bloquée."); } 
    else if (actionName === 'UNFREEZE_CARD') { setIsCardFrozen(false); showToast("Carte débloquée."); } 
    else if (actionName === 'WIRE_TRANSFER') {
        setBalance(prev => prev - finalAmount); 
        setTransferAmount(''); 
        setNewBeneficiaryName(''); 
        setNewBeneficiaryIban('');
        setActivePage('HOME'); 
        showToast(`Virement de ${finalAmount.toFixed(2)} € validé.`);
    } else { showToast(`Opération effectuée.`); }
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

  return e('div', { className: 'demo-container' },
    
    // ===============================================
    // APP MOBILE / TELEPHONE
    // ===============================================
    e('div', { className: 'mobile-wrapper' },
      e('div', { className: 'mobile-device' },
        
        incomingCallParams && e('div', { className: 'incoming-call-screen' },
          e('div', { className: 'call-info' },
            e('div', { className: 'call-avatar' }, Icon('person')),
            e('h3', { className: 'call-name' }, actorName === 'Agent IA' ? '01 42 14 55 22' : 'Alexandre Dupont'),
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
          e('div', { className: 'mobile-header' }, 
            e('div', { style: {display: 'flex', alignItems: 'center', gap:'0.5rem', cursor: 'pointer', color: '#666', fontSize:'0.85rem'}, onClick: () => { setDeviceView('OS_HOME'); setActivePage('HOME'); } }, Icon('arrow_back_ios'), 'Quitter'),
            e('div', { className: 'profile-pic' }, Icon('person'))
          ),

          verified === true && e('div', { className: 'call-banner verified' }, 
            e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } }, Icon('lock'), `Appel : ${actorName}`),
            e('button', { className: 'end-call-btn', onClick: resetState }, Icon('call_end'))
          ),

          e('div', { className: 'mobile-content' },
            e('div', { className: `bank-card ${isCardFrozen ? 'frozen' : ''}` },
              isCardFrozen && e('div', { className: 'frozen-badge' }, Icon('ac_unit'), 'BLOQUÉE'),
              e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
              e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
              e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** 4092')
            ),

            e('div', { className: 'action-grid' },
              e('button', { className: 'action-btn', onClick: () => setActivePage('TRANSFER') }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
              e('button', { className: 'action-btn', onClick: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }, e('div', {className: 'icon'}, Icon(isCardFrozen ? 'lock_open' : 'ac_unit')), isCardFrozen ? 'Débloquer' : 'Bloquer'),
              e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
              e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code (OTP)')
            ),
            
            e('h3', { style: { fontSize: '1rem', marginTop: '1.5rem', marginBottom: '1rem' } }, 'Opérations récentes'),
            e('div', { className: 'tx-list' }, 
              e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
              e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
            )
          ),

          // --- LE FORMULAIRE DE VIREMENT COMPLET RÉTABLI ---
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

          showPermissionsPopup && verified === true && e('div', { className: 'modal-overlay' },
            e('div', { className: 'modal' },
              e('h3', { className: 'modal-title' }, Icon('verified_user'), 'Sécurité de l\'appel'),
              e('p', {style: {color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem'}}, `L'application restreint techniquement les actions de l'appelant :`),
              e('ul', { className: 'permissions-list' }, summary.can.map((x,i) => e('li', { key: `can-${i}`, className: 'can-text' }, Icon('check'), e('span', null, x))), summary.cannot.map((x,i) => e('li', { key: `cannot-${i}`, className: 'cannot-text' }, Icon('close'), e('span', null, x)))),
              e('button', { className: 'modal-btn primary', onClick: () => setShowPermissionsPopup(false) }, 'Continuer')
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
            e('button', { className: 'control-btn', onClick: () => simulateCallerAction('WIRE_TRANSFER') }, Icon('sync_alt'), 'Virement (Bloqué)')
          )
        ),

        e('div', { className: 'admin-card', style: { flex: 1, display: 'flex', flexDirection: 'column' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center'} },
            e('h3', {style: {border: 'none', padding: 0, margin: 0}}, Icon('history'), 'Piste d\'audit'),
            e('button', { className: 'control-btn success', onClick: exportAuditReport }, Icon('download'), 'Export Conformité JSON')
          ),
          e('div', { className: 'logs' },
            actionLog.length === 0 && e('div', null, '> En attente...'),
            actionLog.map((log, i) => e('div', { key: i, className: log.type }, `[${log.t}] ${log.msg}`))
          )
        )
      ),

      adminTab === 'DEVELOPER' && e('div', { className: 'admin-content' },
        e('h3', { style: { margin: 0, fontSize: '1.1rem' } }, 'Flux API & Preuves Cryptographiques'),
        e('p', { style: { fontSize: '0.85rem', color: '#666', marginTop: 0 } }, 'Visualisez les payloads réels traités par le moteur Castor en temps réel.'),
        e('div', { className: 'api-terminal' },
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
