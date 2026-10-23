#!/usr/bin/env node
'use strict';
/* load-live-catalog.js — mirror the LIVE production catalog into the local DB.

   The merch half of the catalog (tees, mugs, stickers, bottles) is published
   into maddhatchery.com from tee-empire via the admin API, so it is NOT in
   db.js's seed. Without it a local copy shows jams and eggs only, and the
   redesign can't be judged against the real shop.

   This pulls the real thing — no invented demo products:

     node scripts/load-live-catalog.js                      # fetch from the live site
     node scripts/load-live-catalog.js path/to/snapshot.json # or load a saved snapshot

   LOCAL MOCKUP TOOL. Never run this against the droplet, and never add it to
   the deploy workflow — production is the source of truth it reads FROM. */

const fs = require('fs');
const store = require('../db');

const SOURCE = process.env.MH_CATALOG_URL || 'https://maddhatchery.com/api/products';

async function getCatalog(arg) {
  if (arg) {
    console.log(`Reading snapshot ${arg}`);
    return JSON.parse(fs.readFileSync(arg, 'utf8'));
  }
  console.log(`Fetching ${SOURCE}`);
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const data = await getCatalog(process.argv[2]);
  const products = data.products || [];
  if (!products.length) throw new Error('No products in response');

  let withVariants = 0;
  for (const p of products) {
    store.publishProduct({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description || '',
      price_cents: p.price_cents,
      image_url: p.image_url || '',
      fulfillment_type: p.fulfillment_type,
      sort: p.sort || 50,
      quantity: p.quantity_available || 0,
    });

    if (p.has_variants && Array.isArray(p.variants) && p.variants.length) {
      // front_image_url isn't exposed per-variant by /api/products; recover it
      // from the matching colour entry so swatches and thumbs behave locally.
      const frontByColor = new Map((p.colors || []).map((c) => [c.name, c.front_image_url || '']));
      store.setVariants(
        p.slug,
        p.variants.map((v) => ({
          printify_variant_id: v.printify_variant_id,
          color: v.color,
          color_hex: v.color_hex,
          size: v.size,
          price_cents: v.price_cents,
          image_url: v.image_url,
          front_image_url: frontByColor.get(v.color) || '',
        })),
        null
      );
      withVariants++;
    }
  }

  const all = store.listActiveProducts.all();
  console.log(`\nLoaded ${products.length} products (${withVariants} with variants). Local catalog now holds ${all.length}:`);
  const byCat = {};
  for (const p of all) (byCat[p.category] ||= []).push(p);
  for (const [cat, list] of Object.entries(byCat)) {
    const oos = list.filter((p) => !p.quantity_available).length;
    console.log(`  ${cat.padEnd(14)} ${String(list.length).padStart(2)} products${oos ? `  (${oos} at zero stock)` : ''}`);
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
