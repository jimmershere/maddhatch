#!/bin/bash
# 
# System-wide config
sudo tee /etc/msmtprc >/dev/null <<'EOF'
defaults
auth           on
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/msmtp.log

account default
host smtp.gmail.com
port 587
from noreply@yourdomain.com
user noreply@yourdomain.com
passwordeval "cat /etc/msmtp_pass"
EOF

# Store an app password securely
echo "YOUR_APP_SPECIFIC_PASSWORD" | sudo tee /etc/msmtp_pass >/dev/null
sudo chmod 600 /etc/msmtp_pass /etc/msmtprc

