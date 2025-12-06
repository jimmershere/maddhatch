#!/bin/bash
#
# Show what msmtp will read for the password (should print your secret exactly)
export HOME="/home/jimmer"
export MSMTP_CONFIG="$HOME/.msmtprc"

printf "Subject: msmtp OK test\nFrom: trish@maddhatchery.com\nTo: jimmershere@gmail.com\n\nHowdy from msmtp.\n" \
  | msmtp -a default -v jimmershere@gmail.com

tail -n 50 "$HOME/.msmtp.log" 2>/dev/null || echo "No per-user msmtp log yet."

