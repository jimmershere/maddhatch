package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	pq "github.com/lib/pq"
	"github.com/streadway/amqp"
)

// Order represents a customer order submitted through the frontend.
type Order struct {
	ID        string      `json:"id"`
	CreatedAt time.Time   `json:"created_at"`
	Customer  Customer    `json:"customer"`
	Items     []OrderItem `json:"items"`
	Notes     string      `json:"notes"`
	Channel   string      `json:"channel"`
}

// Customer holds identifying information for an order customer.
type Customer struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// OrderItem represents a single line item in an order.
type OrderItem struct {
	SKU       string `json:"sku"`
	Name      string `json:"name"`
	Qty       int    `json:"qty"`
	UnitCents int    `json:"unit_cents"`
}

type sessionContextKey string

const ctxSessionKey sessionContextKey = "session"

type Session struct {
	Username  string
	Groups    map[string]bool
	CanSubmit bool
	CanAdmin  bool
}

type supportTicketRequest struct {
	ID       string `json:"id"`
	Summary  string `json:"summary"`
	Severity int    `json:"severity"`
	User     string `json:"user,omitempty"`
}

type supportTicket struct {
	ID           string    `json:"id"`
	UserUsername string    `json:"user_username"`
	Summary      string    `json:"summary"`
	Severity     int       `json:"severity"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type supportRequestPayload struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Description string `json:"description"`
}

type supportRequestRecord struct {
	RequestNumber string    `json:"request_number"`
	CreatedAt     time.Time `json:"created_at"`
}

type userRecord struct {
	Username  string    `json:"username"`
	Display   string    `json:"display_name"`
	Role      string    `json:"role"`
	CanPortal bool      `json:"can_portal"`
	CanSubmit bool      `json:"can_submit"`
	CanAdmin  bool      `json:"can_admin"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type userCreateRequest struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	Display   string `json:"display_name"`
	Role      string `json:"role"`
	CanPortal bool   `json:"can_portal"`
	CanSubmit bool   `json:"can_submit"`
	CanAdmin  bool   `json:"can_admin"`
}

type userUpdateRequest struct {
	Password  *string `json:"password,omitempty"`
	Display   *string `json:"display_name,omitempty"`
	Role      *string `json:"role,omitempty"`
	CanPortal *bool   `json:"can_portal,omitempty"`
	CanSubmit *bool   `json:"can_submit,omitempty"`
	CanAdmin  *bool   `json:"can_admin,omitempty"`
}

type authProvider struct {
	Provider  string    `json:"provider"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
}

type registrationRequest struct {
	Email       string `json:"email"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
}

type registrationConfirmRequest struct {
	Token string `json:"token"`
}

type registrationResponse struct {
	Message string `json:"message"`
}

type frontendConfig struct {
	OAuthProxyURL string `json:"oauthProxyUrl"`
	OAuthStart    string `json:"oauthStart"`
	APIBase       string `json:"apiBase"`
}

type apiClient struct {
	base   *url.URL
	secret string
	client *http.Client
}

func newOAuthProxy(externalURL, internalURL string, skipVerify bool) (*httputil.ReverseProxy, *url.URL, error) {
	if externalURL == "" {
		return nil, nil, nil
	}
	ext, err := url.Parse(externalURL)
	if err != nil {
		return nil, nil, err
	}
	targetURL := ext
	if internalURL != "" {
		targetURL, err = url.Parse(internalURL)
		if err != nil {
			return nil, nil, err
		}
	}
	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Host = targetURL.Host
	}
	if skipVerify {
		proxy.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		}
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		if loc := resp.Header.Get("Location"); loc != "" {
			if parsed, err := url.Parse(loc); err == nil {
				if parsed.Host == targetURL.Host {
					parsed.Scheme = ext.Scheme
					parsed.Host = ext.Host
					resp.Header.Set("Location", parsed.String())
				}
			}
		}
		return nil
	}
	return proxy, ext, nil
}

// groupsFromHeader parses the X-User-Groups header into a lookup map.
func groupsFromHeader(r *http.Request) map[string]bool {
	gs := map[string]bool{}
	for _, g := range r.Header.Values("X-User-Groups") {
		for _, part := range strings.Split(g, ",") {
			trim := strings.ToLower(strings.TrimSpace(part))
			if trim != "" {
				gs[trim] = true
			}
		}
	}
	return gs
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gs := mergeRequestGroups(r)
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

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
		log.Printf("invalid value for %s: %q", key, v)
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		log.Printf("invalid duration for %s: %q", key, v)
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func newAPIClient(raw, secret string) (*apiClient, error) {
	if raw == "" {
		return nil, fmt.Errorf("api url is required")
	}
	base, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	return &apiClient{
		base:   base,
		secret: secret,
		client: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

func (c *apiClient) do(ctx context.Context, method, path string, payload any, out any) error {
	if c == nil {
		return fmt.Errorf("api client not configured")
	}
	u := *c.base
	u.Path = strings.TrimRight(c.base.Path, "/") + path
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Maddh-Shared-Secret", c.secret)
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("api %s %s: %s", method, path, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	io.Copy(io.Discard, resp.Body)
	return nil
}

func (c *apiClient) createSupportTicket(ctx context.Context, ticket supportTicketRequest) error {
	return c.do(ctx, http.MethodPost, "/support/tickets", ticket, nil)
}

func (c *apiClient) listSupportTickets(ctx context.Context) ([]supportTicket, error) {
	var out []supportTicket
	err := c.do(ctx, http.MethodGet, "/admin/tickets", nil, &out)
	return out, err
}

func (c *apiClient) registerAccount(ctx context.Context, req registrationRequest) (registrationResponse, error) {
	var out registrationResponse
	err := c.do(ctx, http.MethodPost, "/auth/register", req, &out)
	return out, err
}

func (c *apiClient) confirmRegistration(ctx context.Context, token string) (registrationResponse, error) {
	payload := registrationConfirmRequest{Token: token}
	var out registrationResponse
	err := c.do(ctx, http.MethodPost, "/auth/register/confirm", payload, &out)
	return out, err
}

func (c *apiClient) listUsers(ctx context.Context) ([]userRecord, error) {
	var out []userRecord
	err := c.do(ctx, http.MethodGet, "/admin/users", nil, &out)
	return out, err
}

func (c *apiClient) createUser(ctx context.Context, user userCreateRequest) error {
	return c.do(ctx, http.MethodPost, "/admin/users", user, nil)
}

func (c *apiClient) updateUser(ctx context.Context, username string, user userUpdateRequest) error {
	return c.do(ctx, http.MethodPut, "/admin/users/"+url.PathEscape(username), user, nil)
}

func (c *apiClient) listAuthProviders(ctx context.Context) ([]authProvider, error) {
	var out []authProvider
	err := c.do(ctx, http.MethodGet, "/admin/auth/providers", nil, &out)
	return out, err
}

func (c *apiClient) setAuthProvider(ctx context.Context, provider string, enabled bool) error {
	payload := map[string]bool{"enabled": enabled}
	return c.do(ctx, http.MethodPut, "/admin/auth/providers/"+url.PathEscape(provider), payload, nil)
}

func decodeSession(secret []byte, token string) (*Session, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid token")
	}
	payload, err := base64.URLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	sig, err := base64.URLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(mac.Sum(nil), sig) {
		return nil, fmt.Errorf("signature mismatch")
	}
	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, err
	}
	if exp, ok := raw["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return nil, fmt.Errorf("session expired")
		}
	}
	sess := &Session{Groups: map[string]bool{}}
	if v, ok := raw["sub"].(string); ok {
		sess.Username = v
	}
	if arr, ok := raw["groups"].([]any); ok {
		for _, g := range arr {
			if s, ok := g.(string); ok {
				sess.Groups[strings.ToLower(s)] = true
			}
		}
	}
	if v, ok := raw["can_submit"].(bool); ok {
		sess.CanSubmit = v
	}
	if v, ok := raw["can_admin"].(bool); ok {
		sess.CanAdmin = v
		if v {
			sess.Groups["admin"] = true
			sess.Groups["submit"] = true
		}
	}
	if sess.CanSubmit {
		sess.Groups["submit"] = true
	}
	if len(sess.Groups) == 0 {
		sess.Groups["view"] = true
	} else {
		sess.Groups["view"] = true
	}
	return sess, nil
}

func sessionMiddleware(secret []byte, cookieName string) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(secret) > 0 && cookieName != "" {
				if c, err := r.Cookie(cookieName); err == nil {
					if sess, err := decodeSession(secret, c.Value); err == nil {
						ctx := context.WithValue(r.Context(), ctxSessionKey, sess)
						r = r.WithContext(ctx)
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func sessionFromContext(ctx context.Context) *Session {
	if v := ctx.Value(ctxSessionKey); v != nil {
		if sess, ok := v.(*Session); ok {
			return sess
		}
	}
	return nil
}

func mergeRequestGroups(r *http.Request) map[string]bool {
	gs := groupsFromHeader(r)
	if sess := sessionFromContext(r.Context()); sess != nil {
		if gs == nil {
			gs = map[string]bool{}
		}
		for g := range sess.Groups {
			gs[g] = true
		}
		if sess.CanAdmin {
			gs["admin"] = true
		}
		if sess.CanSubmit {
			gs["submit"] = true
		}
	}
	return gs
}

func dialAMQPWithRetry(url string, attempts int, delay time.Duration) (*amqp.Connection, error) {
	for i := 0; attempts <= 0 || i < attempts; i++ {
		conn, err := amqp.Dial(url)
		if err == nil {
			if i > 0 {
				log.Printf("amqp dial succeeded after %d attempt(s)", i+1)
			}
			return conn, nil
		}
		log.Printf("amqp dial attempt %d failed: %v", i+1, err)
		time.Sleep(delay)
	}
	if attempts <= 0 {
		return nil, fmt.Errorf("amqp dial: retries disabled but connection not established")
	}
	return nil, fmt.Errorf("amqp dial: exhausted %d attempts", attempts)
}

func health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func publishOrder(ch *amqp.Channel, exchange string, order Order) error {
	body, _ := json.Marshal(order)
	return ch.Publish(
		exchange,
		"order.created",
		false, false,
		amqp.Publishing{
			ContentType:  "application/json",
			Body:         body,
			DeliveryMode: amqp.Persistent,
			Timestamp:    time.Now(),
		},
	)
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload != nil {
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			log.Printf("respondJSON encode: %v", err)
		}
	}
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]any{"error": msg})
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
		if err := json.NewEncoder(w).Encode(map[string]any{"status": "queued", "id": o.ID}); err != nil {
			log.Printf("orderHandler encode: %v", err)
		}
	}
}

func adminListOrders(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`
            SELECT o.id, o.status, o.created_at, c.name, c.email, COALESCE(ot.subtotal_cents, 0)
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            LEFT JOIN order_totals ot ON ot.order_id = o.id
            ORDER BY o.created_at DESC
            LIMIT 200
        `)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type row struct {
			ID        string    `json:"id"`
			Status    string    `json:"status"`
			CreatedAt time.Time `json:"created_at"`
			Name      string    `json:"name"`
			Email     string    `json:"email"`
			Subtotal  int       `json:"subtotal_cents"`
		}

		var out []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.ID, &r.Status, &r.CreatedAt, &r.Name, &r.Email, &r.Subtotal); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			out = append(out, r)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(out); err != nil {
			log.Printf("adminListOrders encode: %v", err)
		}
	}
}

func adminListInvoices(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`
            SELECT id, order_id, total_cents, tax_cents, status, created_at
            FROM invoices
            ORDER BY created_at DESC
            LIMIT 200
        `)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type row struct {
			ID        string    `json:"id"`
			OrderID   string    `json:"order_id"`
			Total     int       `json:"total_cents"`
			Tax       int       `json:"tax_cents"`
			Status    string    `json:"status"`
			CreatedAt time.Time `json:"created_at"`
		}

		var out []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.ID, &r.OrderID, &r.Total, &r.Tax, &r.Status, &r.CreatedAt); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			out = append(out, r)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(out); err != nil {
			log.Printf("adminListInvoices encode: %v", err)
		}
	}
}

func adminInvoiceCreate(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			OrderID string `json:"order_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}

		var id string
		if err := db.QueryRow(`SELECT create_invoice($1)`, in.OrderID).Scan(&id); err != nil {
			http.Error(w, "create_invoice error", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(map[string]any{"invoice_id": id}); err != nil {
			log.Printf("adminInvoiceCreate encode: %v", err)
		}
	}
}

func configJSHandler(cfg frontendConfig) http.HandlerFunc {
	data, err := json.Marshal(cfg)
	if err != nil {
		log.Printf("config marshal: %v", err)
		data = []byte("{}")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		_, _ = w.Write([]byte("window.MADDH_CONFIG="))
		_, _ = w.Write(data)
		_, _ = w.Write([]byte(";\n"))
		if cfg.OAuthStart != "" {
			_, _ = w.Write([]byte(fmt.Sprintf("window.MADDH_OAUTH2_START=%q;\n", cfg.OAuthStart)))
		}
	}
}

func supportTicketCreate(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "support api unavailable")
			return
		}
		defer r.Body.Close()
		var req supportTicketRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.ID == "" {
			req.ID = fmt.Sprintf("tick_%d", time.Now().UnixNano())
		}
		if req.Severity < 1 {
			req.Severity = 1
		}
		if req.Severity > 4 {
			req.Severity = 4
		}
		if req.User == "" {
			if sess := sessionFromContext(r.Context()); sess != nil {
				req.User = sess.Username
			}
		}
		if err := api.createSupportTicket(r.Context(), req); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusAccepted, map[string]any{"ticket": req.ID})
	}
}

func insertSupportRequest(ctx context.Context, db *sql.DB, payload supportRequestPayload) (supportRequestRecord, error) {
	const maxAttempts = 5
	for attempt := 0; attempt < maxAttempts; attempt++ {
		reqNumber := fmt.Sprintf("req_%d", time.Now().UnixNano())
		var record supportRequestRecord
		err := db.QueryRowContext(ctx, `
            INSERT INTO support_requests (request_number, user_id, email, phone, description)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING request_number, created_at
        `, reqNumber, payload.UserID, payload.Email, payload.Phone, payload.Description).Scan(&record.RequestNumber, &record.CreatedAt)
		if err == nil {
			return record, nil
		}
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		return supportRequestRecord{}, err
	}
	return supportRequestRecord{}, fmt.Errorf("failed to allocate request number")
}

func supportRequestCreate(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			respondError(w, http.StatusServiceUnavailable, "support requests unavailable")
			return
		}
		defer r.Body.Close()

		var payload supportRequestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}

		payload.UserID = strings.TrimSpace(payload.UserID)
		payload.Email = strings.TrimSpace(payload.Email)
		payload.Phone = strings.TrimSpace(payload.Phone)
		payload.Description = strings.TrimSpace(payload.Description)

		if payload.UserID == "" || payload.Email == "" || payload.Phone == "" || payload.Description == "" {
			respondError(w, http.StatusBadRequest, "user id, email, phone, and description are required")
			return
		}

		record, err := insertSupportRequest(r.Context(), db, payload)
		if err != nil {
			log.Printf("support request insert failed: %v", err)
			respondError(w, http.StatusInternalServerError, "could not log support request")
			return
		}

		respondJSON(w, http.StatusCreated, map[string]any{
			"request_number": record.RequestNumber,
			"created_at":     record.CreatedAt,
		})
	}
}

func registerAccount(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "registration unavailable")
			return
		}
		defer r.Body.Close()
		var req registrationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		req.Email = strings.TrimSpace(req.Email)
		req.Username = strings.TrimSpace(req.Username)
		req.Password = strings.TrimSpace(req.Password)
		if req.Email == "" || req.Username == "" || req.Password == "" {
			respondError(w, http.StatusBadRequest, "email, username, and password required")
			return
		}
		res, err := api.registerAccount(r.Context(), req)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusAccepted, res)
	}
}

func confirmRegistration(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "registration unavailable")
			return
		}
		defer r.Body.Close()
		var req registrationConfirmRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		req.Token = strings.TrimSpace(req.Token)
		if req.Token == "" {
			respondError(w, http.StatusBadRequest, "token required")
			return
		}
		res, err := api.confirmRegistration(r.Context(), req.Token)
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, res)
	}
}

func adminSupportTickets(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "support api unavailable")
			return
		}
		tickets, err := api.listSupportTickets(r.Context())
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, tickets)
	}
}

func adminListUsers(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "user api unavailable")
			return
		}
		users, err := api.listUsers(r.Context())
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, users)
	}
}

func adminCreateUser(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "user api unavailable")
			return
		}
		defer r.Body.Close()
		var req userCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.Username == "" || req.Password == "" {
			respondError(w, http.StatusBadRequest, "username and password required")
			return
		}
		if req.Display == "" {
			req.Display = req.Username
		}
		if req.Role == "" {
			req.Role = "view"
		}
		if err := api.createUser(r.Context(), req); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusCreated, map[string]any{"created": req.Username})
	}
}

func adminUpdateUser(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "user api unavailable")
			return
		}
		defer r.Body.Close()
		vars := mux.Vars(r)
		username := vars["username"]
		if username == "" {
			respondError(w, http.StatusBadRequest, "username required")
			return
		}
		var req userUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.Password != nil && *req.Password == "" {
			req.Password = nil
		}
		if req.Display != nil && *req.Display == "" {
			req.Display = nil
		}
		if req.Role != nil && *req.Role == "" {
			req.Role = nil
		}
		if err := api.updateUser(r.Context(), username, req); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"updated": username})
	}
}

func adminAuthProvidersList(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "config api unavailable")
			return
		}
		providers, err := api.listAuthProviders(r.Context())
		if err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, providers)
	}
}

func adminAuthProviderToggle(api *apiClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if api == nil {
			respondError(w, http.StatusServiceUnavailable, "config api unavailable")
			return
		}
		defer r.Body.Close()
		vars := mux.Vars(r)
		provider := vars["provider"]
		var payload struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if err := api.setAuthProvider(r.Context(), provider, payload.Enabled); err != nil {
			respondError(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"provider": provider, "enabled": payload.Enabled})
	}
}

func main() {
	// AMQP
	amqpURL := env("AMQP_URL", "amqp://guest:guest@rabbitmq:5672/")
	// Allow the frontend to patiently wait for RabbitMQ to come online. The
	// default of zero means "retry forever", which keeps the container running
	// instead of crashing if the broker is temporarily unavailable during
	// startup (a common scenario when compose is still bringing the stack up).
	amqpRetries := envInt("AMQP_CONNECT_RETRIES", 0)
	amqpDelay := envDuration("AMQP_CONNECT_INTERVAL", time.Second)

	conn, err := dialAMQPWithRetry(amqpURL, amqpRetries, amqpDelay)
	if err != nil {
		log.Fatalf("%v", err)
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("amqp channel: %v", err)
	}
	defer ch.Close()

	// Optionally ensure exchange is present
	exchange := env("RMQ_EXCHANGE", "orders.direct")
	if err = ch.ExchangeDeclare(exchange, "direct", true, false, false, false, nil); err != nil {
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

	apiSecret := env("MADDH_SHARED_SECRET", "maddh-shared-secret")
	apiBase := env("MADDH_API_URL", "")
	var apiClientInstance *apiClient
	if apiBase != "" {
		if client, err := newAPIClient(apiBase, apiSecret); err != nil {
			log.Printf("api client disabled: %v", err)
		} else {
			apiClientInstance = client
		}
	}

	sessionSecret := []byte(env("RBAC_SESSION_SECRET", "rbac-session-secret"))
	sessionCookie := env("RBAC_SESSION_COOKIE_NAME", "maddh_session")
	oauthProxyURL := env("MADDH_OAUTH2_PROXY_URL", "")
	oauthInternalURL := env("MADDH_OAUTH2_PROXY_INTERNAL_URL", "")
	oauthSkipVerify := envBool("MADDH_OAUTH2_PROXY_INSECURE_SKIP_VERIFY", false)
	oauthProxy, oauthExternal, err := newOAuthProxy(oauthProxyURL, oauthInternalURL, oauthSkipVerify)
	if err != nil {
		log.Printf("oauth proxy setup failed: %v", err)
		oauthProxy = nil
	}
	oauthStart := env("MADDH_OAUTH2_START", "/oauth2/start")

	cfg := frontendConfig{
		OAuthProxyURL: oauthProxyURL,
		OAuthStart:    oauthStart,
		APIBase:       apiBase,
	}
	if oauthExternal != nil {
		cfg.OAuthProxyURL = oauthExternal.String()
	}

	r := mux.NewRouter()
	r.Use(sessionMiddleware(sessionSecret, sessionCookie))
	r.HandleFunc("/config.js", configJSHandler(cfg)).Methods("GET")
	r.HandleFunc("/healthz", health).Methods("GET")
	r.HandleFunc("/api/order", orderHandler(ch)).Methods("POST")
	r.HandleFunc("/support/tickets", supportTicketCreate(apiClientInstance)).Methods("POST")
	r.HandleFunc("/support/requests", supportRequestCreate(db)).Methods("POST")
	r.HandleFunc("/auth/register", registerAccount(apiClientInstance)).Methods("POST")
	r.HandleFunc("/auth/register/confirm", confirmRegistration(apiClientInstance)).Methods("POST")

	if oauthProxy != nil {
		r.PathPrefix("/oauth2/").Handler(oauthProxy)
	}

	// Admin API
	admin := r.PathPrefix("/admin").Subrouter()
	admin.Use(requireAdmin)
	admin.HandleFunc("/orders", adminListOrders(db)).Methods("GET")
	admin.HandleFunc("/invoices", adminListInvoices(db)).Methods("GET")
	admin.HandleFunc("/invoice/create", adminInvoiceCreate(db)).Methods("POST")
	admin.HandleFunc("/tickets", adminSupportTickets(apiClientInstance)).Methods("GET")
	admin.HandleFunc("/users", adminListUsers(apiClientInstance)).Methods("GET")
	admin.HandleFunc("/users", adminCreateUser(apiClientInstance)).Methods("POST")
	admin.HandleFunc("/users/{username}", adminUpdateUser(apiClientInstance)).Methods("PUT")
	admin.HandleFunc("/auth/providers", adminAuthProvidersList(apiClientInstance)).Methods("GET")
	admin.HandleFunc("/auth/providers/{provider}", adminAuthProviderToggle(apiClientInstance)).Methods("PUT")

	// Serve static site
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("./public")))

	addr := env("HTTP_ADDR", ":8443")
	certFile := env("TLS_CERT_FILE", "/certs/fullchain.pem")
	keyFile := env("TLS_KEY_FILE", "/certs/privkey.pem")

	if !fileExists(certFile) && fileExists("/certs/server.crt") {
		log.Printf("TLS cert %q not found, falling back to /certs/server.crt", certFile)
		certFile = "/certs/server.crt"
	}
	if !fileExists(keyFile) && fileExists("/certs/server.key") {
		log.Printf("TLS key %q not found, falling back to /certs/server.key", keyFile)
		keyFile = "/certs/server.key"
	}

	server := &http.Server{
		Addr:    addr,
		Handler: r,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	useTLS := fileExists(certFile) && fileExists(keyFile)
	if !useTLS {
		log.Printf("TLS cert/key not found; serving HTTP without TLS on %s", addr)
	}

	if useTLS {
		log.Printf("MaddHatchery frontend listening on %s (TLS)", addr)
		if err := server.ListenAndServeTLS(certFile, keyFile); err != nil {
			log.Fatalf("ListenAndServeTLS: %v", err)
		}
	} else {
		log.Printf("MaddHatchery frontend listening on %s (HTTP)", addr)
		if err := server.ListenAndServe(); err != nil {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}
}
