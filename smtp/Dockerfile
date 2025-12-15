FROM alpine:3.20

RUN apk add --no-cache bash ca-certificates msmtp msmtp-mta

ENV MSMTP_CONFIG_DIR=/etc/msmtp \
    MSMTP_CONFIG=/etc/msmtp/msmtprc \
    MSMTP_PASSWORD_FILE=/etc/msmtp/.msmtp_pass

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 1025

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
