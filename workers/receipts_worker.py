#!/usr/bin/env python3
"""
Receipts worker:
- Consumes receipt.request {order_id, email}
- Generates a simple PDF receipt (ReportLab) and emails via SMTP if configured.
Env:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
  OUTPUT_DIR (optional): also writes PDFs there
"""
import os, json, io, smtplib
from email.message import EmailMessage
import pika, psycopg
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

AMQP_URL = os.getenv("AMQP_URL", "amqp://guest:guest@rabbitmq:5672/")
EXCHANGE = os.getenv("RMQ_EXCHANGE", "orders.direct")
DB_URL = os.getenv("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")
OUT = os.getenv("OUTPUT_DIR","/out")

def make_pdf(order_id, db):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, height-72, "Madd Hatchery Receipt")
    c.setFont("Helvetica", 12)
    y = height-110
    c.drawString(72, y, f"Order: {order_id}"); y-=20
    row = db.execute("""
      SELECT c.name, c.email, o.created_at, COALESCE(ot.subtotal_cents,0)
      FROM orders o JOIN customers c ON c.id=o.customer_id
      LEFT JOIN order_totals ot ON ot.order_id=o.id
      WHERE o.id=%s
    """, (order_id,)).fetchone()
    name, email, created_at, subtotal = row
    c.drawString(72, y, f"Customer: {name} <{email}>"); y-=20
    c.drawString(72, y, f"Date: {created_at}"); y-=20
    c.drawString(72, y, f"Amount: ${subtotal/100:.2f}"); y-=40
    c.drawString(72, y, "Thank you for supporting our small business!")
    c.showPage(); c.save()
    buf.seek(0)
    return buf.read()

def send_email(to, subject, body, attachment=None, filename="receipt.pdf"):
    host=os.getenv("SMTP_HOST"); port=int(os.getenv("SMTP_PORT","587"))
    user=os.getenv("SMTP_USER"); pwd=os.getenv("SMTP_PASS"); sender=os.getenv("SMTP_FROM", user or "noreply@example.com")
    if not host:
        print("SMTP not configured; skipping email")
        return
    msg = EmailMessage()
    msg["To"]=to; msg["From"]=sender; msg["Subject"]=subject
    msg.set_content(body)
    if attachment:
        msg.add_attachment(attachment, maintype="application", subtype="pdf", filename=filename)
    with smtplib.SMTP(host, port) as s:
        s.starttls()
        if user and pwd: s.login(user, pwd)
        s.send_message(msg)

def main():
    os.makedirs(OUT, exist_ok=True)
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL)); ch = conn.channel()
    ch.exchange_declare(EXCHANGE, "direct", durable=True)
    q = ch.queue_declare("receipts.q", durable=True); ch.queue_bind(q.method.queue, EXCHANGE, "receipt.request")
    with psycopg.connect(DB_URL) as db:
        def cb(chx, method, props, body):
            m = json.loads(body); oid=m["order_id"]; email=m.get("email")
            pdf = make_pdf(oid, db)
            open(os.path.join(OUT, f"{oid}.pdf"), "wb").write(pdf)
            if email: send_email(email, "Your Madd Hatchery receipt", "Attached is your receipt. Enjoy!", pdf, f"{oid}.pdf")
            chx.basic_ack(delivery_tag=method.delivery_tag)
        ch.basic_qos(prefetch_count=5); ch.basic_consume(q.method.queue, cb, auto_ack=False); ch.start_consuming()

if __name__=="__main__": main()
