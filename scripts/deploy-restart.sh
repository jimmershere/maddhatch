#!/usr/bin/env bash
# Runs ON the droplet after rsync. Installs prod deps and restarts the service.
# Prefers systemd (systemctl restart maddhatchery); falls back to a port restart.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
PORT="${PORT:-3200}"

# Resolve a Node >= 22 (isolated /opt/node22 preferred) + node:sqlite flag.
NODE_BIN="${MH_NODE:-$([ -x /opt/node22/bin/node ] && echo /opt/node22/bin/node || command -v node)}"
NPM_BIN="$(dirname "$NODE_BIN")/npm"; [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
FLAGS=""; [ "$NODE_MAJOR" -lt 23 ] && FLAGS="--experimental-sqlite"
echo "→ Using Node $("$NODE_BIN" -v) ($NODE_BIN)"

echo "→ Installing production dependencies…"
if [ -f package-lock.json ]; then "$NPM_BIN" ci --omit=dev; else "$NPM_BIN" install --omit=dev; fi

echo "→ Seeding / migrating catalog…"
"$NODE_BIN" $FLAGS db.js >/dev/null 2>&1 || true

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^maddhatchery\.service'; then
  echo "→ Restarting via systemd…"
  sudo systemctl restart maddhatchery
else
  echo "→ Restarting via port ($PORT)…"
  pid="$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  [ -n "${pid:-}" ] && { kill "$pid" 2>/dev/null || true; sleep 1; }
  nohup setsid bash scripts/start.sh >/tmp/maddhatchery.log 2>&1 &
  disown || true
fi

echo "→ Health check…"
sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz" || echo 000)"
echo "   /healthz → HTTP ${code}"
[ "$code" = "200" ] || { echo "❌ Service did not come up healthy"; exit 1; }
echo "✅ Madd Hatchery deployed and healthy."
