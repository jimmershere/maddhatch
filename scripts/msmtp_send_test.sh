#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${MSMTP_CONFIG:-$HOME/.msmtprc}"
PASSWORD_FILE="${MSMTP_PASSWORD_FILE:-$HOME/.msmtp_pass}"
ACCOUNT="${MSMTP_ACCOUNT:-default}"
RECIPIENT="${1:-${SMTP_TEST_RECIPIENT:-${SMTP_USER:-}}}"
SENDER="${SMTP_FROM:-${SMTP_USER:-}}"

if [[ -z "${RECIPIENT}" ]]; then
  echo "Usage: $0 <recipient-email>" >&2
  echo "Either pass a recipient on the command line or export SMTP_TEST_RECIPIENT." >&2
  exit 64
fi

if [[ -z "${SENDER}" ]]; then
  echo "SMTP_FROM or SMTP_USER must be set so the test message has a From header." >&2
  exit 65
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "msmtp config not found at ${CONFIG_FILE}." >&2
  exit 66
fi

if [[ ! -r "${PASSWORD_FILE}" ]]; then
  echo "Password file ${PASSWORD_FILE} is not readable." >&2
  exit 67
fi

if ! command -v msmtp >/dev/null 2>&1; then
  echo "msmtp is not installed or not on PATH." >&2
  exit 68
fi

PASSWORD_CONTENTS=$(cat "${PASSWORD_FILE}")

cat <<INFO
[info] Using msmtp config : ${CONFIG_FILE}
[info] Using password file: ${PASSWORD_FILE}
[info] Password contents : ${PASSWORD_CONTENTS}
INFO

PASSWORD_EVAL_LINE=$(grep -E "^\s*passwordeval" "${CONFIG_FILE}" || true)
if [[ -n "${PASSWORD_EVAL_LINE}" ]]; then
  echo "[info] passwordeval line : ${PASSWORD_EVAL_LINE}"
  if [[ "${PASSWORD_EVAL_LINE}" == *"#"* ]]; then
    echo "[warn] Inline comments confuse passwordeval; keep the command on its own line." >&2
  fi
fi

echo "[info] msmtp version:" && msmtp --version | sed 's/^/  /'

printf 'Subject: %s\nFrom: %s\nTo: %s\n\n%s\n' \
  "Madd Hatchery SMTP test" \
  "${SENDER}" \
  "${RECIPIENT}" \
  "This is a diagnostic message from scripts/msmtp_send_test.sh." \
  | MSMTP_CONFIG="${CONFIG_FILE}" msmtp -a "${ACCOUNT}" -v "${RECIPIENT}"
