#!/bin/sh
set -eu

APP_USER="${APP_USER:-appuser}"
CERT_FILE="${TLS_CERT_FILE:-/certs/fullchain.pem}"
KEY_FILE="${TLS_KEY_FILE:-/certs/privkey.pem}"
RUNTIME_CERT_DIR="${TLS_RUNTIME_CERT_DIR:-/tmp/tls}"  # directory writable by app user
CERT_DEST="${RUNTIME_CERT_DIR}/cert.pem"
KEY_DEST="${RUNTIME_CERT_DIR}/key.pem"

mkdir -p "$RUNTIME_CERT_DIR"
chmod 750 "$RUNTIME_CERT_DIR"
chown "$APP_USER":"$APP_USER" "$RUNTIME_CERT_DIR" 2>/dev/null || true

copy_cert() {
    src=$1
    dest=$2
    if [ ! -e "$src" ]; then
        return 1
    fi
    if cp "$src" "$dest" 2>/dev/null; then
        chmod 640 "$dest"
        chown "$APP_USER":"$APP_USER" "$dest" 2>/dev/null || true
        return 0
    fi
    return 1
}

cert_ok=false
if copy_cert "$CERT_FILE" "$CERT_DEST" && copy_cert "$KEY_FILE" "$KEY_DEST"; then
    export TLS_CERT_FILE="$CERT_DEST"
    export TLS_KEY_FILE="$KEY_DEST"
    cert_ok=true
else
    echo "[entrypoint] warning: unable to copy TLS assets for $APP_USER; frontend may run without TLS" >&2
fi

# Also copy alternative filenames if defaults missing but legacy files exist
if [ "$cert_ok" = false ]; then
    alt_cert="/certs/server.crt"
    alt_key="/certs/server.key"
    if copy_cert "$alt_cert" "$CERT_DEST" && copy_cert "$alt_key" "$KEY_DEST"; then
        export TLS_CERT_FILE="$CERT_DEST"
        export TLS_KEY_FILE="$KEY_DEST"
        cert_ok=true
    fi
fi

exec su-exec "$APP_USER" "$@"
