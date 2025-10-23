
-- Madd Hatchery core schema
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- jam, chick, eggs, merch
  unit_cents INTEGER NOT NULL,
  taxable BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'jam/jelly',
  flavor TEXT,
  breed TEXT,
  size TEXT,
  quantity INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_order_type_check CHECK (order_type IN ('jam/jelly','hatching eggs','eating eggs','baby chicks','grown birds')),
  CONSTRAINT orders_flavor_check CHECK (flavor IS NULL OR (order_type = 'jam/jelly' AND flavor IN ('blueberry-straight-up','blueberry-pepper','strawberry','sassy-strawberry','peace-jam','muscadine-jam','chai-jelly'))),
  CONSTRAINT orders_breed_check CHECK (breed IS NULL OR (order_type = 'hatching eggs' AND breed IN ('curly-frizzles','ayam-cemani','polish-top-hats','silver-gold-spangled-spitzhauben','easter-eggers','silky-curly-frizzles'))),
  CONSTRAINT orders_size_check CHECK (size IS NULL OR (order_type = 'jam/jelly' AND size IN ('quarter-pint','half-pint','one-pint'))),
  CONSTRAINT orders_quantity_check CHECK ((order_type = 'hatching eggs' AND quantity BETWEEN 1 AND 24) OR (order_type = 'eating eggs' AND quantity BETWEEN 1 AND 5) OR (order_type NOT IN ('hatching eggs','eating eggs') AND quantity IS NULL))
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type TEXT;

ALTER TABLE orders
  ALTER COLUMN order_type SET DEFAULT 'jam/jelly';

UPDATE orders SET order_type = 'jam/jelly' WHERE order_type IS NULL;

ALTER TABLE orders
  ALTER COLUMN order_type SET NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS flavor TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS breed TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS size TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS quantity INTEGER;

UPDATE orders
  SET flavor = NULL
  WHERE flavor IS NOT NULL
    AND flavor NOT IN ('blueberry-straight-up','blueberry-pepper','strawberry','sassy-strawberry','peace-jam','muscadine-jam','chai-jelly');

UPDATE orders
  SET breed = NULL
  WHERE breed IS NOT NULL
    AND breed NOT IN ('curly-frizzles','ayam-cemani','polish-top-hats','silver-gold-spangled-spitzhauben','easter-eggers','silky-curly-frizzles');

UPDATE orders
  SET size = NULL
  WHERE size IS NOT NULL
    AND size NOT IN ('quarter-pint','half-pint','one-pint');

UPDATE orders
  SET quantity = NULL
  WHERE (order_type = 'hatching eggs' AND (quantity IS NULL OR quantity < 1 OR quantity > 24))
     OR (order_type = 'eating eggs' AND (quantity IS NULL OR quantity < 1 OR quantity > 5))
     OR (order_type NOT IN ('hatching eggs','eating eggs') AND quantity IS NOT NULL);

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('jam/jelly','hatching eggs','eating eggs','baby chicks','grown birds'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_flavor_check CHECK (flavor IS NULL OR (order_type = 'jam/jelly' AND flavor IN ('blueberry-straight-up','blueberry-pepper','strawberry','sassy-strawberry','peace-jam','muscadine-jam','chai-jelly')));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_breed_check CHECK (breed IS NULL OR (order_type = 'hatching eggs' AND breed IN ('curly-frizzles','ayam-cemani','polish-top-hats','silver-gold-spangled-spitzhauben','easter-eggers','silky-curly-frizzles')));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_size_check CHECK (size IS NULL OR (order_type = 'jam/jelly' AND size IN ('quarter-pint','half-pint','one-pint')));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_quantity_check CHECK ((order_type = 'hatching eggs' AND quantity BETWEEN 1 AND 24) OR (order_type = 'eating eggs' AND quantity BETWEEN 1 AND 5) OR (order_type NOT IN ('hatching eggs','eating eggs') AND quantity IS NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merch_orders (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_name TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  merch_item_number TEXT NOT NULL,
  size_code TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_merch_orders_created_at ON merch_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merch_orders_item ON merch_orders(merch_item_number);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  total_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL, -- 'cashapp','card','cash'
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_reports (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,          -- e.g. 2025-10
  total_gross_cents INTEGER NOT NULL,
  total_tax_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VIEW order_totals AS
SELECT o.id AS order_id,
       SUM(oi.qty * oi.unit_cents) AS subtotal_cents
FROM orders o
JOIN order_items oi ON oi.order_id=o.id
GROUP BY o.id;

-- RBAC / identity tables
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'view', -- view -> submit -> admin
  can_portal BOOLEAN NOT NULL DEFAULT true,
  can_submit BOOLEAN NOT NULL DEFAULT false,
  can_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_app_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_app_users_updated_at();

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_username TEXT REFERENCES app_users(username) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS support_requests (
  id BIGSERIAL PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_created_at ON support_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS maddh_auth_providers (
  provider TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO maddh_auth_providers(provider, enabled)
VALUES
  ('local', true),
  ('ldap', true),
  ('oidc', false)
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_user_registrations (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 days'),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_user_registrations_username ON app_user_registrations(lower(username));
CREATE INDEX IF NOT EXISTS idx_app_user_registrations_email ON app_user_registrations(lower(email));

-- Procedure to create an invoice from an order
CREATE OR REPLACE FUNCTION create_invoice(p_order_id TEXT, p_tax_rate NUMERIC DEFAULT 0.07)
RETURNS TEXT AS $$
DECLARE v_sub INTEGER; v_tax INTEGER; v_total INTEGER; v_id TEXT;
BEGIN
  SELECT subtotal_cents INTO v_sub FROM order_totals WHERE order_id=p_order_id;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Order has no items'; END IF;
  v_tax := round(v_sub * p_tax_rate)::int;
  v_total := v_sub + v_tax;
  v_id := 'inv_' || extract(epoch from clock_timestamp())::bigint;
  INSERT INTO invoices(id, order_id, total_cents, tax_cents) VALUES (v_id, p_order_id, v_total, v_tax);
  UPDATE orders SET status='invoiced' WHERE id=p_order_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
