# Calixte (MVP)

Monorepo MVP pour démontrer “Vérifié vs Scam” + “Step-up” sur un callback fraude.

## Structure

- `server/` : API TypeScript (Fastify) + tests Vitest/Supertest
- `client/` : web app (simulation Verifier)
- `docs/` : schémas + notes

## Cas d’usage

- `intent = FRAUD_CALLBACK`
- `actor_type = AI_AGENT` ou `HUMAN_AGENT`
- actions:
  - `FREEZE_CARD` → `STEP_UP`
  - `ASK_OTP` → `DENY`
  - `WIRE_TRANSFER` → `DENY`
  - `DISCUSS_CASE` → `ALLOW`

## Quickstart

### Dev

```bash
npm install
npm run dev
```

- server: `http://localhost:3001`
- client: `http://localhost:5173`

### Tests

```bash
npm test
```

## API backend (`/calixte/v1`)

- `POST /interactions/start`
- `GET /jwks`
- `POST /policy/evaluate`
- `POST /confirmations/:id/approve`
## Déploiement

### Backend (Server)
Prêt pour Render, Railway ou Heroku.
- **Variables obligatoires / optionnelles** : 
  - `PORT` (ex: 8080)
  - `FRONTEND_ORIGIN` (ex: `https://mon-client-calixte.vercel.app`)
- **Run** : `npm run dev -w server` (ou compiler le TS en amont pour prod).

### Frontend (Client)
Prêt pour Vercel ou Netlify.
- **Build** : `npm run build -w client`
- **Output** : Le dossier `client/dist/` contient les fichiers statiques à déployer.
- **Configuration** : Éditez la balise `<script> window.ENV = ... </script>` dans `client/index.html` pour pointer vers l'URL de production du backend.
