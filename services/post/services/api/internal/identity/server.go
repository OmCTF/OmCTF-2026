package identity

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/config"
	"svyaz.local/foundation/services/api/internal/httpapi"
)

type Server struct {
	Business              func(http.ResponseWriter, *http.Request, c.AuthSession) (int, any, error)
	Webhook               func(http.ResponseWriter, *http.Request) (int, any, error)
	db                    *pgxpool.Pool
	policy                *pgxpool.Pool
	redis                 *redis.Client
	origin, secret, dummy string
	secure                bool
	accessTTL, sessionTTL time.Duration
	ipLimit               int
	hashSlots             chan struct{}
	readSlots             chan struct{}
	log                   *slog.Logger
}
type apiError struct {
	status        int
	code, message string
}
type BinaryResponse struct {
	Headers http.Header
	Body    []byte
}

func (e *apiError) Error() string { return e.code }
func fail(status int, code string) error {
	return &apiError{status, code, strings.ReplaceAll(code, "_", " ")}
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validID(s string) bool    { return uuidPattern.MatchString(s) }
func newID() string            { return httpapi.RequestID("") }
func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
func New(db *pgxpool.Pool, r *redis.Client, logger *slog.Logger) (*Server, error) {
	origin := config.Env("APP_ORIGIN", "http://127.0.0.1:18080")
	u, err := url.Parse(origin)
	secure := config.Env("APP_ENV", "development") == "production"
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") || (secure && u.Scheme != "https") {
		return nil, fmt.Errorf("APP_ORIGIN must be a canonical origin (HTTPS in production)")
	}
	if u.Scheme == "http" && !oneOf(u.Hostname(), "localhost", "127.0.0.1", "::1") && (secure || config.Env("ALLOW_PUBLIC_HTTP", "") != "1") {
		return nil, fmt.Errorf("insecure development origin must use loopback")
	}
	secure = u.Scheme == "https"
	if err := config.ValidateSecrets("IDEMPOTENCY_SECRET"); err != nil {
		return nil, err
	}
	access, err := config.PositiveInt("ACCESS_TTL_SECONDS", 300)
	if err != nil || access > 900 {
		return nil, fmt.Errorf("ACCESS_TTL_SECONDS must be 1..900")
	}
	session, err := config.PositiveInt("SESSION_TTL_SECONDS", 2592000)
	if err != nil || session <= access || session > 2592000 {
		return nil, fmt.Errorf("SESSION_TTL_SECONDS must exceed access TTL and be <=2592000")
	}
	limit, err := config.PositiveInt("AUTH_IP_LIMIT", 30)
	if err != nil {
		return nil, err
	}
	var policy *pgxpool.Pool
	if db != nil {
		policyConfig := db.Config().Copy()
		policyConfig.MaxConns = 8
		policy, err = pgxpool.NewWithConfig(context.Background(), policyConfig)
		if err != nil {
			return nil, err
		}
	}
	return &Server{db: db, policy: policy, redis: r, origin: origin, secret: config.Env("IDEMPOTENCY_SECRET", ""), secure: secure, accessTTL: time.Duration(access) * time.Second, sessionTTL: time.Duration(session) * time.Second, ipLimit: limit, hashSlots: make(chan struct{}, 4), readSlots: make(chan struct{}, 8), dummy: hashPassword(token()), log: logger}, nil
}
func (s *Server) Close() {
	if s.policy != nil {
		s.policy.Close()
	}
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	duration := 4 * time.Second
	if (r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/")) || strings.HasPrefix(r.URL.Path, "/api/v1/attachments/") {
		duration = 25 * time.Second
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(time.Now().Add(duration))
		_ = controller.SetWriteDeadline(time.Now().Add(duration))
	}
	ctx, cancel := context.WithTimeout(r.Context(), duration)
	defer cancel()
	r = r.WithContext(ctx)
	status, result, err := 0, any(nil), error(nil)
	readSlotHeld := false
	defer func() {
		if readSlotHeld {
			<-s.readSlots
		}
	}()
	if r.Method == "POST" && r.URL.Path == "/api/v1/auth/logout" {
		host := clientHost(r)
		err = s.rate(r.Context(), "ip:"+fmt.Sprintf("%x", digest(host)), s.ipLimit)
	}
	if err == nil && r.Method == "GET" && (r.URL.Path == "/api/v1/search" || r.URL.Path == "/api/v1/guilds") {
		host := clientHost(r)
		limit := 60
		bucket := "guilds-read-ip:"
		if r.URL.Path == "/api/v1/search" {
			limit = 3000
			bucket = "search-read-ip:"
		}
		err = s.rate(r.Context(), bucket+fmt.Sprintf("%x", digest(host)), limit)
		if err == nil {
			select {
			case s.readSlots <- struct{}{}:
				readSlotHeld = true
			default:
				err = fail(429, "read_busy")
			}
		}
	}
	if r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") {
		if r.Header.Get("Origin") != s.origin || r.Header.Get("X-Svyaz-CSRF") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			err = fail(403, "csrf_failed")
		} else {
			_, err = s.authenticate(r)
		}
	}
	if err == nil {
		err = bufferRequest(w, r)
	}
	if err == nil {
		status, result, err = s.fencedDispatch(w, r)
	}
	if readSlotHeld {
		<-s.readSlots
		readSlotHeld = false
	}
	if status == 0 && err == nil {
		return
	}
	if err != nil {
		var e *apiError
		if !errors.As(err, &e) {
			e = &apiError{503, "service_unavailable", "Service temporarily unavailable"}
			s.log.Error("identity_failed", "request_id", w.Header().Get("X-Request-ID"))
		}
		status = e.status
		result = c.ErrorResponse{Code: e.code, Message: e.message, RequestID: w.Header().Get("X-Request-ID")}
		if status == 429 {
			w.Header().Set("Retry-After", "60")
		}
	}
	if binary, ok := result.(BinaryResponse); ok {
		for key, values := range binary.Headers {
			for _, value := range values {
				w.Header().Set(key, value)
			}
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(binary.Body)))
		w.WriteHeader(status)
		_, _ = w.Write(binary.Body)
		return
	}
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(result)
	}
}

func bufferRequest(w http.ResponseWriter, r *http.Request) error {
	limit := int64(1 << 20)
	if r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") {
		limit = 8 << 20
	}
	if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/sounds") {
		limit = 3 << 20
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			return fail(413, "payload_too_large")
		}
		return fail(400, "invalid_body")
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	return nil
}

func clientHost(r *http.Request) string {
	if ip := net.ParseIP(r.Header.Get("X-Svyaz-Client-IP")); ip != nil {
		return ip.String()
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func (s *Server) fencedDispatch(w http.ResponseWriter, r *http.Request) (int, any, error) {
	tx, err := s.policy.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	lock := "SELECT pg_advisory_xact_lock_shared(73191504)"
	authWrite := r.Method == "POST" && (r.URL.Path == "/api/v1/auth/register" || r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/auth/refresh" || r.URL.Path == "/api/v1/auth/logout")
	if r.Method != "GET" && r.Method != "HEAD" && !IsMessagePath(r.URL.Path) && !authWrite {
		lock = "SELECT pg_advisory_xact_lock(73191504)"
	}
	if _, err = tx.Exec(r.Context(), lock); err != nil {
		return 0, nil, err
	}
	var fence PolicyFence
	err = tx.QueryRow(r.Context(), `SELECT pid,virtualtransaction FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=73191504 AND objsubid=1 AND granted`).Scan(&fence.PID, &fence.Transaction)
	if err != nil {
		return 0, nil, err
	}
	r = r.WithContext(context.WithValue(r.Context(), policyKey{}, fence))
	return s.dispatch(w, r)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	return decodeRequired(w, r, v)
}
func decodeRequired(w http.ResponseWriter, r *http.Request, v any, required ...string) error {
	content, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || content != "application/json" {
		return fail(400, "json_required")
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
	var raw json.RawMessage
	if err := d.Decode(&raw); err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			return fail(413, "payload_too_large")
		}
		return fail(400, "invalid_body")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fail(400, "invalid_body")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return fail(400, "invalid_body")
	}
	for _, field := range required {
		if _, present := fields[field]; !present {
			return fail(400, "invalid_body")
		}
	}
	for _, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fail(400, "invalid_body")
		}
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if strict.Decode(v) != nil {
		return fail(400, "invalid_body")
	}
	return nil
}
func (s *Server) rate(ctx context.Context, key string, limit int) error {
	n, err := s.redis.Eval(ctx, `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`, []string{"identity:rate:" + key}).Int()
	if err != nil {
		return err
	}
	if n > limit {
		return fail(429, "rate_limited")
	}
	return nil
}
func (s *Server) hashSlot(ctx context.Context) (func(), error) {
	select {
	case s.hashSlots <- struct{}{}:
		return func() { <-s.hashSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
		return nil, fail(429, "authentication_busy")
	}
}
func (s *Server) dispatch(w http.ResponseWriter, r *http.Request) (int, any, error) {
	p := strings.TrimPrefix(r.URL.Path, "/api/v1")

	if strings.HasPrefix(p, "/hooks/") && strings.Count(p, "/") == 2 && r.Method == "POST" && s.Webhook != nil {
		host := clientHost(r)
		if err := s.rate(r.Context(), "hook-ip:"+fmt.Sprintf("%x", digest(host)), 60); err != nil {
			return 0, nil, err
		}
		id := strings.TrimPrefix(p, "/hooks/")
		if !validID(id) {
			return 0, nil, fail(404, "webhook_unavailable")
		}
		if err := s.rate(r.Context(), "hook:"+id+":"+fmt.Sprintf("%x", digest(r.Header.Get("Authorization"))), 30); err != nil {
			return 0, nil, err
		}
		return s.Webhook(w, r)
	}
	mutate := r.Method != "GET" && r.Method != "HEAD"
	if mutate && (r.Header.Get("Origin") != s.origin || r.Header.Get("X-Svyaz-CSRF") != "1" || r.Header.Get("Sec-Fetch-Site") == "cross-site") {
		return 0, nil, fail(403, "csrf_failed")
	}
	if r.Method == "POST" && (p == "/auth/register" || p == "/auth/login" || p == "/auth/refresh") {
		host := clientHost(r)
		if err := s.rate(r.Context(), "ip:"+fmt.Sprintf("%x", digest(host)), s.ipLimit); err != nil {
			return 0, nil, err
		}
		switch p {
		case "/auth/register":
			return s.register(w, r)
		case "/auth/login":
			return s.login(w, r)
		case "/auth/refresh":
			return s.refresh(w, r)
		}
	}
	if p == "/auth/logout" && r.Method == "POST" {
		return s.logout(w, r)
	}
	auth, err := s.authenticate(r)
	if err != nil {
		return 0, nil, err
	}
	if mutate {
		if err := s.rate(r.Context(), "user:"+auth.User.ID, 120); err != nil {
			return 0, nil, err
		}
	}
	switch {
	case p == "/auth/session" && r.Method == "GET":
		return 200, auth, nil
	case p == "/auth/logout-all" && r.Method == "POST":
		return s.logoutAll(w, r, auth)
	case p == "/users/me" && r.Method == "GET":
		return 200, auth.User, nil
	case p == "/users/me" && r.Method == "PATCH":
		return s.patchProfile(w, r, auth)
	case p == "/users/me/settings":
		return s.settings(w, r, auth)
	case p == "/users/me/sessions" && r.Method == "GET":
		return s.sessions(r, auth)
	case strings.HasPrefix(p, "/users/me/sessions/") && r.Method == "DELETE":
		return s.revokeSession(w, r, auth, strings.TrimPrefix(p, "/users/me/sessions/"))
	case p == "/users" && r.Method == "GET":
		return s.findUser(r, auth)
	case strings.HasPrefix(p, "/users/") && r.Method == "GET":
		return s.publicProfile(r, auth, strings.TrimPrefix(p, "/users/"))
	case p == "/friends/requests" && r.Method == "GET":
		return s.requests(r, auth)
	case p == "/friends/requests" && r.Method == "POST":
		return s.createRequest(w, r, auth)
	case strings.HasPrefix(p, "/friends/requests/"):
		return s.updateRequest(r, auth, strings.TrimPrefix(p, "/friends/requests/"))
	case p == "/friends" && r.Method == "GET":
		return s.profiles(r, auth, false)
	case p == "/blocks" && r.Method == "GET":
		return s.profiles(r, auth, true)
	case strings.HasPrefix(p, "/friends/") && r.Method == "DELETE":
		return s.relationship(r, auth, strings.TrimPrefix(p, "/friends/"), "unfriend")
	case strings.HasPrefix(p, "/blocks/") && (r.Method == "POST" || r.Method == "DELETE"):
		action := "block"
		if r.Method == "DELETE" {
			action = "unblock"
		}
		return s.relationship(r, auth, strings.TrimPrefix(p, "/blocks/"), action)
	case strings.HasPrefix(p, "/contacts/") && r.Method == "GET":
		return s.eligibility(r, auth, strings.TrimPrefix(p, "/contacts/"))
	default:
		if s.Business != nil {
			return s.Business(w, r, auth)
		}
		return 0, nil, fail(404, "not_found")
	}
}

const profileColumns = `u.id::text,u.login,u.display_name,u.avatar,to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

type scanner interface{ Scan(...any) error }

func scanProfile(row scanner) (c.PublicProfile, error) {
	var p c.PublicProfile
	err := row.Scan(&p.ID, &p.Login, &p.DisplayName, &p.Avatar, &p.CreatedAt)
	return p, err
}
func profile(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (c.PublicProfile, error) {
	return scanProfile(q.QueryRow(ctx, "SELECT "+profileColumns+" FROM identity.users u WHERE u.id=$1", id))
}
func (s *Server) authenticate(r *http.Request) (c.AuthSession, error) {
	var a c.AuthSession
	cookie, err := r.Cookie("svyaz_access")
	if err != nil || !validToken(cookie.Value) {
		return a, fail(401, "authentication_required")
	}
	var issued, expires time.Time
	err = s.db.QueryRow(r.Context(), `SELECT s.id::text,s.user_id::text,s.access_expires_at,s.expires_at FROM identity.sessions s JOIN identity.users u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.access_expires_at>now() AND u.state='active'`, digest(cookie.Value)).Scan(&a.SessionID, &a.User.ID, &issued, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, fail(401, "session_expired")
	}
	if err != nil {
		return a, err
	}
	a.User, err = profile(r.Context(), s.db, a.User.ID)
	if err != nil {
		return a, err
	}
	var revision int64
	if err = s.db.QueryRow(r.Context(), `SELECT coalesce((SELECT revision FROM guild.community_users WHERE user_id=$1),0)`, a.User.ID).Scan(&revision); err != nil {
		return a, err
	}
	a.CommunityRevision = &revision
	a.AccessExpiresAt = stamp(issued)
	a.ExpiresAt = stamp(expires)
	return a, err
}
func cookieValue(r *http.Request, name string) string {
	v, e := r.Cookie(name)
	if e != nil {
		return ""
	}
	return v.Value
}
func (s *Server) cookies(w http.ResponseWriter, access, refresh string, expires time.Time) {

	for name, value := range map[string]string{"svyaz_access": access, "svyaz_refresh": refresh} {
		path := "/api/v1"
		if name == "svyaz_refresh" {
			path = "/api/v1/auth"
		}
		maxAge := int(time.Until(expires).Seconds())
		if value == "" {
			maxAge = -1
			expires = time.Unix(1, 0)
		}

		http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: path, HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge, Expires: expires})
	}
}

type page struct {
	after   string
	limit   int
	binding string
}

func (s *Server) page(r *http.Request, a c.AuthSession) (page, error) {
	p := page{after: "00000000-0000-0000-0000-000000000000", limit: 50, binding: a.User.ID + ":" + r.URL.Path}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			return p, fail(400, "invalid_limit")
		}
		p.limit = n
	}
	if raw := r.URL.Query().Get("after"); raw != "" {
		parts := strings.Split(raw, ".")
		if len(parts) != 2 || !validID(parts[0]) {
			return p, fail(400, "invalid_cursor")
		}
		sig, e := base64.RawURLEncoding.DecodeString(parts[1])
		if e != nil || !hmac.Equal(sig, fingerprint(s.secret, []byte(p.binding+":"+parts[0]))) {
			return p, fail(400, "invalid_cursor")
		}
		p.after = parts[0]
	}
	return p, nil
}
func (s *Server) cursor(p page, id string) *string {
	v := id + "." + base64.RawURLEncoding.EncodeToString(fingerprint(s.secret, []byte(p.binding+":"+id)))
	return &v
}
func event(ctx context.Context, tx pgx.Tx, kind, id string) error {
	_, err := tx.Exec(ctx, `INSERT INTO identity.outbox(event_id,schema_version,kind,aggregate_id,payload) VALUES($1,1,$2,$3,'{}')`, newID(), kind, id)
	return err
}
