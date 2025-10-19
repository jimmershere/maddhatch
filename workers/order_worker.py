#!/usr/bin/env python3
"""
Order worker (Python 3.12)
- Consumes 'order.created'
- Upserts customer, creates order + freeform item
- Emits invoice.request, receipt.request, cashapp.request messages
"""
import json, os, time, uuid
import psycopg
import pika

AMQP_URL = os.getenv("AMQP_URL", "amqp://app:app@rabbitmq:5672/")
EXCHANGE = os.getenv("RMQ_EXCHANGE", "orders.direct")
DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")

def publish(ch, rk, payload):
    ch.basic_publish(EXCHANGE, rk, json.dumps(payload).encode("utf-8"),
                     properties=pika.BasicProperties(content_type="application/json", delivery_mode=2))

def main():
    while True:
        try:
            conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
            ch = conn.channel()
            ch.exchange_declare(EXCHANGE, "direct", durable=True)
            q = ch.queue_declare("orders.q", durable=True)
            ch.queue_bind(q.method.queue, EXCHANGE, "order.created")

            with psycopg.connect(DB_URL) as db:
                db.execute("select 1")

                def cb(chx, method, props, body):
                    o = json.loads(body)
                    print("got order:", o.get("id"))
                    with db.transaction():
                        cust = o["customer"]
                        row = db.execute(
                            "INSERT INTO customers(email,name,phone) VALUES(%s,%s,%s) "
                            "ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone "
                            "RETURNING id",
                            (cust["email"], cust["name"], cust.get("phone"))
                        ).fetchone()
                        customer_id = row[0]
                        db.execute(
                            "INSERT INTO orders(id, customer_id, channel, notes, status) VALUES(%s,%s,%s,%s,'queued')",
                            (o["id"], customer_id, o.get("channel","web"), o.get("notes",""))
                        )
                        for it in o.get("items", []):
                            db.execute(
                                "INSERT INTO order_items(order_id, sku, name, qty, unit_cents) VALUES(%s,%s,%s,%s,%s)",
                                (o["id"], it.get("sku","freeform"), it.get("name","Freeform Item"),
                                 int(it.get("qty",1)), int(it.get("unit_cents",0)))
                            )
                    # fan out follow-on work
                    publish(chx, "invoice.request", {"order_id": o["id"]})
                    publish(chx, "receipt.request", {"order_id": o["id"], "email": o["customer"]["email"]})
                    publish(chx, "cashapp.request", {"order_id": o["id"]})
                    chx.basic_ack(delivery_tag=method.delivery_tag)

                ch.basic_qos(prefetch_count=10)
                ch.basic_consume(q.method.queue, cb, auto_ack=False)
                ch.start_consuming()
        except Exception as e:
            print("worker error, retrying:", e)
            time.sleep(3)

if __name__ == "__main__":
    main()
