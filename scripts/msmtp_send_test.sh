#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_CONFIG_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)/smtp/config

HOME="/home/jimmer"
export SMTP_FROM="Trish <alerts@maddhatchery.com>"
export SMTP_TEST_RECIPIENT=jimmershere@gmail.com

CONFIG_FILE="${MSMTP_CONFIG:-$HOME/.msmtprc}"
PASSWORD_FILE="${MSMTP_PASSWORD_FILE:-$HOME/.msmtp_pass}"

if [[ -z "${MSMTP_CONFIG:-}" && -f "${REPO_CONFIG_DIR}/msmtprc" ]]; then
  CONFIG_FILE="${REPO_CONFIG_DIR}/msmtprc"
fi

if [[ -z "${MSMTP_PASSWORD_FILE:-}" && -f "${REPO_CONFIG_DIR}/.msmtp_pass" ]]; then
  PASSWORD_FILE="${REPO_CONFIG_DIR}/.msmtp_pass"
fi
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

PASSWORD_DIRECTIVE=$(grep -E "^\s*password(eval)?\b" "${CONFIG_FILE}" || true)
PASSWORD_REQUIRED=false
if [[ -n "${PASSWORD_DIRECTIVE}" ]]; then
  PASSWORD_REQUIRED=true
fi

if [[ "${PASSWORD_REQUIRED}" == true && ! -r "${PASSWORD_FILE}" ]]; then
  echo "Password file ${PASSWORD_FILE} is not readable." >&2
  exit 67
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse ${CONFIG_FILE}." >&2
  exit 71
fi

ACCOUNT_HOST=$(python3 - "$ACCOUNT" "$CONFIG_FILE" <<'PY'
import re
import sys

acct = sys.argv[1]
config_path = sys.argv[2]

found = False
host = None
in_block = False

def strip_inline_comment(line: str) -> str:
    hash_index = line.find('#')
    if hash_index == -1:
        return line
    return line[:hash_index]

with open(config_path, encoding="utf-8") as handle:
    for raw_line in handle:
        line = strip_inline_comment(raw_line).strip()
        if not line:
            continue

        if line.lower().startswith("defaults"):
            in_block = False
            continue

        account_match = re.match(r"account\s+(\S+)", line, flags=re.IGNORECASE)
        if account_match:
            in_block = account_match.group(1) == acct
            if in_block:
                found = True
            continue

        if not in_block or host is not None:
            continue

        host_match = re.match(r"host\s+(\S+)", line, flags=re.IGNORECASE)
        if host_match:
            host = host_match.group(1)

if not found:
    print("NOACCOUNT")
elif host is None:
    print("NOHOST")
else:
    print(host)
PY
)

case "${ACCOUNT_HOST}" in
  NOACCOUNT)
    echo "Account '${ACCOUNT}' not found in ${CONFIG_FILE}." >&2
    echo "Check for a missing 'account ${ACCOUNT}' line or unintended comments." >&2
    exit 69
    ;;
  NOHOST)
    echo "Account '${ACCOUNT}' in ${CONFIG_FILE} does not define a host." >&2
    echo "Ensure the 'account ${ACCOUNT}' block contains a 'host <smtp-host>' directive." >&2
    exit 70
    ;;
esac

if [[ "${PASSWORD_REQUIRED}" == true ]]; then
  PASSWORD_CONTENTS=$(cat "${PASSWORD_FILE}")
else
  PASSWORD_CONTENTS="<not required>"
fi

PASSWORD_FILE_DISPLAY="${PASSWORD_FILE}"
if [[ "${PASSWORD_REQUIRED}" == false && ! -e "${PASSWORD_FILE}" ]]; then
  PASSWORD_FILE_DISPLAY="<none>"
fi

cat <<INFO
[info] Using msmtp config : ${CONFIG_FILE}
[info] Using password file: ${PASSWORD_FILE_DISPLAY}
[info] Password contents : ${PASSWORD_CONTENTS}
INFO

cat <<INFO
[info] Using account      : ${ACCOUNT}
[info] SMTP host detected : ${ACCOUNT_HOST}
INFO

PASSWORD_EVAL_LINE=$(grep -E "^\s*passwordeval" "${CONFIG_FILE}" || true)
if [[ -n "${PASSWORD_EVAL_LINE}" ]]; then
  echo "[info] passwordeval line : ${PASSWORD_EVAL_LINE}"
  if [[ "${PASSWORD_EVAL_LINE}" == *"#"* ]]; then
    echo "[warn] Inline comments confuse passwordeval; keep the command on its own line." >&2
  fi
fi

if ! command -v msmtp >/dev/null 2>&1; then
  echo "msmtp is not installed or not on PATH." >&2
  exit 68
fi

echo "[info] msmtp version:" && msmtp --version | sed 's/^/  /'

printf 'Subject: %s\nFrom: %s\nTo: %s\n\n%s\n' \
  "Madd Hatchery SMTP test" \
  "${SENDER}" \
  "${RECIPIENT}" \
  "This is a diagnostic message from scripts/msmtp_send_test.sh." \
  | MSMTP_CONFIG="${CONFIG_FILE}" msmtp -a "${ACCOUNT}" -v "${RECIPIENT}"
