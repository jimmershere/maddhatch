#!/usr/bin/env python3
"""
Order worker (Python 3.12)
- Consumes 'order.created'
- Upserts customer, creates order + freeform item
- Emits invoice.request, receipt.request, cashapp.request messages
"""
import json, os, time
import psycopg
import pika

from rabbit_helpers import ensure_exchange, ensure_queue

AMQP_URL = os.getenv("AMQP_URL", "amqp://app:app@rabbitmq:5672/")
EXCHANGE = os.getenv("RMQ_EXCHANGE", "orders.direct")
DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")

ORDER_TYPES = {
    "jam/jelly",
    "hatching eggs",
    "eating eggs",
    "baby chicks",
    "grown birds",
}

FLAVORS = {
    "blueberry-straight-up",
    "blueberry-pepper",
    "strawberry",
    "sassy-strawberry",
    "peace-jam",
    "muscadine-jam",
    "chai-jelly",
}

BREEDS = {
    "curly-frizzles",
    "ayam-cemani",
    "polish-top-hats",
    "silver-gold-spangled-spitzhauben",
    "easter-eggers",
    "silky-curly-frizzles",
}

SIZES = {
    "quarter-pint",
    "half-pint",
    "one-pint",
}

def publish(ch, rk, payload):
    ch.basic_publish(EXCHANGE, rk, json.dumps(payload).encode("utf-8"),
                     properties=pika.BasicProperties(content_type="application/json", delivery_mode=2))

def main():
    while True:
        try:
            conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
            ch = ensure_exchange(conn.channel(), EXCHANGE)
            ch, q = ensure_queue(
                ch,
                "orders.q",
                arguments={"x-dead-letter-exchange": "orders.dlx"},
            )
            queue_name = getattr(q.method, "queue", "orders.q")
            ch.queue_bind(queue_name, EXCHANGE, "order.created")

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
                        order_type = (o.get("order_type") or "jam/jelly").strip().lower()
                        if order_type not in ORDER_TYPES:
                            order_type = "jam/jelly"

                        flavor = o.get("flavor") or ""
                        if isinstance(flavor, str):
                            flavor = flavor.strip().lower()
                        else:
                            flavor = ""
                        flavor_value = flavor if order_type == "jam/jelly" and flavor in FLAVORS else None

                        breed = o.get("breed") or ""
                        if isinstance(breed, str):
                            breed = breed.strip().lower()
                        else:
                            breed = ""
                        breed_value = breed if order_type == "hatching eggs" and breed in BREEDS else None

                        size = o.get("size") or ""
                        if isinstance(size, str):
                            size = size.strip().lower()
                        else:
                            size = ""
                        size_value = size if order_type == "jam/jelly" and size in SIZES else None

                        quantity = o.get("quantity")
                        quantity_value = None
                        if isinstance(quantity, int):
                            if order_type == "hatching eggs" and 1 <= quantity <= 24:
                                quantity_value = quantity
                            elif order_type == "eating eggs" and 1 <= quantity <= 5:
                                quantity_value = quantity

                        db.execute(
                            "INSERT INTO orders(id, customer_id, channel, notes, order_type, flavor, breed, size, quantity, status) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued')",
                            (o["id"], customer_id, o.get("channel","web"), o.get("notes",""), order_type, flavor_value, breed_value, size_value, quantity_value)
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
                ch.basic_consume(queue_name, cb, auto_ack=False)
                ch.start_consuming()
        except Exception as e:
            print("worker error, retrying:", e)
            time.sleep(3)

if __name__ == "__main__":
    main()
