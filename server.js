'use strict';
/* Madd Hatchery — Express storefront with Stripe Checkout. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3200);
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SHIP_FLAT_CENTS = Number(process.env.SHIP_FLAT_CENTS || 800);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'maddhatchery@gmail.com';
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;
const httpsImages = SITE_URL.startsWith('https://');

const money = (c) => `$${(c / 100).toFixed(2)}`;
const absUrl = (rel) => (rel && rel.startsWith('/') ? SITE_URL + rel : rel);

/* ---- Stripe webhook needs the raw body, so mount it BEFORE json parsing ---- */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(501).json({ ok: false, message: 'Webhook not configured.' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }
  // idempotency: skip if we've already recorded this event id
  const rec = store.recordEvent.run(event.id, event.type);
  if (rec.changes === 0) return res.json({ received: true, duplicate: true });

  if (event.type === 'checkout.session.completed') {
    try { finalizeOrder(event.data.object); } catch (e) { console.error('finalizeOrder failed:', e.message); }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '14mb' })); // base64 design images arrive via the publisher
app.use(express.urlencoded({ extended: false }));

// Retired pages → consolidated storefront (old links keep working)
app.get(['/merch.html', '/merch', '/tees.html', '/tees'], (req, res) => res.redirect(301, '/nickel-ts.html'));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
const UPLOAD_DIR = path.join(__dirname, 'public', 'assets', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- helpers ---------------- */
function publicProduct(p) {
  return {
    id: p.id, slug: p.slug, name: p.name, category: p.category, description: p.description,
    price_cents: p.price_cents, price_display: money(p.price_cents), image_url: p.image_url,
    fulfillment_type: p.fulfillment_type, quantity_available: p.quantity_available,
    in_stock: p.quantity_available > 0,
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({ product_id: Number(i.product_id), quantity: Math.max(0, parseInt(i.quantity, 10) || 0) }))
    .filter((i) => Number.isInteger(i.product_id) && i.product_id > 0 && i.quantity > 0);
}

/* Validate a cart against live inventory; clamp quantities to what's in stock. */
function buildQuote(rawItems) {
  const items = normalizeItems(rawItems);
  if (!items.length) return { ok: false, message: 'Your basket is empty.', lines: [], subtotal_cents: 0 };
  const ids = [...new Set(items.map((i) => i.product_id))];
  const products = store.listActiveByIds.all(JSON.stringify(ids));
  const map = new Map(products.map((p) => [p.id, p]));
  const lines = []; const warnings = [];
  for (const item of items) {
    const p = map.get(item.product_id);
    if (!p) { warnings.push(`Item ${item.product_id} is no longer available.`); continue; }
    const qty = Math.min(item.quantity, Math.max(0, p.quantity_available));
    if (qty <= 0) { warnings.push(`${p.name} is sold out.`); continue; }
    if (qty < item.quantity) warnings.push(`${p.name} limited to ${qty} (current stock).`);
    lines.push({ product: p, quantity: qty, line_total_cents: p.price_cents * qty });
  }
  const subtotal = lines.reduce((a, l) => a + l.line_total_cents, 0);
  return { ok: lines.length > 0, message: lines.length ? null : 'Nothing in stock remains in your basket.', lines, warnings, subtotal_cents: subtotal, subtotal_display: money(subtotal) };
}

function finalizeOrder(session) {
  if (store.orderBySession.get(session.id)) return; // already finalized
  let cart = [];
  try { cart = JSON.parse(session.metadata && session.metadata.cart || '[]'); } catch {}
  const ids = cart.map(([id]) => id);
  const products = ids.length ? store.listActiveByIds.all(JSON.stringify(ids)) : [];
  const map = new Map(products.map((p) => [p.id, p]));
  const summaryParts = [];
  const orderNo = 'MH-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const info = store.insertOrder.run(
    orderNo, session.id,
    (session.customer_details && session.customer_details.name) || '',
    (session.customer_details && session.customer_details.email) || session.customer_email || '',
    'paid', session.amount_total || 0, ''
  );
  const orderId = info.lastInsertRowid;
  for (const [id, qty] of cart) {
    const p = map.get(id); if (!p) continue;
    store.insertOrderItem.run(orderId, p.id, p.name, p.price_cents, qty, p.fulfillment_type);
    store.decrementInventory.run(qty, p.id);
    summaryParts.push(`${qty}× ${p.name} (${p.fulfillment_type})`);
  }
  console.log(`✅ Order ${orderNo} paid: ${summaryParts.join(', ')}`);
}

/* ---------------- API ---------------- */
app.get('/api/products', (req, res) => {
  res.json({ products: store.listActiveProducts.all().map(publicProduct) });
});

app.post('/api/cart/quote', (req, res) => {
  const q = buildQuote(req.body.items);
  res.status(q.ok ? 200 : 400).json({
    ok: q.ok, message: q.message, warnings: q.warnings,
    subtotal_cents: q.subtotal_cents, subtotal_display: q.subtotal_display,
    lines: q.lines.map((l) => ({ ...publicProduct(l.product), quantity: l.quantity, line_total_display: money(l.line_total_cents) })),
  });
});

app.post('/api/checkout/session', async (req, res) => {
  const quote = buildQuote(req.body.items);
  if (!quote.ok) return res.status(400).json({ ok: false, message: quote.message, warnings: quote.warnings });
  if (!stripe) return res.status(501).json({ ok: false, message: 'Payments are not configured on this server yet. Email ' + CONTACT_EMAIL + ' to order.' });

  const line_items = quote.lines.map((l) => ({
    quantity: l.quantity,
    price_data: {
      currency: 'usd',
      unit_amount: l.product.price_cents,
      product_data: {
        name: l.product.name,
        description: (l.product.description || '').slice(0, 280) || undefined,
        ...(httpsImages && l.product.image_url ? { images: [absUrl(l.product.image_url)] } : {}),
      },
    },
  }));
  const hasShip = quote.lines.some((l) => l.product.fulfillment_type === 'ship');
  const cart = quote.lines.map((l) => [l.product.id, l.quantity]);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      customer_creation: 'always',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      ...(hasShip ? {
        shipping_address_collection: { allowed_countries: ['US'] },
        shipping_options: [{
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: SHIP_FLAT_CENTS, currency: 'usd' },
            display_name: 'Flat-rate shipping',
            delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 7 } },
          },
        }],
      } : {}),
      metadata: { cart: JSON.stringify(cart).slice(0, 480), fulfillment: hasShip ? 'ship' : 'pickup' },
      success_url: `${SITE_URL}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout-cancel.html`,
    });
    res.json({ ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe session error:', err.message);
    res.status(502).json({ ok: false, message: 'Could not start checkout. Please try again.' });
  }
});

/* Order summary for the success page (reads our DB; falls back to Stripe). */
app.get('/api/checkout/status', async (req, res) => {
  const sid = String(req.query.session_id || '');
  if (!sid) return res.status(400).json({ ok: false });
  let order = store.orderBySession.get(sid);
  // Webhook may not have landed yet — finalize from the live session as a fallback.
  if (!order && stripe) {
    try {
      const s = await stripe.checkout.sessions.retrieve(sid);
      if (s && s.payment_status === 'paid') { finalizeOrder(s); order = store.orderBySession.get(sid); }
    } catch {}
  }
  if (!order) return res.json({ ok: true, status: 'pending' });
  res.json({ ok: true, status: order.status, order_number: order.order_number, total_display: money(order.amount_total_cents), email: order.customer_email });
});

/* ---------------- admin (token-guarded) ---------------- */
function adminOK(req) {
  if (!ADMIN_TOKEN) return false;
  const t = req.get('x-admin-token') || req.query.token || (req.body && req.body.token);
  return t && crypto.timingSafeEqual(Buffer.from(String(t)), Buffer.from(ADMIN_TOKEN)) ;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

app.get('/admin', (req, res) => {
  if (!adminOK(req)) return res.status(401).type('html').send('<p style="font-family:sans-serif;padding:2rem">Unauthorized. Append <code>?token=YOUR_ADMIN_TOKEN</code>.</p>');
  const rows = store.listProducts.all().map((p) => `
    <tr>
      <td><strong>${esc(p.name)}</strong><br><small>${esc(p.slug)} · ${esc(p.category)}</small></td>
      <td>${money(p.price_cents)}</td>
      <td>${esc(p.fulfillment_type)}</td>
      <td>
        <form method="post" action="/admin/products/${p.id}" style="display:flex;gap:.4rem;align-items:center">
          <input type="hidden" name="token" value="${esc(req.query.token || '')}">
          <input type="number" name="quantity_available" value="${p.quantity_available}" min="0" style="width:80px;padding:.4rem">
          <label style="font-size:.85rem"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''}> active</label>
          <button>Save</button>
        </form>
      </td>
    </tr>`).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Madd Hatchery · Admin</title>
    <style>body{font-family:system-ui,sans-serif;background:#fbf6ec;color:#2c2622;margin:0;padding:2rem}
    .wrap{max-width:900px;margin:auto}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.06)}
    td,th{padding:.8rem;border-bottom:1px solid #eee2d4;text-align:left}th{background:#f3ead8;text-transform:uppercase;font-size:.8rem}
    button{background:#e0922f;color:#fff;border:0;border-radius:8px;padding:.5rem .8rem;cursor:pointer}</style>
    <div class="wrap"><h1>🧺 Inventory Admin</h1><p>Set stock and active state.</p>
    <table><thead><tr><th>Product</th><th>Price</th><th>Fulfillment</th><th>Stock / Active</th></tr></thead><tbody>${rows}</tbody></table></div>`);
});

app.post('/admin/products/:id', (req, res) => {
  if (!adminOK(req)) return res.status(401).send('Unauthorized');
  const id = Number(req.params.id);
  store.setActive.run(req.body.active ? 1 : 0, id);
  store.setInventory.run(id, Math.max(0, parseInt(req.body.quantity_available, 10) || 0));
  res.redirect('/admin?token=' + encodeURIComponent(req.body.token || ''));
});

/* ---------------- publish API (token-guarded) — tee-empire "site" port ---------------- */
const ALLOWED_CATEGORIES = new Set(['nickel-tee', 'madd-tee', 'mug', 'sticker']);
const EXT_OK = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' };

// Upsert a product from tee-empire. Image arrives as base64 (image_base64 + image_ext) or a ready image_url.
app.post('/api/admin/product', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  const b = req.body || {};
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || !b.name) return res.status(400).json({ ok: false, message: 'slug and name are required' });
  const category = ALLOWED_CATEGORIES.has(b.category) ? b.category : 'nickel-tee';

  let image_url = b.image_url || '';
  if (b.image_base64) {
    const ext = EXT_OK[String(b.image_ext || 'png').toLowerCase()] || 'png';
    try {
      const data = String(b.image_base64).replace(/^data:image\/[a-z+]+;base64,/, '');
      fs.writeFileSync(path.join(UPLOAD_DIR, `${slug}.${ext}`), Buffer.from(data, 'base64'));
      image_url = `/assets/uploads/${slug}.${ext}`;
    } catch (e) { return res.status(400).json({ ok: false, message: 'bad image_base64: ' + e.message }); }
  }
  const row = store.publishProduct({
    slug, name: b.name, category, description: b.description || '',
    price_cents: b.price_cents, image_url,
    fulfillment_type: 'ship', sort: b.sort, quantity: b.quantity != null ? b.quantity : 25,
  });
  console.log(`📦 published product: [${category}] ${row.name} ($${(row.price_cents/100).toFixed(2)})`);
  res.json({ ok: true, product: { ...row, url: `${SITE_URL}/nickel-ts.html#${category}` } });
});

// Retire (hide) a product by slug.
app.post('/api/admin/retire', (req, res) => {
  if (!adminOK(req)) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  const slug = String((req.body || {}).slug || '').trim();
  if (!slug) return res.status(400).json({ ok: false, message: 'slug required' });
  const r = store.retireBySlug.run(slug);
  res.json({ ok: true, retired: r.changes });
});

app.get('/healthz', (req, res) => res.json({ ok: true, stripe: Boolean(stripe), products: store.listActiveProducts.all().length }));

app.listen(PORT, () => {
  console.log(`🐓 Madd Hatchery on http://localhost:${PORT}  (stripe: ${stripe ? 'live' : 'OFF'}, site: ${SITE_URL})`);
});
