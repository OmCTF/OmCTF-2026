package identity

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

type policyKey struct{}
type PolicyFence struct {
	PID         int64
	Transaction string
}

func Fence(ctx context.Context) PolicyFence { v, _ := ctx.Value(policyKey{}).(PolicyFence); return v }

func IsMessagePath(path string) bool {
	p := strings.Split(strings.TrimPrefix(path, "/api/v1/"), "/")
	if p[0] == "hooks" || p[0] == "messages" || p[0] == "threads" || p[0] == "uploads" || p[0] == "attachments" || p[0] == "search" {
		return true
	}
	if len(p) < 3 || (p[0] != "channels" && p[0] != "conversations") {
		return false
	}
	switch p[2] {
	case "messages", "events", "read-position", "threads", "pins", "typing":
		return true
	}
	return false
}

func Decode(w http.ResponseWriter, r *http.Request, v any) error { return decode(w, r, v) }
func Fail(status int, code string) error                         { return fail(status, code) }
func ErrorStatus(err error) int {
	var e *apiError
	if errors.As(err, &e) {
		return e.status
	}
	return 503
}
func ValidID(id string) bool { return validID(id) }
func NewID() string          { return newID() }
func DecodeRequired(w http.ResponseWriter, r *http.Request, v any, fields ...string) error {
	return decodeRequired(w, r, v, fields...)
}
