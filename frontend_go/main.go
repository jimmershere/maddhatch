package main

import (
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"strings"

	"github.com/gorilla/mux"
	"github.com/streadway/amqp"
	_ "github.com/lib/pq"
)

type Order struct {
	ID          string      `json:"id"`
	CreatedAt   time.Time   `json:"created_at"`
	Customer    Customer    `json:"customer"`
	Items       []OrderItem `json:"items"`
	Notes       string      `json:"notes"`
	Channel     string      `json:"channel"` // "web", "phone", etc.
}

type Customer struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type OrderItem struct {
	SKU      string  `json:"sku"`
	Name     string  `json:"name"`
	Qty      int     `json:"qty"`
	UnitCents int    `json:"unit_cents"`
}


// --- auth helpers ---
func groupsFromHeader(r *http.Request) map[string]bool {
	gs := map[string]bool{}
	for _, g := range http.Header.Get(r.Header)["X-User-Groups"] {
		for _, part := range strings.Split(g, ",") {
			trim := strings.ToLower(strings.TrimSpace(part))
			if trim != "" { gs[trim] = true }
		}
	}
	return gs
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gs := groupsFromHeader(r)
		if !gs["admin"] {
			http.Error(w, "admin required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}


func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}

func publishOrder(ch *amqp.Channel, exchange string, order Order) error {
	body, _ := json.Marshal(order)
	return ch.Publish(
		exchange,
		"order.created",
		false, false,
		amqp.Publishing{
			ContentType: "application/json",
			Body:        body,
			DeliveryMode: amqp.Persistent,
			Timestamp:   time.Now(),
		},
	)
}

func orderHandler(ch *amqp.Channel) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var o Order
		if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if o.ID == "" {
			o.ID = fmt.Sprintf("ord_%d", time.Now().UnixNano())
		}
		o.CreatedAt = time.Now().UTC()

		if err := publishOrder(ch, env("RMQ_EXCHANGE", "orders.direct"), o); err != nil {
			http.Error(w, "queue error", http.StatusInternalServerError)
			log.Println("amqp publish error:", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{"status": "queued", "id": o.ID})
	}
}


// --- admin API ---
func adminListOrders(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(` + "`" + `
			SELECT o.id, o.status, o.created_at, c.name, c.email, COALESCE(ot.subtotal_cents,0)
			FROM orders o 
			JOIN customers c ON c.id=o.customer_id
			LEFT JOIN order_totals ot ON ot.order_id=o.id
			ORDER BY o.created_at DESC LIMIT 200
		` + "`" + `)
		if err != nil { http.Error(w, "db error", 500); return }
		defer rows.Close()
		type row struct {
			ID string ` + "`json:\"id\"`" + `; Status string ` + "`json:\"status\"`" + `; CreatedAt time.Time ` + "`json:\"created_at\"`" + `
			Name string ` + "`json:\"name\"`" + `; Email string ` + "`json:\"email\"`" + `; Subtotal int ` + "`json:\"subtotal_cents\"`" + `
		}
		var out []row
		for rows.Next() {
			var r row
			rows.Scan(&r.ID,&r.Status,&r.CreatedAt,&r.Name,&r.Email,&r.Subtotal)
			out = append(out, r)
		}
		w.Header().Set("Content-Type","application/json")
		json.NewEncoder(w).Encode(out)
	}
}

func adminListInvoices(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(` + "`" + `
			SELECT id, order_id, total_cents, tax_cents, status, created_at
			FROM invoices ORDER BY created_at DESC LIMIT 200
		` + "`" + `)
		if err != nil { http.Error(w, "db error", 500); return }
		defer rows.Close()
		type row struct {
			ID string ` + "`json:\"id\"`" + `; OrderID string ` + "`json:\"order_id\"`" + `; Total int ` + "`json:\"total_cents\"`" + `; Tax int ` + "`json:\"tax_cents\"`" + `; Status string ` + "`json:\"status\"`" + `; CreatedAt time.Time ` + "`json:\"created_at\"`" + `
		}
		var out []row
		for rows.Next() {
			var r row
			rows.Scan(&r.ID,&r.OrderID,&r.Total,&r.Tax,&r.Status,&r.CreatedAt)
			out = append(out, r)
		}
		w.Header().Set("Content-Type","application/json")
		json.NewEncoder(w).Encode(out)
	}
}

func adminInvoiceCreate(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct{ OrderID string ` + "`json:\"order_id\"`" + `}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil { http.Error(w,"bad json",400); return }
		var id string
		if err := db.QueryRow(` + "`" + `SELECT create_invoice($1)` + "`" + `, in.OrderID).Scan(&id); err != nil {
			http.Error(w, "create_invoice error", 500); return
		}
		json.NewEncoder(w).Encode(map[string]any{"invoice_id":id})
	}
}


func main() {
	// AMQP
	amqpURL := env("AMQP_URL", "amqp://guest:guest@rabbitmq:5672/")
	conn, err := amqp.Dial(amqpURL)
	if err != nil {
		log.Fatalf("amqp dial: %v", err)
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("amqp channel: %v", err)
	}
	defer ch.Close()

	// Optionally ensure exchange is present
	exchange := env("RMQ_EXCHANGE", "orders.direct")
	err = ch.ExchangeDeclare(exchange, "direct", true, false, false, false, nil)
	if err != nil {
		log.Printf("exchange declare skipped/failed: %v", err)
	}

	// DB (used for health checks / simple ping)
	dbURL := env("DATABASE_URL", "postgres://postgres:postgres@db:5432/maddhatchery?sslmode=disable")
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Printf("WARNING: db ping failed: %v", err)
	}

	r := mux.NewRouter()
	r.HandleFunc("/healthz", health).Methods("GET")
	r.HandleFunc("/api/order", orderHandler(ch)).Methods("POST")

	// Serve static site
	admin := r.PathPrefix("/admin").Subrouter()
	admin.Use(requireAdmin)
	admin.HandleFunc("/orders", adminListOrders(db)).Methods("GET")
	admin.HandleFunc("/invoices", adminListInvoices(db)).Methods("GET")
	admin.HandleFunc("/invoice/create", adminInvoiceCreate(db)).Methods("POST")

	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./public")))

	addr := env("HTTP_ADDR", ":8443")
	certFile := env("TLS_CERT_FILE", "/certs/fullchain.pem")
	keyFile := env("TLS_KEY_FILE", "/certs/privkey.pem")

	server := &http.Server{
		Addr:    addr,
		Handler: r,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	log.Printf("MaddHatchery frontend listening on %s (TLS)", addr)
	if err := server.ListenAndServeTLS(certFile, keyFile); err != nil {
		log.Fatalf("ListenAndServeTLS: %v", err)
	}
}
