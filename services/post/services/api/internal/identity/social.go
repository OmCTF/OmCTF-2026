package identity

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	c "svyaz.local/foundation/packages/contracts/generated/go"
)

func (s *Server) patchProfile(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	var in c.ProfilePatch
	if err := decode(w, r, &in); err != nil {
		return 0, nil, err
	}
	if in.DisplayName != nil && !validName(*in.DisplayName) {
		return 0, nil, fail(400, "invalid_display_name")
	}
	if in.Avatar != nil && !oneOf(*in.Avatar, "violet", "mint", "amber", "rose", "sky") {
		return 0, nil, fail(400, "invalid_avatar")
	}
	p, err := scanProfile(s.db.QueryRow(r.Context(), `UPDATE identity.users u SET display_name=coalesce($1,display_name),avatar=coalesce($2,avatar) WHERE id=$3 RETURNING `+profileColumns, in.DisplayName, in.Avatar, a.User.ID))
	return 200, p, err
}
func oneOf(v string, choices ...string) bool {
	for _, c := range choices {
		if c == v {
			return true
		}
	}
	return false
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	var in c.SettingsPatch
	switch r.Method {
	case "GET":
	case "PATCH":
		if err := decode(w, r, &in); err != nil {
			return 0, nil, err
		}
		if in.FriendRequests != nil && !oneOf(*in.FriendRequests, "everyone", "nobody") || in.DmPolicy != nil && !oneOf(*in.DmPolicy, "everyone", "friends", "nobody") {
			return 0, nil, fail(400, "invalid_settings")
		}
	default:
		return 0, nil, fail(405, "method_not_allowed")
	}
	var result c.PrivacySettings
	query := `SELECT discoverable,friend_requests,dm_policy FROM identity.user_settings WHERE user_id=$1`
	args := []any{a.User.ID}
	if r.Method == "PATCH" {
		query = `UPDATE identity.user_settings SET discoverable=coalesce($2,discoverable),friend_requests=coalesce($3,friend_requests),dm_policy=coalesce($4,dm_policy) WHERE user_id=$1 RETURNING discoverable,friend_requests,dm_policy`
		args = append(args, in.Discoverable, in.FriendRequests, in.DmPolicy)
	}
	err := s.db.QueryRow(r.Context(), query, args...).Scan(&result.Discoverable, &result.FriendRequests, &result.DmPolicy)
	return 200, result, err
}

const notBlocked = `NOT EXISTS(SELECT 1 FROM identity.blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1))`

func (s *Server) findUser(r *http.Request, a c.AuthSession) (int, any, error) {
	login, err := NormalizeLogin(r.URL.Query().Get("login"))
	if err != nil {
		return 0, nil, fail(400, "invalid_login")
	}
	p, err := scanProfile(s.db.QueryRow(r.Context(), `SELECT `+profileColumns+` FROM identity.users u JOIN identity.user_settings st ON st.user_id=u.id WHERE u.login=$2 AND u.state='active' AND (st.discoverable OR u.id=$1) AND `+notBlocked, a.User.ID, login))
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "not_found")
	}
	return 200, p, err
}
func (s *Server) publicProfile(r *http.Request, a c.AuthSession, id string) (int, any, error) {
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	p, err := scanProfile(s.db.QueryRow(r.Context(), `SELECT `+profileColumns+` FROM identity.users u WHERE u.id=$2 AND u.state='active' AND `+notBlocked, a.User.ID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "not_found")
	}
	return 200, p, err
}
func (s *Server) profiles(r *http.Request, a c.AuthSession, blocks bool) (int, any, error) {
	p, err := s.page(r, a)
	if err != nil {
		return 0, nil, err
	}
	filter := `u.id IN(SELECT CASE WHEN user_low=$1 THEN user_high ELSE user_low END FROM identity.friendships WHERE user_low=$1 OR user_high=$1) AND u.state='active'`
	if blocks {
		filter = `u.id IN(SELECT blocked_id FROM identity.blocks WHERE blocker_id=$1)`
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+profileColumns+` FROM identity.users u WHERE `+filter+` AND u.id>$2 ORDER BY u.id LIMIT $3`, a.User.ID, p.after, p.limit+1)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	result := c.ProfilePage{Items: []c.PublicProfile{}}
	for rows.Next() {
		v, e := scanProfile(rows)
		if e != nil {
			return 0, nil, e
		}
		result.Items = append(result.Items, v)
	}
	if len(result.Items) > p.limit {
		result.Items = result.Items[:p.limit]
		result.NextCursor = s.cursor(p, result.Items[p.limit-1].ID)
	}
	return 200, result, rows.Err()
}

const requestSelect = `SELECT f.id::text,f.status,f.created_at,f.updated_at,s.id::text,s.login,s.display_name,s.avatar,s.created_at,t.id::text,t.login,t.display_name,t.avatar,t.created_at FROM identity.friend_requests f JOIN identity.users s ON s.id=f.sender_id JOIN identity.users t ON t.id=f.recipient_id `

func scanRequest(row scanner) (c.FriendRequest, error) {
	var v c.FriendRequest
	var created, updated, sc, tc time.Time
	err := row.Scan(&v.ID, &v.Status, &created, &updated, &v.Sender.ID, &v.Sender.Login, &v.Sender.DisplayName, &v.Sender.Avatar, &sc, &v.Recipient.ID, &v.Recipient.Login, &v.Recipient.DisplayName, &v.Recipient.Avatar, &tc)
	v.CreatedAt = stamp(created)
	v.UpdatedAt = stamp(updated)
	v.Sender.CreatedAt = stamp(sc)
	v.Recipient.CreatedAt = stamp(tc)
	return v, err
}
func (s *Server) requests(r *http.Request, a c.AuthSession) (int, any, error) {
	p, err := s.page(r, a)
	if err != nil {
		return 0, nil, err
	}
	rows, err := s.db.Query(r.Context(), requestSelect+`WHERE (f.sender_id=$1 OR f.recipient_id=$1) AND f.id>$2
AND NOT EXISTS(SELECT 1 FROM identity.blocks b WHERE
  (b.blocker_id=f.sender_id AND b.blocked_id=f.recipient_id) OR
  (b.blocker_id=f.recipient_id AND b.blocked_id=f.sender_id))
ORDER BY f.id LIMIT $3`, a.User.ID, p.after, p.limit+1)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	result := c.RequestPage{Items: []c.FriendRequest{}}
	for rows.Next() {
		v, e := scanRequest(rows)
		if e != nil {
			return 0, nil, e
		}
		result.Items = append(result.Items, v)
	}
	if len(result.Items) > p.limit {
		result.Items = result.Items[:p.limit]
		result.NextCursor = s.cursor(p, result.Items[p.limit-1].ID)
	}
	return 200, result, rows.Err()
}
func pair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}
func pairLock(r *http.Request, tx pgx.Tx, a, b string) error {
	low, high := pair(a, b)
	_, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "pair:"+low+":"+high)
	return err
}
func blocked(r *http.Request, tx pgx.Tx, a, b string) (bool, error) {
	var v bool
	err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM identity.blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))`, a, b).Scan(&v)
	return v, err
}
func (s *Server) createRequest(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	var in c.FriendRequestInput
	if err := decode(w, r, &in); err != nil {
		return 0, nil, err
	}
	if !validID(in.UserID) || in.UserID == a.User.ID {
		return 0, nil, fail(400, "invalid_recipient")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err = pairLock(r, tx, a.User.ID, in.UserID); err != nil {
		return 0, nil, err
	}
	var privacy string
	err = tx.QueryRow(r.Context(), `SELECT st.friend_requests FROM identity.user_settings st JOIN identity.users u ON u.id=st.user_id WHERE u.id=$1 AND u.state='active'`, in.UserID).Scan(&privacy)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "not_found")
	}
	if err != nil {
		return 0, nil, err
	}
	denied, err := blocked(r, tx, a.User.ID, in.UserID)
	if err != nil {
		return 0, nil, err
	}
	if denied || privacy == "nobody" {
		return 0, nil, fail(403, "contact_forbidden")
	}
	low, high := pair(a.User.ID, in.UserID)
	var friends bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM identity.friendships WHERE user_low=$1 AND user_high=$2)`, low, high).Scan(&friends); err != nil {
		return 0, nil, err
	}
	if friends {
		return 0, nil, fail(409, "already_friends")
	}
	previous, err := scanRequest(tx.QueryRow(r.Context(), requestSelect+`WHERE least(f.sender_id,f.recipient_id)=$1 AND greatest(f.sender_id,f.recipient_id)=$2 AND f.status='PENDING'`, low, high))
	if err == nil {
		if previous.Sender.ID != a.User.ID {
			return 0, nil, fail(409, "incoming_request_exists")
		}
		return 200, previous, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, err
	}
	id := newID()
	if _, err = tx.Exec(r.Context(), `INSERT INTO identity.friend_requests(id,sender_id,recipient_id) VALUES($1,$2,$3)`, id, a.User.ID, in.UserID); err != nil {
		return 0, nil, err
	}
	result, err := scanRequest(tx.QueryRow(r.Context(), requestSelect+`WHERE f.id=$1`, id))
	if err != nil {
		return 0, nil, err
	}
	if err = event(r.Context(), tx, "friend_request.created", id); err != nil {
		return 0, nil, err
	}
	return 201, result, tx.Commit(r.Context())
}
func (s *Server) updateRequest(r *http.Request, a c.AuthSession, path string) (int, any, error) {
	parts := strings.Split(path, "/")
	id, action := parts[0], "cancel"
	if len(parts) == 2 && r.Method == "POST" && oneOf(parts[1], "accept", "reject") {
		action = parts[1]
	} else if len(parts) != 1 || r.Method != "DELETE" {
		return 0, nil, fail(404, "not_found")
	}
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var sender, recipient string
	err = tx.QueryRow(r.Context(), `SELECT sender_id::text,recipient_id::text FROM identity.friend_requests WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)`, id, a.User.ID).Scan(&sender, &recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "not_found")
	}
	if err != nil {
		return 0, nil, err
	}
	if action == "cancel" && sender != a.User.ID || action != "cancel" && recipient != a.User.ID {
		return 0, nil, fail(403, "forbidden")
	}
	if err = pairLock(r, tx, sender, recipient); err != nil {
		return 0, nil, err
	}
	denied, err := blocked(r, tx, sender, recipient)
	if err != nil {
		return 0, nil, err
	}
	if denied {
		return 0, nil, fail(404, "not_found")
	}
	var current string
	if err = tx.QueryRow(r.Context(), `SELECT status FROM identity.friend_requests WHERE id=$1 FOR UPDATE`, id).Scan(&current); err != nil {
		return 0, nil, err
	}
	next, ok := transition(current, action)
	if !ok {
		return 0, nil, fail(409, "invalid_request_state")
	}
	if action == "accept" {
		denied, e := blocked(r, tx, sender, recipient)
		if e != nil {
			return 0, nil, e
		}
		if denied {
			return 0, nil, fail(403, "contact_forbidden")
		}
		var active bool
		if err = tx.QueryRow(r.Context(), `SELECT count(*)=2 FROM identity.users WHERE id IN($1,$2) AND state='active'`, sender, recipient).Scan(&active); err != nil {
			return 0, nil, err
		}
		if !active {
			return 0, nil, fail(403, "contact_forbidden")
		}

		if current == "PENDING" {
			low, high := pair(sender, recipient)
			if _, err = tx.Exec(r.Context(), `INSERT INTO identity.friendships(user_low,user_high) VALUES($1,$2) ON CONFLICT DO NOTHING`, low, high); err != nil {
				return 0, nil, err
			}
		}
	}
	if current != next {
		if _, err = tx.Exec(r.Context(), `UPDATE identity.friend_requests SET status=$2,updated_at=now() WHERE id=$1`, id, next); err != nil {
			return 0, nil, err
		}
		if err = event(r.Context(), tx, "friend_request."+strings.ToLower(next), id); err != nil {
			return 0, nil, err
		}
	}
	result, err := scanRequest(tx.QueryRow(r.Context(), requestSelect+`WHERE f.id=$1`, id))
	if err != nil {
		return 0, nil, err
	}
	return 200, result, tx.Commit(r.Context())
}
func (s *Server) relationship(r *http.Request, a c.AuthSession, id, action string) (int, any, error) {
	if !validID(id) || id == a.User.ID {
		return 0, nil, fail(400, "invalid_id")
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err = pairLock(r, tx, a.User.ID, id); err != nil {
		return 0, nil, err
	}
	var exists bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM identity.users WHERE id=$1)`, id).Scan(&exists); err != nil {
		return 0, nil, err
	}
	if !exists {
		return 0, nil, fail(404, "not_found")
	}
	low, high := pair(a.User.ID, id)
	switch action {
	case "block":
		if _, err = tx.Exec(r.Context(), `INSERT INTO identity.blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, a.User.ID, id); err != nil {
			return 0, nil, err
		}
		if _, err = tx.Exec(r.Context(), `UPDATE identity.friend_requests SET status='CANCELLED',updated_at=now() WHERE least(sender_id,recipient_id)=$1 AND greatest(sender_id,recipient_id)=$2 AND status='PENDING'`, low, high); err != nil {
			return 0, nil, err
		}
		fallthrough
	case "unfriend":
		if _, err = tx.Exec(r.Context(), `DELETE FROM identity.friendships WHERE user_low=$1 AND user_high=$2`, low, high); err != nil {
			return 0, nil, err
		}
	case "unblock":
		if _, err = tx.Exec(r.Context(), `DELETE FROM identity.blocks WHERE blocker_id=$1 AND blocked_id=$2`, a.User.ID, id); err != nil {
			return 0, nil, err
		}
	}
	if err = event(r.Context(), tx, "relationship."+action, a.User.ID); err != nil {
		return 0, nil, err
	}
	return 204, nil, tx.Commit(r.Context())
}
func (s *Server) eligibility(r *http.Request, a c.AuthSession, id string) (int, any, error) {
	if !validID(id) || id == a.User.ID {
		return 0, nil, fail(400, "invalid_id")
	}
	var allowed bool
	err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM identity.users u JOIN identity.user_settings st ON st.user_id=u.id WHERE u.id=$2 AND u.state='active' AND `+notBlocked+` AND (st.dm_policy='everyone' OR (st.dm_policy='friends' AND EXISTS(SELECT 1 FROM identity.friendships WHERE user_low=least($1::uuid,$2::uuid) AND user_high=greatest($1::uuid,$2::uuid)))))`, a.User.ID, id).Scan(&allowed)
	return 200, c.ContactEligibility{UserID: id, Allowed: allowed}, err
}
