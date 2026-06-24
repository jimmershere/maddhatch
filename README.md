# Madd Hatchery — maddhatchery.com

Trish's urban-farm shop: small-batch jams & jellies, farm-fresh eggs, baby
chicks, tees, and handmade goods. A small **Node + Express** app with a
built-in **SQLite** catalog and **Stripe Checkout** for real payments.

> **v3 rebuild.** Clean, modern, country-girl-but-sleek redesign replacing the
> earlier static/Go experiments. One unified design system, a working basket,
> and a one-button deploy that mirrors how `portwright.io` ships.

## Stack

- **Node ≥ 22** (uses the built-in `node:sqlite`) + **Express 4**
- **Stripe Checkout** (hosted) — inline `price_data`, flat-rate shipping for
  shippable items, farm pickup for the rest
- Static front-end in `public/` (vanilla JS, no build step). Shared
  header / footer / cart drawer are injected by `public/assets/js/site.js`, so
  navigation can never drift between pages again.

## Layout

```
server.js              Express app: API, Stripe Checkout + webhook, admin
db.js                  SQLite schema + seed catalog (run directly to (re)seed)
public/                everything served statically
  index shop jams merch tees farm art find-us
  checkout-success / checkout-cancel
  assets/css/site.css  design system
  assets/js/site.js    shared chrome (header/nav/footer/cart drawer)
  assets/js/commerce.js cart, shop grid, Stripe checkout
  assets/v3, assets/img  optimized imagery (jars, Trish, farm, merch, tees)
scripts/start.sh       runtime launcher (loads secrets → node server.js)
scripts/deploy-restart.sh  on-droplet: npm ci + restart + health check
.github/workflows/publish.yml  CI: validate on push/PR, deploy on manual run
```

## Run locally

```bash
npm install
node db.js                 # seed the catalog (prints the product list)
PORT=3200 node server.js   # http://localhost:3200
```

Without Stripe keys the storefront works fully except the final pay step
(checkout returns a friendly "email us to order" message). To exercise real
checkout locally, load secrets first:

```bash
set -a; source ~/.openclaw/secrets/stripe.env; set +a
SITE_URL=http://localhost:3200 node server.js
```

`GET /healthz` reports `{ stripe, products }`. Inventory admin lives at
`/admin?token=YOUR_ADMIN_TOKEN`.

## Configuration (env)

See `.env.example`. On the droplet these live **outside the repo** in
`~/.openclaw/secrets/stripe.env` (loaded by `scripts/start.sh`):

| Var | Purpose |
|-----|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key (live = real charges) |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/stripe/webhook` events |
| `ADMIN_TOKEN` | Guards `/admin` |
| `SITE_URL` | Public URL for Stripe return links + product images |
| `SHIP_FLAT_CENTS` | Flat shipping rate (default 800 = $8) |
| `PORT` | Service port (default 3200; nginx proxies to it) |

### Stripe webhook

Point a Stripe webhook at `https://maddhatchery.com/api/stripe/webhook` for the
`checkout.session.completed` event and set `STRIPE_WEBHOOK_SECRET`. On payment
the server records the order, decrements inventory, and the success page shows
the confirmation. (The success page also finalizes as a fallback if the webhook
is delayed.)

## Deploy (GitHub Actions → DigitalOcean)

Same shape as `portwright.io`: every push/PR runs **validate**; **deploy** is a
manual gate (Actions → *Publish maddhatchery.com* → *Run workflow*, from
`main`). It rsyncs the app to the droplet, runs `npm ci --omit=dev`, and
restarts the service via `scripts/deploy-restart.sh` (systemd if a
`maddhatchery.service` unit exists, otherwise a port restart), then health-checks.

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Example |
|--------|---------|
| `MADDHATCHERY_HOST` | droplet IP / hostname |
| `MADDHATCHERY_USER` | ssh user (default `deploy`) |
| `MADDHATCHERY_PATH` | app dir, e.g. `/var/www/maddhatchery` |
| `MADDHATCHERY_SSH_KEY` | private deploy key (PEM) |
| `MADDHATCHERY_KNOWN_HOSTS` | *(optional)* pinned known_hosts |

The deploy step self-skips if `HOST`/`SSH_KEY` are absent, so the workflow is
safe to merge before secrets exist. The droplet still needs Node ≥ 22, an nginx
reverse proxy to `PORT`, and the secrets file in place.

### Optional systemd unit (recommended on the droplet)

```ini
# /etc/systemd/system/maddhatchery.service
[Unit]
Description=Madd Hatchery
After=network.target
[Service]
WorkingDirectory=/var/www/maddhatchery
ExecStart=/usr/bin/env bash scripts/start.sh
Restart=always
User=deploy
[Install]
WantedBy=multi-user.target
```
