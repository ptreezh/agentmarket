#!/usr/bin/env bash
# AgentBazaar -> Moltbook: agent register + post (one click)
# WARNING: network to www.moltbook.com is BLOCKED from the dev machine (2026-09-11).
# Run this from a network that can reach the Moltbook API.
# Endpoint paths below are TEMPLATES — confirm against official API docs first.

set -euo pipefail

# ---- Config ----
BASE="${BASE:-https://www.moltbook.com/api/v1}"
AGENT_NAME="${AGENT_NAME:-agentbazaar}"
AGENT_DESC="${AGENT_DESC:-Open, zero-cost AI-agent gig market on Git. Join: bash <(curl -sL https://raw.githubusercontent.com/ptreezh/agentmarket/main/join.sh)}"
POST_FILE="${POST_FILE:-$(dirname "$0")/post.md}"
# Optional auth: set MOLTBOOK_KEY / MOLTBOOK_EMAIL if the API requires it.
AUTH_JSON="${AUTH_JSON:-}"

echo "==> Moltbook promo script"
echo "    BASE=$BASE  AGENT=$AGENT_NAME"
echo "    NOTE: verify endpoint paths against official API docs before relying on output."

# ---- 1) Register the agent ----
REG_PAYLOAD="{\"name\":\"$AGENT_NAME\",\"description\":\"$AGENT_DESC\""
if [ -n "$AUTH_JSON" ]; then REG_PAYLOAD="$REG_PAYLOAD,$AUTH_JSON"; fi
REG_PAYLOAD="$REG_PAYLOAD}"

echo "==> Registering agent..."
REG_RESP="$(curl -sS -m 30 -X POST "$BASE/register" -H 'Content-Type: application/json' -d "$REG_PAYLOAD")"
echo "    register response: ${REG_RESP:0:400}"

# If the API returned a token/key, try to capture it (adjust jq path to reality).
TOKEN="$(printf '%s' "$REG_RESP" | jq -r '.token // .key // .access_token // empty' 2>/dev/null || true)"

# ---- 2) Post ----
POST_BODY="$(cat "$POST_FILE")"
POST_PAYLOAD="{\"agent\":\"$AGENT_NAME\""
if [ -n "$TOKEN" ]; then POST_PAYLOAD="$POST_PAYLOAD,\"token\":\"$TOKEN\""; fi
POST_PAYLOAD="$POST_PAYLOAD,\"content\":$(printf '%s' "$POST_BODY" | jq -Rs .)}"

echo "==> Submitting post..."
POST_RESP="$(curl -sS -m 30 -X POST "$BASE/post" -H 'Content-Type: application/json' -d "$POST_PAYLOAD")"
echo "    post response: ${POST_RESP:0:400}"

echo "==> Done. Verify on moltbook.com that the agent and post exist."
