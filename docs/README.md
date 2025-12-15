# Madd Hatchery Platform

Modernized starter stack that layers OAuth2/OIDC sign-on, LDAP-backed RBAC, and Trish’s support experience on top of the original HEDI order flow.

- **frontend_go/** — Go 1.22 TLS site that serves the portal/admin UI, proxies `/oauth2/*` to an oauth2-proxy compatible service, and calls the FastAPI identity service for RBAC operations.
- **api/** — FastAPI 0.111 identity + admin API. Manages `app_users`, support tickets, auth provider toggles, and bootstraps the LDAP directory and administrator account.
- **rbac/** — Lightweight RBAC/login experience that emulates the oauth2-proxy contract. Presents a login form, validates credentials via the FastAPI API, and issues HMAC-signed session cookies.
- **db/schema.sql** — Adds `app_users`, `support_tickets`, and `maddh_auth_providers` tables alongside the existing order/invoice schema.
- **workers/** — Python 3.12 AMQP workers from the original release (orders → receipts/invoices/cashapp/tax).

## Run (docker compose)

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports: ["5672:5672","15672:15672"]
    volumes: ["./rabbitmq/definitions.json:/etc/rabbitmq/definitions.json"]

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: maddhatchery
    volumes: ["./db:/docker-entrypoint-initdb.d"]

  ldap:
    image: osixia/openldap:1.5.0
    env_file: .env
    ports: ["${LDAP_HOST_PORT:-1389}:389"]
    volumes:
      - ldap_data:/var/lib/ldap
      - ldap_config:/etc/ldap/slapd.d
      - ./config/certs:/container/service/slapd/assets/certs:rw

  api:
    build: ./api
    env_file: .env
    volumes: ["./config/certs:/certs:ro"]
    depends_on: [db, ldap]

  rbac:
    build: ./rbac
    env_file: .env
    ports: ["4180:4180"]
    depends_on: [api]

    frontend:
      build: ./frontend_go
      env_file: .env
      ports: ["8443:8443"]
      volumes: ["./config/certs:/certs:ro"]
      depends_on: [rabbitmq, db, api, rbac]

  worker:
    image: python:3.12-slim
    working_dir: /app
    environment:
      AMQP_URL: ${AMQP_URL}
      DATABASE_URL: ${DATABASE_URL}
      RMQ_EXCHANGE: ${RMQ_EXCHANGE}
    volumes: ["./workers:/app"]
    command: ["/bin/sh","-c","pip install -r requirements.txt && python order_worker.py"]
    depends_on: [rabbitmq, db]
```

`.env` drives the wiring:

> **LDAP host port:** Rootless Podman/Docker cannot bind privileged ports (<1024), so the compose file defaults `LDAP_HOST_PORT` to `1389`. If you are running as root (or have raised `net.ipv4.ip_unprivileged_port_start`), set `LDAP_HOST_PORT=389` in `.env` to expose the directory on the standard port.

```ini
DATABASE_URL=postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable
MADDH_SHARED_SECRET=super-secret-token
MADDH_API_URL=http://api:8000
MADDH_OAUTH2_PROXY_URL=http://rbac:4180/oauth2
MADDH_OAUTH2_PROXY_INSECURE_SKIP_VERIFY=false
MADDH_OAUTH2_START=/oauth2/start
RBAC_SESSION_SECRET=rbac-session-secret
# Expose LDAP on a high, non-privileged host port by default; switch to 389 if
# you're running with elevated privileges and want the standard port on the host.
LDAP_HOST_PORT=1389

# SMTP configuration (aliases SMTP_SERVER/SMTP_USERNAME/SMTP_PASSWORD also work)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@maddhatchery.com
SMTP_PASSWORD=app-specific-password
SMTP_FROM=Trish <alerts@maddhatchery.com>
```

The API now recognizes the more common `SMTP_SERVER`, `SMTP_USERNAME`, and `SMTP_PASSWORD`
environment variables alongside the existing `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`
names. Provide whichever variant matches your infrastructure so registration emails
deliver successfully.

### Troubleshooting SMTP delivery with msmtp

The repository ships with `scripts/msmtp_send_test.sh` to validate your local `msmtp`
configuration. The helper mirrors the manual diagnostic steps Trish documented:

```bash
export SMTP_FROM="Trish <alerts@maddhatchery.com>"
export SMTP_TEST_RECIPIENT=jimmershere@gmail.com
scripts/msmtp_send_test.sh
```

The script prints the password read from `~/.msmtp_pass`, surfaces the active
`passwordeval` line from `~/.msmtprc`, and then sends a verbose test message via
`msmtp`. If `msmtp` reports `cat … not found`, make sure the `passwordeval` line in
`~/.msmtprc` does **not** include inline comments—put the command on its own line so
`msmtp` can execute it verbatim. When the new `smtp` container is running the
generated configuration lives in `./smtp/config`; the helper automatically falls
back to those files when `MSMTP_CONFIG` and `MSMTP_PASSWORD_FILE` are unset.

### Local SMTP relay container

`compose.yaml` now includes an `smtp` service that exposes `msmtpd` on
`localhost:1025` and relays outbound mail through your upstream provider (for
example SendGrid or SES). Populate the usual SMTP environment variables in
`.env`, start the service with `docker compose up smtp`, and point the API/worker
stack at `smtp.maddhatchery.com:1025` (inside Compose) or `localhost:1025` (on the
host). The generated `msmtp` configuration is stored under `./smtp/config` so you
can re-use the same credentials locally when running `scripts/msmtp_send_test.sh`.
Override `SMTP_DOMAIN` if your relay expects a different EHLO hostname.

Set `MADDH_OAUTH2_PROXY_URL` to the public oauth2-proxy endpoint (Keycloak, Okta, etc.). If the frontend reaches it via an internal host, also set `MADDH_OAUTH2_PROXY_INTERNAL_URL`. The Go service proxies `/oauth2/*` there and exposes the configured login start path via `/config.js`.

The FastAPI service gates `/auth/login`, `/admin/users`, `/admin/tickets`, and `/admin/auth/providers` behind `X-Maddh-Shared-Secret`, so keep `MADDH_SHARED_SECRET` aligned across `frontend_go`, `api`, and `rbac`.

### OpenLDAP quick reference

| Item | Value |
|------|-------|
| Base DN | `dc=example,dc=com` |
| Admin bind | `cn=admin,dc=example,dc=com` (password `3wm078uu` by default) |
| User branch | `ou=users,dc=example,dc=com` |
| Role branch | `ou=roles,dc=example,dc=com` (`cn=view|submit|admin` groups) |
| Bootstrap user | `uid=admin,ou=users,dc=example,dc=com` |
| Persistent volumes | `ldap_data`, `ldap_config` |
| TLS | Re-uses `./config/certs/fullchain.pem` & `privkey.pem` (override via `MADDH_LDAP_TLS_*` envs) |

`api/app/main.py` seeds the directory on startup (users OU, roles OU, admin user, role groups) and mirrors LDAP-authenticated users into `app_users`. Rotate credentials by overriding `MADDH_BOOTSTRAP_ADMIN_USER`, `MADDH_BOOTSTRAP_ADMIN_HASH`, and `MADDH_LDAP_BOOTSTRAP_PASSWORD` before first run.

Set `MADDH_LDAP_ENABLED=false` in `.env` if you want to skip the directory bootstrap and rely solely on local `app_users` accounts.

### RBAC & Trish assistant

- `rbac/` issues HMAC-signed cookies (`RBAC_SESSION_SECRET`) that the Go frontend validates. Session data drives client-side authorization (`data-requires-role` attributes) and is surfaced to `/oauth2/userinfo` for the UI.
- Trish’s floating chat widget lives in `frontend_go/public/static/js/trish.js`. It detects phrases like “error” or “trouble,” prompts for severity (1–4), stores tickets in localStorage under **Madd Hatchery Support Tickets**, and posts each ticket to the FastAPI API for admins to triage.
- `frontend_go/public/static/js/support_config.js` centralizes support contact details (email, SMS, phone) so every page and the chat widget stay consistent.

### Legacy workers & reports

The original AMQP workers continue to process orders, generate invoices, and emit cash/tax events. Extend them as needed for your downstream tooling.

> TLS certs: mount to `./config/certs/fullchain.pem` and `privkey.pem`. The same bundle is mapped into the LDAP container, and the frontend serves HTTPS on `https://localhost:8443` by default. If those files are missing or the bundle lacks Subject Alternative Names, the frontend now auto-generates a self-signed certificate (configurable via `TLS_CERT_HOSTS`, `TLS_RUNTIME_CERT_DIR`, and `TLS_AUTO_SELF_SIGNED`).

