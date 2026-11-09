package identity

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	c "svyaz.local/foundation/packages/contracts/generated/go"
)

func (s *Server) register(w http.ResponseWriter, r *http.Request) (int, any, error) {
	var in c.RegisterInput
	if err := decode(w, r, &in); err != nil {
		return 0, nil, err
	}
	login, err := NormalizeLogin(in.Login)
	if err != nil || ValidatePassword(in.Password) != nil || !validName(in.DisplayName) {
		return 0, nil, fail(400, "invalid_registration")
	}
	in.Login = login
	key := r.Header.Get("Idempotency-Key")
	if !validID(key) {
		return 0, nil, fail(400, "idempotency_key_required")
	}
	canonical, _ := json.Marshal(in)
	fp := fingerprint(s.secret, canonical)
	release, err := s.hashSlot(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer release()
	hash := hashPassword(in.Password)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "register:"+key); err != nil {
		return 0, nil, err
	}
	var oldFP []byte
	var id string
	err = tx.QueryRow(r.Context(), `SELECT fingerprint,user_id::text FROM identity.registrations WHERE key_hash=$1`, digest(key)).Scan(&oldFP, &id)
	if err == nil {
		if !hmac.Equal(oldFP, fp) {
			return 0, nil, fail(409, "idempotency_conflict")
		}
		p, e := profile(r.Context(), tx, id)
		return 201, p, e
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, err
	}
	id = newID()
	_, err = tx.Exec(r.Context(), `INSERT INTO identity.users(id,login,display_name) VALUES($1,$2,$3)`, id, login, in.DisplayName)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return 0, nil, fail(409, "registration_unavailable")
		}
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.password_credentials(user_id,password_hash) VALUES($1,$2)`, id, hash); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.user_settings(user_id) VALUES($1)`, id); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.registrations(key_hash,fingerprint,user_id) VALUES($1,$2,$3)`, digest(key), fp, id); err != nil {
		return 0, nil, err
	}
	p, err := profile(r.Context(), tx, id)
	if err != nil {
		return 0, nil, err
	}
	return 201, p, tx.Commit(r.Context())
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) (int, any, error) {
	var in c.LoginInput
	if err := decode(w, r, &in); err != nil {
		return 0, nil, err
	}
	login, normalErr := NormalizeLogin(in.Login)
	if len(in.Password) > 512 || !utf8.ValidString(in.Password) {
		return 0, nil, fail(400, "invalid_body")
	}
	device := "Browser"
	if in.Device != nil {
		device = strings.TrimSpace(*in.Device)
		if !validLabel(device, 80) {
			return 0, nil, fail(400, "invalid_device")
		}
	}
	release, err := s.hashSlot(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer release()
	var id, hash string
	err = s.db.QueryRow(r.Context(), `SELECT u.id::text,p.password_hash FROM identity.users u JOIN identity.password_credentials p ON p.user_id=u.id WHERE u.login=$1`, login).Scan(&id, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, err
	}
	if hash == "" {
		hash = s.dummy
	}
	valid := verifyPassword(hash, in.Password)
	if !valid || id == "" || normalErr != nil {
		return 0, nil, fail(401, "invalid_credentials")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var state string
	if err = tx.QueryRow(r.Context(), `SELECT state FROM identity.users WHERE id=$1 FOR UPDATE`, id).Scan(&state); err != nil {
		return 0, nil, err
	}
	if state != "active" {
		return 0, nil, fail(401, "invalid_credentials")
	}
	now := time.Now().UTC()
	expires := now.Add(s.sessionTTL)
	accessExpiry := accessDeadline(now, expires, s.accessTTL)
	access, refresh, sid := token(), token(), newID()
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.sessions(id,user_id,expires_at,device,access_hash,access_expires_at) VALUES($1,$2,$3,$4,$5,$6)`, sid, id, expires, device, digest(access), accessExpiry); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)`, digest(refresh), sid, expires); err != nil {
		return 0, nil, err
	}
	p, err := profile(r.Context(), tx, id)
	if err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	s.cookies(w, access, refresh, expires)
	return 200, c.AuthSession{User: p, SessionID: sid, AccessExpiresAt: stamp(accessExpiry), ExpiresAt: stamp(expires)}, nil
}
func (s *Server) refresh(w http.ResponseWriter, r *http.Request) (int, any, error) {
	raw := cookieValue(r, "svyaz_refresh")
	if !validToken(raw) {
		s.cookies(w, "", "", time.Time{})
		return 0, nil, fail(401, "session_expired")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var sid, uid string
	err = tx.QueryRow(r.Context(), `SELECT s.id::text,s.user_id::text FROM identity.refresh_tokens t JOIN identity.sessions s ON s.id=t.session_id WHERE t.token_hash=$1`, digest(raw)).Scan(&sid, &uid)
	if errors.Is(err, pgx.ErrNoRows) {
		s.cookies(w, "", "", time.Time{})
		return 0, nil, fail(401, "session_expired")
	}
	if err != nil {
		return 0, nil, err
	}

	var state string
	if err = tx.QueryRow(r.Context(), `SELECT state FROM identity.users WHERE id=$1 FOR UPDATE`, uid).Scan(&state); err != nil {
		return 0, nil, err
	}
	var expires time.Time
	var revoked *time.Time
	if err = tx.QueryRow(r.Context(), `SELECT expires_at,revoked_at FROM identity.sessions WHERE id=$1 FOR UPDATE`, sid).Scan(&expires, &revoked); err != nil {
		return 0, nil, err
	}
	var consumed, tokenRevoked *time.Time
	var tokenExpiry time.Time
	if err = tx.QueryRow(r.Context(), `SELECT consumed_at,revoked_at,expires_at FROM identity.refresh_tokens WHERE token_hash=$1 FOR UPDATE`, digest(raw)).Scan(&consumed, &tokenRevoked, &tokenExpiry); err != nil {
		return 0, nil, err
	}
	if consumed != nil || tokenRevoked != nil || revoked != nil || !time.Now().Before(expires) || !time.Now().Before(tokenExpiry) || state != "active" {
		if err = revoke(r, tx, sid); err != nil {
			return 0, nil, err
		}
		if err = tx.Commit(r.Context()); err != nil {
			return 0, nil, err
		}
		s.cookies(w, "", "", time.Time{})
		code := "session_expired"
		if consumed != nil {
			code = "refresh_reused"
		}
		return 0, nil, fail(401, code)
	}
	access, refresh := token(), token()
	accessExpiry := accessDeadline(time.Now(), expires, s.accessTTL)
	if _, err = tx.Exec(r.Context(), `UPDATE identity.refresh_tokens SET consumed_at=now() WHERE token_hash=$1`, digest(raw)); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.refresh_tokens(token_hash,session_id,parent_hash,expires_at) VALUES($1,$2,$3,$4)`, digest(refresh), sid, digest(raw), expires); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `UPDATE identity.sessions SET access_hash=$1,access_expires_at=$2 WHERE id=$3`, digest(access), accessExpiry, sid); err != nil {
		return 0, nil, err
	}
	p, err := profile(r.Context(), tx, uid)
	if err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	s.cookies(w, access, refresh, expires)
	return 200, c.AuthSession{User: p, SessionID: sid, AccessExpiresAt: stamp(accessExpiry), ExpiresAt: stamp(expires)}, nil
}
func revoke(r *http.Request, tx pgx.Tx, sid string) error {
	if _, err := tx.Exec(r.Context(), `UPDATE identity.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1`, sid); err != nil {
		return err
	}
	if _, err := tx.Exec(r.Context(), `UPDATE identity.refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE session_id=$1`, sid); err != nil {
		return err
	}
	return event(r.Context(), tx, "session.revoked", sid)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) (int, any, error) {
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var uid, sid string
	err = tx.QueryRow(r.Context(), `SELECT s.user_id::text,s.id::text FROM identity.sessions s WHERE s.access_hash=$1 OR s.id IN(SELECT session_id FROM identity.refresh_tokens WHERE token_hash=$2) LIMIT 1`, digest(cookieValue(r, "svyaz_access")), digest(cookieValue(r, "svyaz_refresh"))).Scan(&uid, &sid)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, err
	}
	if sid != "" {
		if _, err = tx.Exec(r.Context(), `SELECT id FROM identity.users WHERE id=$1 FOR UPDATE`, uid); err != nil {
			return 0, nil, err
		}
		if err = revoke(r, tx, sid); err != nil {
			return 0, nil, err
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	s.cookies(w, "", "", time.Time{})
	return 204, nil, nil
}
func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err = tx.Exec(r.Context(), `SELECT id FROM identity.users WHERE id=$1 FOR UPDATE`, a.User.ID); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `UPDATE identity.sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1`, a.User.ID); err != nil {
		return 0, nil, err
	}
	if _, err = tx.Exec(r.Context(), `UPDATE identity.refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE session_id IN(SELECT id FROM identity.sessions WHERE user_id=$1)`, a.User.ID); err != nil {
		return 0, nil, err
	}
	if err = event(r.Context(), tx, "user.sessions_revoked", a.User.ID); err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	s.cookies(w, "", "", time.Time{})
	return 204, nil, nil
}
func (s *Server) sessions(r *http.Request, a c.AuthSession) (int, any, error) {
	p, err := s.page(r, a)
	if err != nil {
		return 0, nil, err
	}
	rows, err := s.db.Query(r.Context(), `SELECT id::text,user_id::text,issued_at,expires_at,revoked_at,device FROM identity.sessions WHERE user_id=$1 AND id>$2 ORDER BY id LIMIT $3`, a.User.ID, p.after, p.limit+1)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	result := c.SessionPage{Items: []c.SessionInfo{}}
	for rows.Next() {
		var v c.SessionInfo
		var issued, expires time.Time
		var revoked *time.Time
		if err = rows.Scan(&v.ID, &v.UserID, &issued, &expires, &revoked, &v.Device); err != nil {
			return 0, nil, err
		}
		v.IssuedAt = stamp(issued)
		v.ExpiresAt = stamp(expires)
		v.Current = v.ID == a.SessionID
		if revoked != nil {
			x := stamp(*revoked)
			v.RevokedAt = &x
		}
		result.Items = append(result.Items, v)
	}
	if len(result.Items) > p.limit {
		result.Items = result.Items[:p.limit]
		result.NextCursor = s.cursor(p, result.Items[p.limit-1].ID)
	}
	return 200, result, rows.Err()
}
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request, a c.AuthSession, id string) (int, any, error) {
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err = tx.Exec(r.Context(), `SELECT id FROM identity.users WHERE id=$1 FOR UPDATE`, a.User.ID); err != nil {
		return 0, nil, err
	}
	var owned bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM identity.sessions WHERE id=$1 AND user_id=$2)`, id, a.User.ID).Scan(&owned); err != nil {
		return 0, nil, err
	}
	if !owned {
		return 0, nil, fail(404, "not_found")
	}
	if err = revoke(r, tx, id); err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	if id == a.SessionID {
		s.cookies(w, "", "", time.Time{})
	}
	return 204, nil, nil
}
