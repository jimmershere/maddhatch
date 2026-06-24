#!/usr/bin/env bash
# Madd Hatchery — runtime launcher. Loads Stripe/admin secrets, then runs the
# Node service. Used by systemd (preferred) or directly on the droplet.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# Secrets live OUTSIDE the repo. Adjust the path per host if needed.
SECRETS="${MADDHATCHERY_SECRETS:-$HOME/.openclaw/secrets/stripe.env}"
if [ -f "$SECRETS" ]; then
  set -a; # shellcheck disable=SC1090
  source "$SECRETS"; set +a
else
  echo "⚠️  No secrets file at $SECRETS — Stripe checkout will be disabled." >&2
fi

export PORT="${PORT:-3200}"
export SITE_URL="${SITE_URL:-https://maddhatchery.com}"

# Resolve a Node >= 22. Prefer an isolated /opt/node22 if present (so we don't
# depend on a system Node that other services pin). node:sqlite needs the
# --experimental-sqlite flag before Node 23; it's unflagged from 23+.
NODE_BIN="${MH_NODE:-$([ -x /opt/node22/bin/node ] && echo /opt/node22/bin/node || command -v node)}"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
FLAGS=""; [ "$NODE_MAJOR" -lt 23 ] && FLAGS="--experimental-sqlite"

exec "$NODE_BIN" $FLAGS server.js
