#!/usr/bin/env node
'use strict';
/* replay-printify-order.js — re-create the Printify draft for an already-paid order.
 *
 *   node --experimental-sqlite scripts/replay-printify-order.js MH-XXXX-XXXX
 *   node --experimental-sqlite scripts/replay-printify-order.js MH-XXXX-XXXX --apply
 *
 * Dry run by default. Run it ON the droplet, where the live DB and the secrets are.
 *
 * Why this exists: a paid order whose draft failed is money taken with nothing queued
 * to ship, and there is no way to re-drive it from Stripe — finalizeOrder() is guarded
 * by the stripe_events idempotency table, so resending the webhook is a no-op, and
 * clearing that row would re-insert the order and double-decrement stock.
 *
 * The cart is read from the Stripe session's `metadata.cart`, which finalizeOrder wrote
 * as [[product_id, printify_variant_id, quantity], …]. That is authoritative;
 * order_items does not store the variant id, only a display name with the colour and
 * size appended, which would have to be parsed back out.
 */
const store = require('../db');

const ORDER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!ORDER || ORDER.startsWith('--')) {
  console.error('usage: replay-printify-order.js <ORDER_NUMBER> [--apply]');
  process.exit(2);
}

const KEY = process.env.PRINTIFY_API_KEY || '';
const SHOP = process.env.PRINTIFY_SHOP_ID || '';
const SK = process.env.STRIPE_SECRET_KEY || '';

(async () => {
  const order = store.db.prepare('SELECT * FROM orders WHERE order_number = ?').get(ORDER);
  if (!order) throw new Error(`no such order: ${ORDER}`);
  console.log(`order   : ${order.order_number}  ${order.status}  $${(order.amount_total_cents / 100).toFixed(2)}`);
  console.log(`current : fulfillment_summary = ${JSON.stringify(order.fulfillment_summary)}`);
  if (/^printify:/.test(order.fulfillment_summary || '')) {
    console.log('already has a Printify draft — refusing to create a second one.');
    return;
  }
  if (!order.stripe_session_id) throw new Error('order has no stripe_session_id');
  if (!SK) throw new Error('STRIPE_SECRET_KEY not set');
  if (!KEY || !SHOP) throw new Error('PRINTIFY_API_KEY / PRINTIFY_SHOP_ID not set');

  // Stripe session: the cart metadata and the shipping address both live here.
  const sres = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${order.stripe_session_id}`,
    { headers: { Authorization: `Bearer ${SK}` } });
  const session = await sres.json();
  if (session.error) throw new Error(`stripe: ${session.error.message}`);

  const cart = JSON.parse((session.metadata && session.metadata.cart) || '[]');
  if (!cart.length) throw new Error('no cart in the session metadata');

  const lines = [];
  for (const [pid, pvid, qty] of cart) {
    const p = store.db.prepare('SELECT slug, name, printify_product_id FROM products WHERE id = ?').get(pid);
    if (!p) { console.log(`  skip product ${pid}: not found`); continue; }
    if (!p.printify_product_id || !pvid) {
      console.log(`  skip ${p.slug}: printify_product_id=${JSON.stringify(p.printify_product_id)} variant=${pvid}`);
      continue;
    }
    lines.push({ product_id: p.printify_product_id, variant_id: pvid, quantity: qty, _slug: p.slug });
  }
  if (!lines.length) throw new Error('nothing Printify-linked in this order');

  // Same Stripe relocation the server handles: collected_information first.
  // Falling straight through to customer_details yields country + zip only.
  const ci = session.collected_information || {};
  const a = (ci.shipping_details && ci.shipping_details.address)
    || (session.shipping_details && session.shipping_details.address)
    || (session.customer_details && session.customer_details.address) || {};
  const cd = session.customer_details || {};
  const parts = (order.customer_name || cd.name || 'Madd Customer').trim().split(/\s+/);
  const body = {
    external_id: order.order_number,
    label: order.order_number,
    line_items: lines.map(({ _slug, ...l }) => l),
    shipping_method: 1,
    send_shipping_notification: false,
    address_to: {
      first_name: parts.shift() || 'Madd', last_name: parts.join(' ') || 'Customer',
      email: order.customer_email || cd.email || '', phone: cd.phone || '',
      country: a.country || 'US', region: a.state || '', address1: a.line1 || '',
      address2: a.line2 || '', city: a.city || '', zip: a.postal_code || '',
    },
  };

  console.log('\nwould send:');
  for (const l of lines) console.log(`  ${l._slug}  product=${l.product_id} variant=${l.variant_id} x${l.quantity}`);
  console.log(`  ship to: ${body.address_to.first_name} ${body.address_to.last_name}, `
            + `${body.address_to.address1}, ${body.address_to.city} ${body.address_to.region} ${body.address_to.zip}`);

  if (!APPLY) { console.log('\nDRY RUN — pass --apply to create the draft.'); return; }

  const r = await fetch(`https://api.printify.com/v1/shops/${SHOP}/orders.json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let j = {}; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) throw new Error(`printify ${r.status}: ${txt.slice(0, 300)}`);
  const pid = j.id || j;
  store.setOrderFulfillment.run(`printify:${pid} (DRAFT — approve in Printify to fulfill)`, order.id);
  console.log(`\nDRAFT created: ${pid}`);
  console.log('Approve it in Printify to produce and ship — or delete it if this was a test.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
