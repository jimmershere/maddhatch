
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
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cents INTEGER NOT NULL
);

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
