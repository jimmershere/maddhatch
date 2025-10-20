#!/usr/bin/env bash
set -euo pipefail

HOME="/home/jimmer"
export SMTP_FROM="Trish <alerts@maddhatchery.com>"
export SMTP_TEST_RECIPIENT=jimmershere@gmail.com
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

ACCOUNT_HOST=$(awk -v acct="${ACCOUNT}" '
  BEGIN {
    inblock = 0;
    found = 0;
    host = "";
  }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*defaults([[:space:]]+|$)/ { inblock = 0; next }
  {
    if (match($0, /^[[:space:]]*account[[:space:]]+([^[:space:]]+)/, m)) {
      inblock = (m[1] == acct);
      if (inblock) {
        found = 1;
      }
      next;
    }

    if (inblock && host == "" && match($0, /^[[:space:]]*host[[:space:]]+([^[:space:]]+)/, m)) {
      host = m[1];
    }
  }
  END {
    if (!found) {
      print "NOACCOUNT";
    } else if (host == "") {
      print "NOHOST";
    } else {
      print host;
    }
  }
' "${CONFIG_FILE}")

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

echo "[info] msmtp version:" && msmtp --version | sed 's/^/  /'

printf 'Subject: %s\nFrom: %s\nTo: %s\n\n%s\n' \
  "Madd Hatchery SMTP test" \
  "${SENDER}" \
  "${RECIPIENT}" \
  "This is a diagnostic message from scripts/msmtp_send_test.sh." \
  | MSMTP_CONFIG="${CONFIG_FILE}" msmtp -a "${ACCOUNT}" -v "${RECIPIENT}"
