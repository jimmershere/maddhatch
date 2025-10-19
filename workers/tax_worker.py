#!/usr/bin/env python3
"""
Tax aggregation worker:
- Consumes tax.report {period: YYYY-MM}
- Aggregates invoices by period into tax_reports table
"""
import os, json, datetime as dt
import pika, psycopg

AMQP_URL = os.getenv("AMQP_URL", "amqp://guest:guest@rabbitmq:5672/")
EXCHANGE = os.getenv("RMQ_EXCHANGE", "orders.direct")
DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")

def main():
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL)); ch = conn.channel()
    ch.exchange_declare(EXCHANGE, "direct", durable=True)
    q = ch.queue_declare("tax.q", durable=True); ch.queue_bind(q.method.queue, EXCHANGE, "tax.report")
    with psycopg.connect(DB_URL) as db:
        def cb(chx, method, props, body):
            m = json.loads(body); period = m.get("period")
            if not period:
                period = dt.datetime.utcnow().strftime("%Y-%m")
            rows = db.execute("""
                SELECT COALESCE(SUM(total_cents),0), COALESCE(SUM(tax_cents),0)
                FROM invoices
                WHERE to_char(created_at,'YYYY-MM')=%s
            """,(period,)).fetchone()
            gross, tax = rows
            rep_id = f"tax_{period}"
            db.execute("""
              INSERT INTO tax_reports(id, period, total_gross_cents, total_tax_cents)
              VALUES (%s,%s,%s,%s)
              ON CONFLICT (id) DO UPDATE SET total_gross_cents=EXCLUDED.total_gross_cents, total_tax_cents=EXCLUDED.total_tax_cents
            """, (rep_id, period, int(gross), int(tax)))
            chx.basic_ack(delivery_tag=method.delivery_tag)
        ch.basic_qos(prefetch_count=1); ch.basic_consume(q.method.queue, cb, auto_ack=False); ch.start_consuming()

if __name__=="__main__": main()
