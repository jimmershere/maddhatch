#!/bin/bash
#
#
# 1) Make a per-user config (owned by jimmer)
cat > ~/.msmtprc <<'EOF'
# ~/.msmtprc  (permissions must be 600)
defaults
auth           on
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        ~/.msmtp.log

account default
host smtp.gmail.com
port 587
from trish@maddhatchery.com        # or noreply@yourdomain.com
user YOUR_SMTP_USERNAME            # e.g., full email address
passwordeval "cat ~/.msmtp_pass"   # keep secret in your home dir
EOF

# 2) Store your SMTP app password (or provider API key if they use SMTP)
read -s -p "Enter SMTP password/app password: " PW; echo
printf "%s" "$PW" > ~/.msmtp_pass

# 3) Tighten perms so msmtp will accept the files
chmod 600 ~/.msmtprc ~/.msmtp_pass

# 4) Optional: create an empty log now (msmtp writes to it)
touch ~/.msmtp.log
chmod 600 ~/.msmtp.log

