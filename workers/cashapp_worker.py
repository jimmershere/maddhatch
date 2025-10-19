#!/usr/bin/env python3
"""
Cash App worker:
- Consumes cashapp.request {order_id}
- If CASHAPP_TOKEN present: (placeholder) call API to create a pay link (left for real integration).
- Otherwise: generate manual instructions link and publish cashapp.completed.
Publishes: cashapp.completed {order_id, method, amount_cents, link}
"""
import os, json
import pika, psycopg

AMQP_URL = os.getenv("AMQP_URL", "amqp://guest:guest@rabbitmq:5672/")
EXCHANGE = os.getenv("RMQ_EXCHANGE", "orders.direct")
DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")

def publish(ch, rk, payload):
    ch.basic_publish(EXCHANGE, rk, json.dumps(payload).encode("utf-8"))

def main():
    token = os.getenv("CASHAPP_TOKEN")
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL)); ch = conn.channel()
    ch.exchange_declare(EXCHANGE, "direct", durable=True)
    q = ch.queue_declare("payments.q", durable=True); ch.queue_bind(q.method.queue, EXCHANGE, "cashapp.request")
    with psycopg.connect(DB_URL) as db:
        def cb(chx, method, props, body):
            m = json.loads(body); oid=m["order_id"]
            amt = db.execute("SELECT COALESCE(subtotal_cents,0) FROM order_totals WHERE order_id=%s",(oid,)).fetchone()[0]
            link = None
            if token:
                # TODO: call real API here
                link = f"https://cash.app/pay/mock/{oid}"
            else:
                link = f"Manual: request ${amt/100:.2f} from customer via Cash App and record payment for order {oid}."
            publish(chx, "cashapp.completed", {"order_id": oid, "method":"cashapp", "amount_cents": int(amt), "link": link})
            chx.basic_ack(delivery_tag=method.delivery_tag)
        ch.basic_qos(prefetch_count=10); ch.basic_consume(q.method.queue, cb, auto_ack=False); ch.start_consuming()

if __name__=="__main__": main()
