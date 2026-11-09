package guild

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/config"
	"svyaz.local/foundation/services/api/internal/identity"
)

var messagingClient = &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func (s *Server) chatRoom(r *http.Request, a c.AuthSession, kind, id string) (c.ChatRoom, error) {
	room := c.ChatRoom{ID: id, Kind: kind, Members: []c.ChatMember{}, Roles: []c.ChatMember{}}
	if !validID(id) {
		return room, fail(400, "invalid_id")
	}
	if kind == "conversation" {
		conv, err := s.conversation(r, a, id)
		if err != nil {
			return room, err
		}
		room.Name, room.Revision, room.Members = conv.Name, conv.Revision, conv.Members
		room.CanSend, err = s.compatible(r, conv.Members)
		room.CanDeliver, room.CanThread, room.CanManage = room.CanSend, room.CanSend, conv.Kind == "GROUP" && conv.OwnerID == a.User.ID
		room.CanAttach = &room.CanSend
		return room, err
	}
	if kind != "channel" {
		return room, fail(400, "invalid_room")
	}
	var gid string
	err := s.DB.QueryRow(r.Context(), `SELECT c.guild_id::text,c.name FROM guild.channels c
JOIN guild.guild_members m ON m.guild_id=c.guild_id AND m.user_id=$2 AND m.state='ACTIVE'
JOIN guild.guilds g ON g.id=c.guild_id AND g.state='ACTIVE' WHERE c.id=$1`, id, a.User.ID).Scan(&gid, &room.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return room, fail(404, "not_found")
	}
	if err != nil {
		return room, err
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return room, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	state, _, err := load(r, tx, gid, false)
	if err != nil {
		return room, err
	}
	resource := state.Channels[id]
	if !Decide(a.User.ID, "VIEW_CHANNEL", resource, state).Allowed {
		return room, fail(404, "not_found")
	}
	if !Decide(a.User.ID, "READ_HISTORY", resource, state).Allowed {
		return room, fail(403, "access_denied")
	}
	room.Revision = state.Revision
	room.CanSend = Decide(a.User.ID, "SEND_MESSAGES", resource, state).Allowed
	room.CanManage = Decide(a.User.ID, "MANAGE_MESSAGES", resource, state).Allowed
	room.CanThread = Decide(a.User.ID, "CREATE_THREAD", resource, state).Allowed
	canAttach := Decide(a.User.ID, "ATTACH_FILES", resource, state).Allowed && room.CanSend
	room.CanAttach = &canAttach
	room.CanDeliver = true
	rows, err := tx.Query(r.Context(), `SELECT u.id::text,u.display_name FROM guild.guild_members m JOIN identity.users u ON u.id=m.user_id WHERE m.guild_id=$1 AND m.state='ACTIVE' AND u.state='active' ORDER BY u.id`, gid)
	if err != nil {
		return room, err
	}
	defer rows.Close()
	for rows.Next() {
		var m c.ChatMember
		if err = rows.Scan(&m.ID, &m.Name); err != nil {
			return room, err
		}
		if Decide(m.ID, "VIEW_CHANNEL", resource, state).Allowed {
			room.Members = append(room.Members, m)
		}
	}
	for _, role := range state.Roles {
		room.Roles = append(room.Roles, c.ChatMember{ID: role.ID, Name: role.Name})
	}
	sort.Slice(room.Roles, func(i, j int) bool { return room.Roles[i].ID < room.Roles[j].ID })
	return room, rows.Err()
}

func (s *Server) messageProxy(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/"), "/")
	kind, id := r.URL.Query().Get("room_kind"), r.URL.Query().Get("room_id")
	if len(parts) >= 2 && (parts[0] == "channels" || parts[0] == "conversations") {
		kind, id = "channel", parts[1]
		if parts[0] == "conversations" {
			kind = "conversation"
		}
	}
	room, err := s.chatRoom(r, a, kind, id)
	if err != nil {
		return 0, nil, err
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32768))
	if err != nil {
		return 0, nil, fail(413, "payload_too_large")
	}
	if len(body) > 0 {
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			return 0, nil, fail(400, "json_required")
		}
	}
	return s.forwardChat(w, r, a, room, body, nil)
}
func (s *Server) forwardChat(w http.ResponseWriter, r *http.Request, a c.AuthSession, room c.ChatRoom, body []byte, hook *c.WebhookSender) (int, any, error) {
	expires := time.Now().Add(5 * time.Second).Unix()
	grant := c.ChatGrant{SchemaVersion: 1, Audience: "messaging", UserID: a.User.ID, SessionID: a.SessionID, Method: r.Method, Path: strings.TrimPrefix(r.URL.RequestURI(), "/api/v1"), BodyHash: hex.EncodeToString(hash(string(body))), ExpiresAt: expires, Room: room}
	grant.Webhook = hook
	fence := identity.Fence(r.Context())
	grant.FencePid, grant.FenceTransaction = fence.PID, fence.Transaction
	raw, err := json.Marshal(grant)
	if err != nil {
		return 0, nil, err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	token := payload + "." + base64.RawURLEncoding.EncodeToString(signature(s.RealtimeSecret, payload))
	req, err := http.NewRequestWithContext(r.Context(), "POST", config.Env("REALTIME_URL", "http://realtime:8080")+"/internal/chat", bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("X-Svyaz-Chat", token)
	req.Header.Set("X-Request-ID", w.Header().Get("X-Request-ID"))
	req.Header.Set("Content-Type", "application/json")
	response, err := messagingClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return 0, nil, err
	}
	if response.StatusCode == 204 {
		return 204, nil, nil
	}
	if response.StatusCode >= 400 {
		var e c.ErrorResponse
		if json.Unmarshal(raw, &e) != nil {
			return 0, nil, fail(503, "messaging_unavailable")
		}
		return 0, nil, fail(response.StatusCode, e.Code)
	}
	if !json.Valid(raw) {
		return 0, nil, fail(503, "messaging_unavailable")
	}
	return response.StatusCode, json.RawMessage(raw), nil
}

func (s *Server) conversation(r *http.Request, a c.AuthSession, id string) (c.Conversation, error) {
	conv := c.Conversation{Members: []c.ChatMember{}}
	if !validID(id) {
		return conv, fail(400, "invalid_id")
	}
	err := s.DB.QueryRow(r.Context(), `SELECT c.id::text,c.kind,c.name,c.owner_id::text,c.revision FROM guild.conversations c JOIN guild.conversation_members m ON m.conversation_id=c.id AND m.user_id=$2 AND m.active WHERE c.id=$1`, id, a.User.ID).Scan(&conv.ID, &conv.Kind, &conv.Name, &conv.OwnerID, &conv.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return conv, fail(404, "not_found")
	}
	if err != nil {
		return conv, err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT u.id::text,
CASE WHEN u.id<>$2::uuid AND EXISTS(SELECT 1 FROM identity.blocks b WHERE
  (b.blocker_id=$2 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$2))
THEN 'Blocked user' ELSE u.display_name END
FROM guild.conversation_members m JOIN identity.users u ON u.id=m.user_id
WHERE m.conversation_id=$1 AND m.active ORDER BY m.joined_at,u.id`, id, a.User.ID)
	if err != nil {
		return conv, err
	}
	defer rows.Close()
	for rows.Next() {
		var m c.ChatMember
		if err = rows.Scan(&m.ID, &m.Name); err != nil {
			return conv, err
		}
		conv.Members = append(conv.Members, m)
	}
	return conv, rows.Err()
}
func (s *Server) compatible(r *http.Request, members []c.ChatMember) (bool, error) {
	ids := []string{}
	for _, m := range members {
		ids = append(ids, m.ID)
	}
	var allowed bool
	err := s.DB.QueryRow(r.Context(), `SELECT NOT EXISTS (
    SELECT 1 FROM unnest($1::uuid[]) a CROSS JOIN unnest($1::uuid[]) b
    LEFT JOIN identity.users u ON u.id=b LEFT JOIN identity.user_settings st ON st.user_id=b
    WHERE a<>b AND (u.state IS DISTINCT FROM 'active' OR st.dm_policy IS NULL OR st.dm_policy='nobody'
      OR (st.dm_policy='friends' AND NOT EXISTS(SELECT 1 FROM identity.friendships WHERE user_low=least(a,b) AND user_high=greatest(a,b)))
      OR EXISTS(SELECT 1 FROM identity.blocks WHERE (blocker_id=a AND blocked_id=b) OR (blocker_id=b AND blocked_id=a))))`, ids).Scan(&allowed)
	return allowed, err
}
func (s *Server) conversations(w http.ResponseWriter, r *http.Request, a c.AuthSession, p []string) (int, any, error) {
	if len(p) == 0 && r.Method == "GET" {
		rows, err := s.DB.Query(r.Context(), `SELECT conversation_id::text FROM guild.conversation_members WHERE user_id=$1 AND active ORDER BY joined_at DESC LIMIT 100`, a.User.ID)
		if err != nil {
			return 0, nil, err
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return 0, nil, err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return 0, nil, err
		}
		out := c.ConversationList{Items: []c.Conversation{}}
		for _, id := range ids {
			conv, err := s.conversation(r, a, id)
			if err != nil {
				return 0, nil, err
			}
			out.Items = append(out.Items, conv)
		}
		return 200, out, nil
	}
	if len(p) == 0 && r.Method == "POST" {
		var in c.ConversationInput
		if err := identity.DecodeRequired(w, r, &in, "kind", "name", "member_ids"); err != nil {
			return 0, nil, err
		}
		if !validName(in.Name) || !contains([]string{"DM", "GROUP"}, in.Kind) || len(in.MemberIDs) < 1 || len(in.MemberIDs) > 9 || (in.Kind == "DM" && len(in.MemberIDs) != 1) {
			return 0, nil, fail(400, "invalid_conversation")
		}
		ids := []string{a.User.ID}
		members := []c.ChatMember{{ID: a.User.ID}}
		for _, id := range in.MemberIDs {
			if !validID(id) || contains(ids, id) {
				return 0, nil, fail(400, "invalid_members")
			}
			ids = append(ids, id)
			members = append(members, c.ChatMember{ID: id})
		}
		allowed, err := s.compatible(r, members)
		if err != nil {
			return 0, nil, err
		}
		if !allowed {
			return 0, nil, fail(403, "contact_not_allowed")
		}
		tx, err := s.DB.Begin(r.Context())
		if err != nil {
			return 0, nil, err
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		existingReceipt, digest, err := creationReceipt(r, tx, a.User.ID, "conversation", in)
		if err != nil {
			return 0, nil, err
		}
		if existingReceipt != "" {
			conv, err := s.conversation(r, a, existingReceipt)
			return 200, conv, err
		}
		var count int
		if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.conversations c JOIN guild.conversation_members m ON m.conversation_id=c.id WHERE c.owner_id=$1 AND m.user_id=$1 AND m.active`, a.User.ID).Scan(&count); err != nil {
			return 0, nil, err
		}
		if count >= 100 {
			return 0, nil, fail(409, "conversation_limit")
		}
		for _, id := range in.MemberIDs {
			if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.conversation_members WHERE user_id=$1 AND active`, id).Scan(&count); err != nil {
				return 0, nil, err
			}
			if count >= 100 {
				return 0, nil, fail(409, "conversation_limit")
			}
		}
		id := newID()
		var pair *string
		if in.Kind == "DM" {
			sort.Strings(ids)
			key := strings.Join(ids, ":")
			pair = &key
			var existing string
			err = tx.QueryRow(r.Context(), `SELECT id::text FROM guild.conversations WHERE pair_key=$1 FOR UPDATE`, key).Scan(&existing)
			if err == nil {
				var activeMembers int
				if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.conversation_members WHERE conversation_id=$1 AND active`, existing).Scan(&activeMembers); err != nil {
					return 0, nil, err
				}
				if activeMembers == 2 {
					id = existing
				} else {
					if _, err = tx.Exec(r.Context(), `UPDATE guild.conversations SET pair_key=NULL WHERE id=$1`, existing); err != nil {
						return 0, nil, err
					}
				}
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return 0, nil, err
			}
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO guild.conversations(id,kind,name,owner_id,pair_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET revision=guild.conversations.revision+1`, id, in.Kind, in.Name, a.User.ID, pair)
		if err != nil {
			return 0, nil, err
		}
		for _, uid := range ids {
			_, err = tx.Exec(r.Context(), `INSERT INTO guild.conversation_members(conversation_id,user_id) VALUES($1,$2) ON CONFLICT(conversation_id,user_id) DO UPDATE SET active=true`, id, uid)
			if err != nil {
				return 0, nil, err
			}
		}
		if err = saveCreation(r, tx, a.User.ID, "conversation", id, digest); err != nil {
			return 0, nil, err
		}
		if err = tx.Commit(r.Context()); err != nil {
			return 0, nil, err
		}
		conv, err := s.conversation(r, a, id)
		return 201, conv, err
	}
	if len(p) < 1 {
		return 0, nil, fail(404, "not_found")
	}
	conv, err := s.conversation(r, a, p[0])
	if err != nil {
		return 0, nil, err
	}
	if len(p) == 1 && r.Method == "GET" {
		return 200, conv, nil
	}
	if r.Header.Get("If-Match") != "\""+strconv.FormatInt(conv.Revision, 10)+"\"" {
		return 0, nil, fail(409, "version_conflict")
	}
	target := a.User.ID
	add := false
	if len(p) == 2 && p[1] == "leave" && r.Method == "POST" {
	} else if len(p) == 3 && p[1] == "members" && (r.Method == "PUT" || r.Method == "DELETE") {
		if conv.Kind != "GROUP" || conv.OwnerID != a.User.ID {
			return 0, nil, fail(403, "access_denied")
		}
		target = p[2]
		add = r.Method == "PUT"
		if !validID(target) || target == a.User.ID {
			return 0, nil, fail(400, "invalid_members")
		}
	} else {
		return 0, nil, fail(404, "not_found")
	}
	if add {
		for _, m := range conv.Members {
			if m.ID == target {
				return 200, conv, nil
			}
		}
		if len(conv.Members) >= 10 {
			return 0, nil, fail(409, "member_limit")
		}
		var count int
		if err = s.DB.QueryRow(r.Context(), `SELECT count(*) FROM guild.conversation_members WHERE user_id=$1 AND active`, target).Scan(&count); err != nil {
			return 0, nil, err
		}
		if count >= 100 {
			return 0, nil, fail(409, "conversation_limit")
		}
		allowed, err := s.compatible(r, append(conv.Members, c.ChatMember{ID: target}))
		if err != nil {
			return 0, nil, err
		}
		if !allowed {
			return 0, nil, fail(403, "contact_not_allowed")
		}
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(r.Context(), `INSERT INTO guild.conversation_members(conversation_id,user_id,active) VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET active=EXCLUDED.active`, conv.ID, target, add)
	if err != nil {
		return 0, nil, err
	}
	owner := conv.OwnerID
	if target == owner && !add {
		for _, m := range conv.Members {
			if m.ID != target {
				owner = m.ID
				break
			}
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE guild.conversations SET revision=revision+1,owner_id=$2,pair_key=CASE WHEN kind='DM' AND NOT $3 THEN NULL ELSE pair_key END WHERE id=$1`, conv.ID, owner, add)
	if err != nil {
		return 0, nil, err
	}
	return 204, nil, tx.Commit(r.Context())
}
