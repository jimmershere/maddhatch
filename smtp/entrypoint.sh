#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${MSMTP_CONFIG_DIR:-/etc/msmtp}"
CONFIG_FILE="${MSMTP_CONFIG:-${CONFIG_DIR}/msmtprc}"
PASSWORD_FILE="${MSMTP_PASSWORD_FILE:-${CONFIG_DIR}/.msmtp_pass}"
LISTEN_HOST="${SMTP_LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${SMTP_LISTEN_PORT:-1025}"
ACCOUNT_NAME="${SMTP_ACCOUNT:-default}"
DOMAIN_NAME="${SMTP_DOMAIN:-smtp.maddhatchery.com}"
RELAY_HOST="${SMTP_RELAY_HOST:-}"
RELAY_PORT="${SMTP_RELAY_PORT:-587}"
RELAY_USER="${SMTP_RELAY_USER:-}"
RELAY_PASSWORD="${SMTP_RELAY_PASSWORD:-}"
SMTP_FROM="${SMTP_FROM:-alerts@maddhatchery.com}"
TLS_MODE="${SMTP_TLS:-on}"
STARTTLS_MODE="${SMTP_STARTTLS:-on}"
TLS_CERTCHECK="${SMTP_TLS_CERTCHECK:-on}"
TLS_TRUST_FILE="${SMTP_TLS_TRUST_FILE:-}"
TLS_FINGERPRINT="${SMTP_TLS_FINGERPRINT:-}"

if [[ -z "${RELAY_HOST}" ]]; then
  echo "[error] SMTP_RELAY_HOST must be provided" >&2
  exit 78
fi

mkdir -p "${CONFIG_DIR}"
touch /var/log/msmtp.log
chmod 600 /var/log/msmtp.log

if [[ -n "${RELAY_PASSWORD}" ]]; then
  printf '%s' "${RELAY_PASSWORD}" > "${PASSWORD_FILE}"
  chmod 600 "${PASSWORD_FILE}"
else
  rm -f "${PASSWORD_FILE}"
fi

auth_mode="off"
if [[ -n "${RELAY_USER}" ]]; then
  auth_mode="on"
fi

{
  echo "defaults"
  echo "auth ${auth_mode}"
  echo "tls ${TLS_MODE}"
  echo "tls_starttls ${STARTTLS_MODE}"
  echo "tls_certcheck ${TLS_CERTCHECK}"
  if [[ -n "${TLS_TRUST_FILE}" ]]; then
    echo "tls_trust_file ${TLS_TRUST_FILE}"
  fi
  if [[ -n "${TLS_FINGERPRINT}" ]]; then
    echo "tls_fingerprint ${TLS_FINGERPRINT}"
  fi
  echo "syslog off"
  echo "logfile /var/log/msmtp.log"
  echo
  echo "account ${ACCOUNT_NAME}"
  echo "host ${RELAY_HOST}"
  echo "port ${RELAY_PORT}"
  echo "from ${SMTP_FROM}"
  if [[ -n "${RELAY_USER}" ]]; then
    echo "user ${RELAY_USER}"
  fi
  if [[ -n "${RELAY_PASSWORD}" ]]; then
    echo "passwordeval cat ${PASSWORD_FILE}"
  fi
  echo "account default : ${ACCOUNT_NAME}"
} > "${CONFIG_FILE}"

chmod 600 "${CONFIG_FILE}"

echo "[info] msmtp configuration written to ${CONFIG_FILE}" >&2
if [[ -n "${RELAY_USER}" ]]; then
  echo "[info] authenticating as ${RELAY_USER}" >&2
else
  echo "[info] authentication disabled" >&2
fi

echo "[info] relaying mail via ${RELAY_HOST}:${RELAY_PORT}" >&2

echo "[info] starting msmtpd on ${LISTEN_HOST}:${LISTEN_PORT} (EHLO ${DOMAIN_NAME})" >&2
export MSMTP_CONFIG="${CONFIG_FILE}"
if [[ -f "${PASSWORD_FILE}" ]]; then
  export MSMTP_PASSWORD_FILE="${PASSWORD_FILE}"
else
  unset MSMTP_PASSWORD_FILE || true
fi

exec msmtpd --host "${LISTEN_HOST}" --port "${LISTEN_PORT}" --domain "${DOMAIN_NAME}" --log=stdout --command="/usr/bin/msmtp -t"
