package identity

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const argonMemory = 64 * 1024
const argonTime = 3

func NormalizeLogin(raw string) (string, error) {
	if !utf8.ValidString(raw) || len(raw) > 256 {
		return "", fmt.Errorf("invalid login")
	}
	login := norm.NFKC.String(cases.Fold().String(norm.NFKC.String(strings.TrimSpace(raw))))
	if n := utf8.RuneCountInString(login); n < 3 || n > 32 {
		return "", fmt.Errorf("login must have 3..32 characters")
	}
	for _, r := range login {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '.' && r != '-' {
			return "", fmt.Errorf("login contains unsupported characters")
		}
	}
	return login, nil
}

func ValidatePassword(password string) error {
	n := utf8.RuneCountInString(password)
	if !utf8.ValidString(password) || n < 12 || n > 128 || len(password) > 512 {
		return fmt.Errorf("password must have 12..128 characters (maximum 512 bytes)")
	}
	return nil
}

func validName(name string) bool {
	return validLabel(name, 64)
}
func validLabel(name string, max int) bool {
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > max || strings.TrimSpace(name) == "" {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func accessDeadline(now, sessionEnd time.Time, ttl time.Duration) time.Time {
	expiry := now.Add(ttl)
	if expiry.After(sessionEnd) {
		return sessionEnd
	}
	return expiry
}

func hashPassword(password string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=1$%s$%s", argonMemory, argonTime, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash))
}

func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=1" {
		return false
	}
	salt, e1 := base64.RawStdEncoding.DecodeString(parts[4])
	expected, e2 := base64.RawStdEncoding.DecodeString(parts[5])
	if e1 != nil || e2 != nil || len(salt) != 16 || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, 1, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(value string) []byte { sum := sha256.Sum256([]byte(value)); return sum[:] }
func fingerprint(secret string, body []byte) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write(body)
	return h.Sum(nil)
}
func validToken(value string) bool {
	b, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(b) == 32 && len(value) == 43
}

func transition(current, action string) (string, bool) {
	next := map[string]string{"accept": "ACCEPTED", "reject": "REJECTED", "cancel": "CANCELLED"}[action]
	return next, next != "" && (current == "PENDING" || current == next)
}
