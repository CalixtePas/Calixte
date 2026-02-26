#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="http://127.0.0.1:3001/calixte/v1"
SERVER_LOG="${ROOT_DIR}/.demo-server.log"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR/server"
node --experimental-strip-types src/index.ts >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in {1..40}; do
  if curl -sS "${API_BASE}/jwks" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

START_JSON="$(curl -sS -X POST "${API_BASE}/interactions/start" \
  -H 'Content-Type: application/json' \
  -d '{"actor_type":"AI_AGENT","intent":"FRAUD_CALLBACK","audience_ref":"demo-script"}')"

INTERACTION_ID="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.interaction_id) process.exit(1); process.stdout.write(d.interaction_id);" "$START_JSON")"

ASK_JSON="$(curl -sS -X POST "${API_BASE}/policy/evaluate" \
  -H 'Content-Type: application/json' \
  -d "{\"interaction_id\":\"${INTERACTION_ID}\",\"action\":\"ASK_OTP\"}")"
ASK_DECISION="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.decision||''));" "$ASK_JSON")"
[[ "$ASK_DECISION" == "DENY" ]] || { echo "FAIL ASK_OTP expected DENY"; exit 1; }
echo "OK ASK_OTP -> DENY"

FREEZE_JSON="$(curl -sS -X POST "${API_BASE}/policy/evaluate" \
  -H 'Content-Type: application/json' \
  -d "{\"interaction_id\":\"${INTERACTION_ID}\",\"action\":\"FREEZE_CARD\"}")"
FREEZE_DECISION="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.decision||''));" "$FREEZE_JSON")"
CONFIRMATION_ID="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.confirmation_id||''));" "$FREEZE_JSON")"
[[ "$FREEZE_DECISION" == "STEP_UP" && -n "$CONFIRMATION_ID" ]] || { echo "FAIL FREEZE_CARD expected STEP_UP + confirmation_id"; exit 1; }
echo "OK FREEZE_CARD -> STEP_UP"

APPROVE_JSON="$(curl -sS -X POST "${API_BASE}/confirmations/${CONFIRMATION_ID}/approve" -H 'Content-Type: application/json' -d '{}')"
APPROVE_STATUS="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.status||''));" "$APPROVE_JSON")"
[[ "$APPROVE_STATUS" == "APPROVED" ]] || { echo "FAIL approve expected APPROVED"; exit 1; }
echo "OK confirmation approve -> APPROVED"

FAKE_JSON="$(curl -sS -X POST "${API_BASE}/policy/evaluate" \
  -H 'Content-Type: application/json' \
  -d '{"interaction_id":"fake-id","action":"DISCUSS_CASE"}')"
FAKE_DECISION="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.decision||''));" "$FAKE_JSON")"
FAKE_REASON="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.reason||''));" "$FAKE_JSON")"
[[ "$FAKE_DECISION" == "DENY" ]] || { echo "FAIL fake interaction expected DENY"; exit 1; }
[[ "$FAKE_REASON" == *"UNVERIFIED"* ]] || { echo "FAIL fake interaction expected UNVERIFIED reason"; exit 1; }
echo "OK fake interaction -> DENY (scam/unverified)"
