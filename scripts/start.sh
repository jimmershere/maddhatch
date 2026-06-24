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

exec node server.js
