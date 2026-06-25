'use strict';
/* Madd Hatchery catalog + orders — Node built-in SQLite (node:sqlite). */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'maddhatchery.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT '',
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('ship','pickup')),
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT UNIQUE,
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  amount_total_cents INTEGER NOT NULL DEFAULT 0,
  fulfillment_summary TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fulfillment_type TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS stripe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  printify_variant_id INTEGER,
  color TEXT DEFAULT '',
  color_hex TEXT DEFAULT '',
  size TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, printify_variant_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
`);
// products.printify_product_id (added post-hoc; guard for existing DBs)
try { db.exec("ALTER TABLE products ADD COLUMN printify_product_id TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE product_variants ADD COLUMN front_image_url TEXT DEFAULT ''"); } catch (e) {}

/* slug, name, category, description, price_cents, image_url, fulfillment, sort, qty
   NOTE: jams/eggs/chicks seed at qty 0 — they're being physically inventoried
   before they go on sale. Apparel/mugs/stickers (tee / madd-tee / mug / sticker)
   are NOT seeded here: they are published from tee-empire via the admin API
   (POST /api/admin/product) → see core/maddhatchery.py in the tee-empire repo. */
const seedProducts = [
  // ── Jams & jellies (ship) — inventory pending, seeded at 0 ─────────────
  ['peace-jam', 'Peace Jam', 'jams', 'Our flagship small-batch jam — mellow, golden, and made for sharing. The jar everybody asks for again.', 800, '/assets/v3/jars/jar_peace_jam.png', 'ship', 10, 0],
  ['sassy-strawberry-jam', 'Sassy Strawberry Jam', 'jams', 'Sweet strawberry with a little wink of heat. Sass in a jar.', 800, '/assets/v3/jars/jar_sassy_strawberry.png', 'ship', 11, 0],
  ['strawberry-jam', 'Strawberry Jam', 'jams', 'Classic, ripe-picked strawberry. Spoon it onto everything.', 800, '/assets/v3/jars/jar_strawberry.png', 'ship', 12, 0],
  ['blueberry-jam', 'Blueberry Jam', 'jams', 'Plump summer blueberries cooked down slow and simple.', 800, '/assets/v3/jars/jar_blueberry.png', 'ship', 13, 0],
  ['muscadine-jam', 'Muscadine Jam', 'jams', 'Deep, Southern-grape muscadine — a taste of the back porch.', 800, '/assets/v3/jars/jar_muscadine.png', 'ship', 14, 0],
  ['spicy-pepper-jam', 'Spicy Pepper Jam', 'jams', 'Sweet-hot pepper jam that loves a block of cream cheese.', 800, '/assets/v3/jars/jar_spicy_pepper.png', 'ship', 15, 0],
  ['coffee-jelly', 'Coffee Jelly', 'jams', 'A cult favorite — rich coffee jelly for the brave at breakfast.', 800, '/assets/v3/jars/jar_coffee_jelly.png', 'ship', 16, 0],
  ['jam-variety-pack', 'Jam Variety Pack (3)', 'jams', "Pick-your-poison trio of our small-batch favorites. The perfect gift.", 2200, '/assets/v3/jars/jar_variety.png', 'ship', 9, 0],

  // ── Farm pickup ───────────────────────────────────────────────────────
  ['farm-fresh-eggs-dozen', 'Farm-Fresh Eggs (Dozen)', 'eggs', 'A dozen rainbow eggs from our spoiled, happy hens. Farm pickup.', 700, '/assets/img/eggs/eggs-01.jpg', 'pickup', 30, 0],
  ['hatching-eggs-half-dozen', 'Hatching Eggs (Half Dozen)', 'hatching-eggs', 'Fertile hatching eggs from our heritage flock — incubator-ready.', 2500, '/assets/img/eggs/eggs-02.jpg', 'ship', 32, 8],
  ['baby-chicks', 'Baby Chicks (Straight Run)', 'chicks', 'Seasonal fuzzy baby chicks. Reserve now, pick up at the farm.', 1500, '/assets/img/chicks/chicks-01.jpg', 'pickup', 34, 0],
  ['started-pullet', 'Started Pullet', 'birds', 'Point-of-lay young hen, ready to join your coop. Farm pickup.', 3500, '/assets/img/chickens/chickens-01.jpg', 'pickup', 36, 6],
];

const upsertProduct = db.prepare(`
  INSERT INTO products (slug, name, category, description, price_cents, image_url, fulfillment_type, sort, active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(slug) DO UPDATE SET
    name=excluded.name, category=excluded.category, description=excluded.description,
    price_cents=excluded.price_cents, image_url=excluded.image_url,
    fulfillment_type=excluded.fulfillment_type, sort=excluded.sort, updated_at=CURRENT_TIMESTAMP
`);
const findProductId = db.prepare('SELECT id FROM products WHERE slug = ?');
const upsertInventory = db.prepare(`
  INSERT INTO inventory (product_id, quantity_available) VALUES (?, ?)
  ON CONFLICT(product_id) DO UPDATE SET quantity_available=excluded.quantity_available, updated_at=CURRENT_TIMESTAMP
`);
for (const p of seedProducts) {
  upsertProduct.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
  const row = findProductId.get(p[0]);
  // only set inventory on first insert; don't clobber live stock on restart
  const existing = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(row.id);
  if (!existing) upsertInventory.run(row.id, p[8]);
}

const PRODUCT_COLS = `
  p.id, p.slug, p.name, p.category, p.description, p.price_cents, p.image_url,
  p.fulfillment_type, p.sort, p.active, COALESCE(i.quantity_available,0) AS quantity_available`;

const _upsertBySlug = db.prepare(`
  INSERT INTO products (slug, name, category, description, price_cents, image_url, fulfillment_type, sort, active)
  VALUES (@slug, @name, @category, @description, @price_cents, @image_url, @fulfillment_type, @sort, 1)
  ON CONFLICT(slug) DO UPDATE SET
    name=excluded.name, category=excluded.category, description=excluded.description,
    price_cents=excluded.price_cents, image_url=excluded.image_url,
    fulfillment_type=excluded.fulfillment_type, sort=excluded.sort, active=1, updated_at=CURRENT_TIMESTAMP
`);
const _idBySlug = db.prepare('SELECT id FROM products WHERE slug = ?');
const _rowBySlug = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN inventory i ON i.product_id=p.id WHERE p.slug = ?`);

/* Publish (insert or update) a product from the tee-empire site publisher. */
function publishProduct(p) {
  _upsertBySlug.run({
    slug: p.slug, name: p.name, category: p.category, description: p.description || '',
    price_cents: Math.max(0, parseInt(p.price_cents, 10) || 0), image_url: p.image_url || '',
    fulfillment_type: p.fulfillment_type === 'pickup' ? 'pickup' : 'ship', sort: parseInt(p.sort, 10) || 50,
  });
  const id = _idBySlug.get(p.slug).id;
  module.exports.setInventory.run(id, Math.max(0, parseInt(p.quantity, 10) || 0));
  return _rowBySlug.get(p.slug);
}

/* ---- variants (color/size, mapped to Printify variant ids) ---- */
const _setPrintifyPid = db.prepare(`UPDATE products SET printify_product_id=? WHERE id=?`);
const _delVariants = db.prepare(`DELETE FROM product_variants WHERE product_id=?`);
const _insVariant = db.prepare(`INSERT INTO product_variants
  (product_id, printify_variant_id, color, color_hex, size, price_cents, image_url, front_image_url, sort, active)
  VALUES (@product_id, @pvid, @color, @hex, @size, @price, @image, @front, @sort, 1)`);
const _listVariants = db.prepare(`SELECT * FROM product_variants WHERE product_id=? AND active=1 ORDER BY sort, id`);

/* Replace a product's variants. variants: [{printify_variant_id,color,color_hex,size,price_cents,image_url}] */
function setVariants(slug, variants, printifyProductId) {
  const row = _idBySlug.get(slug);
  if (!row) return 0;
  if (printifyProductId != null) _setPrintifyPid.run(String(printifyProductId), row.id);
  _delVariants.run(row.id);
  let n = 0;
  for (const v of (variants || [])) {
    _insVariant.run({
      product_id: row.id, pvid: parseInt(v.printify_variant_id, 10) || null,
      color: v.color || '', hex: v.color_hex || '', size: v.size || '',
      price: Math.max(0, parseInt(v.price_cents, 10) || 0), image: v.image_url || '',
      front: v.front_image_url || '', sort: n,
    });
    n++;
  }
  return n;
}
function listVariants(productId) { return _listVariants.all(productId); }

module.exports = {
  db,
  publishProduct,
  setVariants,
  listVariants,
  retireBySlug: db.prepare(`UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE slug=?`),
  listProducts: db.prepare(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN inventory i ON i.product_id=p.id ORDER BY p.sort, p.name`),
  listActiveProducts: db.prepare(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN inventory i ON i.product_id=p.id WHERE p.active=1 ORDER BY p.sort, p.name`),
  listActiveByIds: db.prepare(`SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN inventory i ON i.product_id=p.id WHERE p.active=1 AND p.id IN (SELECT value FROM json_each(?)) ORDER BY p.sort`),
  setActive: db.prepare(`UPDATE products SET active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`),
  setInventory: db.prepare(`INSERT INTO inventory (product_id, quantity_available, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(product_id) DO UPDATE SET quantity_available=excluded.quantity_available, updated_at=CURRENT_TIMESTAMP`),
  decrementInventory: db.prepare(`UPDATE inventory SET quantity_available = MAX(0, quantity_available - ?), updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`),
  insertOrder: db.prepare(`INSERT INTO orders (order_number, stripe_session_id, customer_name, customer_email, status, amount_total_cents, fulfillment_summary) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  orderBySession: db.prepare(`SELECT * FROM orders WHERE stripe_session_id = ?`),
  setOrderFulfillment: db.prepare(`UPDATE orders SET fulfillment_summary = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`),
  insertOrderItem: db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, fulfillment_type) VALUES (?, ?, ?, ?, ?, ?)`),
  recordEvent: db.prepare(`INSERT OR IGNORE INTO stripe_events (stripe_event_id, event_type) VALUES (?, ?)`),
};

if (require.main === module) {
  const all = module.exports.listProducts.all();
  console.log(`Seeded ${all.length} products:`);
  for (const p of all) console.log(`  [${p.category}] ${p.name} — $${(p.price_cents / 100).toFixed(2)} (${p.quantity_available} in stock)`);
}
