
# Madd Hatchery Site 0.1

Turnkey scaffold that reuses your HEDI patterns:

- **frontend_go/** — Go 1.22 TLS site + API (`/api/order`) that queues orders to RabbitMQ.
- **rabbitmq/definitions.json** — Exchanges/queues/bindings for orders → receipts/invoices/cashapp/tax.
- **db/schema.sql** — Postgres tables + a `create_invoice(order_id)` function.
- **workers/order_worker.py** — Python 3.12 AMQP consumer that writes orders to DB and fans out work.

## Run (compose example)

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports: ["5672:5672","15672:15672"]
    volumes: ["./rabbitmq/definitions.json:/etc/rabbitmq/definitions.json"]
    environment:
      RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: "-rabbitmq_management load_definitions "/etc/rabbitmq/definitions.json""

  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: maddhatchery
    volumes: ["./db:/docker-entrypoint-initdb.d"]

  frontend:
    build: ./frontend_go
    environment:
      AMQP_URL: amqp://guest:guest@rabbitmq:5672/
      DATABASE_URL: postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable
      RMQ_EXCHANGE: orders.direct
    volumes: ["./config/certs:/certs:ro"]
    ports: ["8443:8443"]
    depends_on: [rabbitmq, db]

  worker:
    image: python:3.12-slim
    working_dir: /app
    environment:
      AMQP_URL: amqp://guest:guest@rabbitmq:5672/
      DATABASE_URL: postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable
      RMQ_EXCHANGE: orders.direct
    volumes: ["./workers:/app"]
    command: ["python","order_worker.py"]
    depends_on: [rabbitmq, db]
```

> TLS certs: mount to `./config/certs/fullchain.pem` and `privkey.pem`. Self-signed works for local.

## OpenLDAP & Roles

Re-use your existing LDAP DIT and groups: `group=admin`, `group=submit`, `group=view`. The Go site
expects SSO to inject an HTTP header `X-User-Groups` (comma-separated) and `X-User-Email` after login.
Wire your existing SSO reverse proxy to perform the LDAP bind and set those headers, then protect `/admin`.

## SSO placeholder

Add your open-source SSO in front (e.g., oauth2-proxy/Keycloak). Configure it to:
- authenticate users against OpenLDAP,
- map LDAP groups → `X-User-Groups`,
- pass through to frontend on success.

## Cash App requests

The `payments.q` receives `cashapp.request` messages. Add a dedicated worker later to call your Cash App
(or manual workflow) and then publish `cashapp.completed` with amounts recorded into `payments`.

## Tax reporting

The `tax.q` consumer should aggregate `invoices` by period and insert rows into `tax_reports`.

## Quadlet

Translate the compose units into `.container` Quadlet files under `/etc/containers/systemd/` as you’ve done before.
This repo keeps it simple for portability.
