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
  
  // États de la carte bancaire
  const [isCardFrozen, setIsCardFrozen] = useState(false);
  const [onlinePayments, setOnlinePayments] = useState(true);
  
  // Navigation
  const [activePage, setActivePage] = useState('HOME'); // HOME, TRANSFER, CARD
  const [showPermissionsPopup, setShowPermissionsPopup] = useState(false);
  
  // États Virement
  const [transferAmount, setTransferAmount] = useState(''); 
  const [transferRecipient, setTransferRecipient] = useState(RECIPIENTS[1]);
  const [newBeneficiaryName, setNewBeneficiaryName] = useState('');
  const [newBeneficiaryIban, setNewBeneficiaryIban] = useState('');
  
  // Modales
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
    setActivePage('HOME'); setShowPermissionsPopup(false);
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
          logAction(`❌ Rejet du serveur : Action bloquée par la politique (${data.action}).`, 'err');
          setScamAlert(`ALERTE SÉCURITÉ\n\nL'appelant tente une opération bloquée par la sécurité serveur (${data.action}).\n\nCeci est une fraude, raccrochez immédiatement.`);
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
      logAction('✅ Client a validé l\'opération.', 'success');
      showToast("Action confirmée via FaceID.");
      
      if (pendingActionName === 'FREEZE_CARD') {
        setIsCardFrozen(true);
      }
    } catch (err) {
      showToast("Erreur de validation.");
    } finally {
      setBusy(false);
    }
  }

  function handleUserAction(actionName) {
    let finalAmount = 0;
    const isNewBeneficiary = transferRecipient === RECIPIENTS[0];

    if (actionName === 'WIRE_TRANSFER') {
      finalAmount = parseFloat(transferAmount);
      if (isNaN(finalAmount) || finalAmount <= 0) {
        showToast("Saisissez un montant valide.");
        return;
      }
      if (isNewBeneficiary && (!newBeneficiaryName || !newBeneficiaryIban)) {
        showToast("Veuillez remplir les informations du bénéficiaire.");
        return;
      }
    }

    logAction(`Le client initie : ${actionName}...`);

    // ==========================================
    // LOGIQUE DE SÉCURITÉ (APPEL EN COURS)
    // ==========================================
    if (verified === true) {
      
      // LA NOUVELLE RÈGLE : Nouveau bénéficiaire + Appel = FRAUDE IMMÉDIATE (peu importe le montant)
      if (actionName === 'WIRE_TRANSFER' && isNewBeneficiary) {
          logAction(`❌ ALERTE CRITIQUE : Ajout de bénéficiaire pendant un appel !`, 'err');
          setScamAlert(`ALERTE FRAUDE (MODE OPÉRATOIRE DÉTECTÉ)\n\nVous tentez d'ajouter un nouveau bénéficiaire IBAN alors qu'un conseiller est en ligne.\n\nC'est la méthode n°1 des fraudeurs pour vider votre compte. RACCROCHEZ IMMÉDIATEMENT.`);
          setActivePage('HOME');
          return;
      }

      if (summary.cannot.includes(actionName)) {
          setScamAlert(`ATTENTION\n\nL'appelant tente de vous faire exécuter une action interdite (${actionName}). Raccrochez.`);
          setActivePage('HOME');
          return;
      }

      if (actionName === 'WIRE_TRANSFER') {
          setScamAlert(`ALERTE FRAUDE\n\nVous tentez d'envoyer ${finalAmount.toFixed(2)}€ alors qu'un appel est en cours.\n\nSi l'interlocuteur vous le demande, c'est une manipulation. Raccrochez.`);
          setActivePage('HOME');
          return;
      }

      // Actions in-app autorisées
      if (actionName === 'FREEZE_CARD') setIsCardFrozen(true);
      if (actionName === 'UNFREEZE_CARD') setIsCardFrozen(false);
      if (actionName === 'REPORT_LOST') { setIsCardFrozen(true); showToast("Carte déclarée volée/perdue. Nouvelle carte commandée."); setActivePage('HOME'); return;}

      showToast(`Action exécutée : ${actionName}`);
      return;
    }

    // ==========================================
    // LOGIQUE STANDARD (HORS APPEL)
    // ==========================================
    if (actionName === 'WIRE_TRANSFER' && finalAmount <= 50 && !isNewBeneficiary) {
      logAction(`✅ Virement standard validé (<50€).`, 'success');
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setActivePage('HOME');
      showToast(`Virement de ${finalAmount.toFixed(2)} € envoyé.`);
      return;
    }

    const isSafe = confirm(`SÉCURITÉ PASSIVE\n\nVous initiez une opération sensible.\nRAPPEL : Les vrais conseillers sont automatiquement authentifiés en haut de l'écran.\n\nSi quelqu'un vous guide au téléphone sans cette bannière, c'est une fraude.\n\nContinuer ?`);
    
    if (!isSafe) return;

    logAction(`✅ Opération client validée : ${actionName}`, 'success');
    
    if (actionName === 'FREEZE_CARD') { setIsCardFrozen(true); showToast("Carte bloquée."); } 
    else if (actionName === 'UNFREEZE_CARD') { setIsCardFrozen(false); showToast("Carte débloquée."); } 
    else if (actionName === 'REPORT_LOST') { setIsCardFrozen(true); showToast("Carte bloquée définitivement."); setActivePage('HOME'); }
    else if (actionName === 'WIRE_TRANSFER') {
      setBalance(prev => prev - finalAmount);
      setTransferAmount('');
      setNewBeneficiaryName(''); setNewBeneficiaryIban('');
      setActivePage('HOME');
      const targetName = isNewBeneficiary ? newBeneficiaryName : transferRecipient;
      showToast(`Virement de ${finalAmount.toFixed(2)} € vers ${targetName} effectué.`);
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
    // GAUCHE : APP MOBILE
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
          e('div', { className: `bank-card ${isCardFrozen ? 'frozen' : ''}`, onClick: () => setActivePage('CARD') },
            isCardFrozen && e('div', { className: 'frozen-badge' }, Icon('ac_unit'), 'BLOQUÉE'),
            e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Compte Courant'),
            e('div', { className: 'balance' }, `${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`),
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'} },
              e('div', { style: { fontFamily: 'monospace', opacity: 0.6, fontSize: '0.8rem' } }, '**** **** **** 4092'),
              e('div', { style: { fontSize: '0.75rem', opacity: 0.8 } }, 'Gérer ma carte >')
            )
          ),

          e('div', { className: 'action-grid' },
            e('button', { className: 'action-btn', onClick: () => setActivePage('TRANSFER') }, e('div', {className: 'icon'}, Icon('sync_alt')), 'Virement'),
            e('button', { className: 'action-btn', onClick: () => setActivePage('CARD') }, e('div', {className: 'icon'}, Icon('credit_card')), 'Ma Carte'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('DISCUSS_CASE') }, e('div', {className: 'icon'}, Icon('chat')), 'Message'),
            e('button', { className: 'action-btn', onClick: () => handleUserAction('ASK_OTP') }, e('div', {className: 'icon'}, Icon('key')), 'Code')
          ),
          
          e('h3', { style: { fontSize: '1rem', marginTop: '1rem', marginBottom: '1rem' } }, 'Dernières opérations'),
          e('div', { className: 'tx-list' }, 
            e('div', { className: 'tx-item' }, e('span', null, 'Netflix'), e('span', null, '- 13,99 €')),
            e('div', { className: 'tx-item' }, e('span', null, 'Salaire Castor'), e('span', {style: {color: 'var(--success)'}}, '+ 2 150,00 €'))
          )
        ),

        // ===============================================
        // PAGE : NOUVEAU VIREMENT
        // ===============================================
        activePage === 'TRANSFER' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')),
            e('h3', null, 'Virement')
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
            
            // Apparaît uniquement si on choisit "Nouveau bénéficiaire..."
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
              e('label', null, 'Montant (€)'),
              e('input', { type: 'number', min: '1', placeholder: '0.00', value: transferAmount, onChange: (evt) => setTransferAmount(evt.target.value) })
            ),
            e('button', { className: 'btn-primary', onClick: () => handleUserAction('WIRE_TRANSFER') }, 'Confirmer le virement')
          )
        ),

        // ===============================================
        // PAGE : GESTION DE LA CARTE BANCAIRE
        // ===============================================
        activePage === 'CARD' && e('div', { className: 'mobile-page' },
          e('div', { className: 'page-header' },
            e('div', { className: 'back-btn', onClick: () => setActivePage('HOME') }, Icon('arrow_back')),
            e('h3', null, 'Gérer ma carte')
          ),
          e('div', { className: 'page-content' },
            e('div', { className: `bank-card ${isCardFrozen ? 'frozen' : ''}`, style: { margin: '0 0 2rem 0', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' } },
              isCardFrozen && e('div', { className: 'frozen-badge' }, Icon('ac_unit'), 'BLOQUÉE'),
              e('div', { style: { fontSize: '0.9rem', opacity: 0.8 } }, 'Visa Premier'),
              e('div', { className: 'balance', style: { fontSize: '1.5rem', marginTop: '2rem' } }, '**** **** **** 4092'),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', opacity: 0.8, fontSize: '0.9rem' } },
                e('span', null, 'ALEXANDRE DUPONT'), e('span', null, '12/28')
              )
            ),

            e('div', { className: 'menu-list' },
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, e('div', { className: 'icon' }, Icon('speed')), e('div', null, e('h4', null, 'Plafonds de paiement'), e('p', null, 'Utilisé : 450€ / 2500€'))),
                Icon('chevron_right')
              ),
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, e('div', { className: 'icon' }, Icon('language')), e('div', null, e('h4', null, 'Paiements sur internet'), e('p', null, onlinePayments ? 'Activés' : 'Désactivés'))),
                e('label', { className: 'switch' }, 
                  e('input', { type: 'checkbox', checked: onlinePayments, onChange: () => setOnlinePayments(!onlinePayments) }),
                  e('span', { className: 'slider' })
                )
              )
            ),

            e('div', { className: 'menu-list' },
              e('div', { className: 'menu-item' },
                e('div', { className: 'menu-item-info' }, 
                  e('div', { className: 'icon', style: { background: isCardFrozen ? '#f0f4ff' : '#fff0f0', color: isCardFrozen ? 'var(--primary)' : 'var(--danger)' } }, Icon(isCardFrozen ? 'lock_open' : 'ac_unit')), 
                  e('div', null, e('h4', null, isCardFrozen ? 'Débloquer la carte' : 'Bloquer temporairement'), e('p', null, isCardFrozen ? 'Réactiver les paiements' : 'En cas de doute'))
                ),
                e('label', { className: 'switch' }, 
                  e('input', { type: 'checkbox', checked: isCardFrozen, onChange: () => handleUserAction(isCardFrozen ? 'UNFREEZE_CARD' : 'FREEZE_CARD') }),
                  e('span', { className: 'slider' })
                )
              )
            ),

            e('button', { className: 'btn-danger', onClick: () => handleUserAction('REPORT_LOST') }, Icon('warning'), 'Signaler volée ou perdue')
          )
        ),

        // MODALES (Bottom Sheets)
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

      e('div', { className: 'admin-card', style: { opacity: verified ? 1 : 0.5, pointerEvents: verified ? 'auto' : 'none' } },
        e('h3', null, Icon('dashboard_customize'), 'Actions Conseiller (Distantes)'),
        e('p', { style: { fontSize: '0.85rem', color: '#555', margin: 0 } }, verified ? 'Le canal est sécurisé. Vos actions sont limitées par la politique du serveur.' : 'Veuillez authentifier le client pour activer les actions.'),
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
