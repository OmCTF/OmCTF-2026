package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	contracts "svyaz.local/foundation/packages/contracts/generated/go"
)

type Probe func(context.Context) error

type Server struct {
	Identity     http.Handler
	Version      string
	Timeout      time.Duration
	MaxBodyBytes int64
	Probes       map[string]Probe
	Logger       *slog.Logger
}

var validID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type observedWriter struct {
	http.ResponseWriter
	status int
}

func (w *observedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *observedWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *observedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func RequestID(candidate string) string {
	if validID.MatchString(candidate) {
		return candidate
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (s Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	id := RequestID(r.Header.Get("X-Request-ID"))
	observed := &observedWriter{ResponseWriter: w}
	w = observed
	defer func() {
		status := observed.status
		if status == 0 {
			status = http.StatusOK
		}

		s.Logger.Info("http_request", "service", "api", "request_id", id, "method", r.Method, "status", status, "duration_ms", time.Since(started).Milliseconds())
	}()
	w.Header().Set("X-Request-ID", id)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	mediaPath := strings.HasPrefix(r.URL.Path, "/api/v1/uploads") || strings.HasPrefix(r.URL.Path, "/api/v1/attachments/")
	limit := s.MaxBodyBytes
	if strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") && r.Method == "PUT" {
		limit = 8 << 20
	}
	if strings.HasSuffix(r.URL.Path, "/sounds") && r.Method == "POST" {
		limit = 3 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if s.Identity != nil && (mediaPath || r.URL.Path == "/api/v1/search") {
		s.Identity.ServeHTTP(w, r)
		return
	}
	if s.Identity != nil && (strings.HasPrefix(r.URL.Path, "/api/v1/community/") || strings.HasPrefix(r.URL.Path, "/api/v1/hooks/") || strings.HasPrefix(r.URL.Path, "/api/v1/conversations") || strings.HasPrefix(r.URL.Path, "/api/v1/messages/") || strings.HasPrefix(r.URL.Path, "/api/v1/threads/")) {
		s.Identity.ServeHTTP(w, r)
		return
	}
	if s.Identity != nil && (strings.HasPrefix(r.URL.Path, "/api/v1/guilds") || strings.HasPrefix(r.URL.Path, "/api/v1/channels/") || strings.HasPrefix(r.URL.Path, "/api/v1/categories/") || strings.HasPrefix(r.URL.Path, "/api/v1/invites/") || strings.HasPrefix(r.URL.Path, "/api/v1/invite-preview/")) {
		s.Identity.ServeHTTP(w, r)
		return
	}
	if s.Identity != nil && (strings.HasPrefix(r.URL.Path, "/api/v1/auth/") || strings.HasPrefix(r.URL.Path, "/api/v1/users") || strings.HasPrefix(r.URL.Path, "/api/v1/friends") || strings.HasPrefix(r.URL.Path, "/api/v1/blocks") || strings.HasPrefix(r.URL.Path, "/api/v1/contacts/")) {
		s.Identity.ServeHTTP(w, r)
		return
	}
	status := http.StatusOK
	var response any
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		status = http.StatusMethodNotAllowed
		w.Header().Set("Allow", "GET, HEAD")
		response = contracts.ErrorResponse{Code: "method_not_allowed", Message: "Method not allowed", RequestID: id}
	} else {
		switch r.URL.Path {
		case "/health/live":
			response = contracts.HealthResponse{Service: "api", Status: "ok", RequestID: id, Dependencies: []contracts.DependencyStatus{}}
		case "/health/ready":
			result := contracts.HealthResponse{Service: "api", Status: "ok", RequestID: id, Dependencies: []contracts.DependencyStatus{}}
			ctx, cancel := context.WithTimeout(r.Context(), s.Timeout)
			defer cancel()
			names := make([]string, 0, len(s.Probes))
			for name := range s.Probes {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				state := "up"
				if err := s.Probes[name](ctx); err != nil {
					state = "down"
					result.Status = "unavailable"
					status = http.StatusServiceUnavailable
				}
				result.Dependencies = append(result.Dependencies, contracts.DependencyStatus{Name: name, Status: state})
			}
			response = result
		case "/api/v1/version":
			response = contracts.VersionResponse{Service: "api", Version: s.Version, APIVersion: "v1", SchemaVersion: 1, RequestID: id}
		default:
			status = http.StatusNotFound
			response = contracts.ErrorResponse{Code: "not_found", Message: "Route not found", RequestID: id}
		}
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		if err := json.NewEncoder(w).Encode(response); err != nil {
			s.Logger.Warn("response_write_failed", "service", "api", "request_id", id)
		}
	}
}
