# SMTP relay container

This directory provides a lightweight SMTP submission container that accepts mail
on port `1025` and relays it through an upstream provider using `msmtpd` and
`msmtp`.

## Configuration

The container is driven by environment variables and is wired into `compose.yaml`
as the `smtp` service. The most important settings are:

| Variable | Default | Description |
| --- | --- | --- |
| `SMTP_RELAY_HOST` | _(required)_ | Hostname of the upstream SMTP relay. |
| `SMTP_RELAY_PORT` | `587` | Port for the relay. Use `465` for implicit TLS providers. |
| `SMTP_RELAY_USER` | _(empty)_ | Username for authentication. Leave empty for anonymous relays. |
| `SMTP_RELAY_PASSWORD` | _(empty)_ | Password for the relay user. |
| `SMTP_FROM` | `alerts@maddhatchery.com` | Default sender address advertised to the relay. |
| `SMTP_ACCOUNT` | `default` | Name of the generated `msmtp` account. |
| `SMTP_DOMAIN` | `smtp.maddhatchery.com` | Advertised EHLO/HELO hostname for `msmtpd`. |
| `SMTP_TLS` | `on` | Toggle TLS encryption when talking to the relay. Set to `off` for plain text relays. |
| `SMTP_STARTTLS` | `on` | Controls the `STARTTLS` command. Set to `off` when using port `465`. |
| `SMTP_TLS_CERTCHECK` | `on` | Disable (`off`) only when the relay uses self-signed certificates. |
| `SMTP_TLS_TRUST_FILE` | _(empty)_ | Optional CA bundle path mounted into the container. |
| `SMTP_TLS_FINGERPRINT` | _(empty)_ | Optional certificate fingerprint pinning. |
| `SMTP_LISTEN_HOST` | `0.0.0.0` | Listening interface inside the container. |
| `SMTP_LISTEN_PORT` | `1025` | Listening port exposed to other services. |

The generated configuration and password file are written to `/etc/msmtp`. In
`compose.yaml` this path is backed by `./smtp/config` so the same credentials can
be reused locally. You can point `scripts/msmtp_send_test.sh` at these files by
leaving `MSMTP_CONFIG` and `MSMTP_PASSWORD_FILE` unset.

## Example usage

1. Populate `.env` with relay details, for example:

   ```dotenv
   SMTP_RELAY_HOST=smtp.sendgrid.net
   SMTP_RELAY_PORT=587
   SMTP_RELAY_USER=apikey
   SMTP_RELAY_PASSWORD=your-api-key
   SMTP_FROM=alerts@maddhatchery.com
   ```

2. Start the service:

   ```bash
   docker compose up smtp
   ```

3. Send a test message:

   ```bash
   ./scripts/msmtp_send_test.sh recipient@example.com
   ```

All Madd Hatchery services can now deliver confirmation emails by aiming at
`smtp:1025` (inside the Compose network) or `localhost:1025` on the host.
