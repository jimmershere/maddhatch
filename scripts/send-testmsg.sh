#!/bin/bash
#
#send test email
export MSMTP_CONFIG="$HOME/.msmtprc"

printf "Subject: msmtp OK test\nFrom: trish@maddhatchery.com\nTo: jimmershere@gmail.com\n\nHowdy from msmtp.\n" \
  | msmtp -a default jimmershere@gmail.com

tail -n 50 "$HOME/.msmtp.log"

