package guild

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"sort"
	"strings"
	"time"

	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/config"
	"svyaz.local/foundation/services/api/internal/identity"
)

var mediaClient = &http.Client{Timeout: 23 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func (s *Server) mediaProxy(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	room, err := s.chatRoom(r, a, r.URL.Query().Get("room_kind"), r.URL.Query().Get("room_id"))
	if err != nil {
		return 0, nil, err
	}
	path := strings.TrimPrefix(r.URL.RequestURI(), "/api/v1")
	streaming := r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/") && strings.HasSuffix(r.URL.Path, "/content")
	var body io.Reader = r.Body
	digest := "stream"
	if !streaming {
		raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
		if e != nil {
			return 0, nil, fail(413, "payload_too_large")
		}
		if len(raw) > 0 {
			ct, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if e != nil || ct != "application/json" {
				return 0, nil, fail(400, "json_required")
			}
		}
		body = bytes.NewReader(raw)
		digest = hex.EncodeToString(hash(string(raw)))
	} else if r.ContentLength < 1 || r.ContentLength > 8<<20 {
		return 0, nil, fail(413, "invalid_file_size")
	}
	fence := identity.Fence(r.Context())
	grant := c.MediaGrant{SchemaVersion: 1, Audience: "media", UserID: a.User.ID, SessionID: a.SessionID, Method: r.Method, Path: path, BodyHash: digest, ExpiresAt: time.Now().Add(5 * time.Second).Unix(), Room: room, FencePid: fence.PID, FenceTransaction: fence.Transaction}
	raw, err := json.Marshal(grant)
	if err != nil {
		return 0, nil, err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	req, err := http.NewRequestWithContext(r.Context(), "POST", config.Env("MEDIA_URL", "http://media:8080")+"/internal/media", body)
	if err != nil {
		return 0, nil, err
	}
	if streaming {
		req.ContentLength = r.ContentLength
	}
	req.Header.Set("X-Svyaz-Media", payload+"."+base64.RawURLEncoding.EncodeToString(signature(s.MediaSecret, payload)))
	req.Header.Set("X-Request-ID", w.Header().Get("X-Request-ID"))
	response, err := mediaClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		var e c.ErrorResponse
		if json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&e) != nil {
			return 0, nil, fail(503, "media_unavailable")
		}
		return 0, nil, fail(response.StatusCode, e.Code)
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/attachments/") {
		content, err := io.ReadAll(io.LimitReader(response.Body, 8<<20+1))
		if err != nil || len(content) > 8<<20 {
			return 0, nil, fail(503, "media_unavailable")
		}
		headers := make(http.Header)
		for _, h := range []string{"Content-Type", "Content-Length", "Content-Disposition", "Content-Security-Policy"} {
			if v := response.Header.Get(h); v != "" {
				headers.Set(h, v)
			}
		}
		return response.StatusCode, identity.BinaryResponse{Headers: headers, Body: content}, nil
	}
	raw, err = io.ReadAll(io.LimitReader(response.Body, 65536))
	if err != nil || !json.Valid(raw) {
		return 0, nil, fail(503, "media_unavailable")
	}
	return response.StatusCode, json.RawMessage(raw), nil
}

func (s *Server) searchRooms(r *http.Request, a c.AuthSession) ([]c.SearchRoom, error) {
	q := r.URL.Query()
	scope := q.Get("scope")
	if scope == "" {
		scope = "all"
	}
	if scope != "all" && scope != "channels" && scope != "dm" {
		return nil, fail(400, "invalid_search")
	}
	gid, cid, did := q.Get("guild_id"), q.Get("channel_id"), q.Get("conversation_id")
	for _, id := range []string{gid, cid, did} {
		if id != "" && !validID(id) {
			return nil, fail(400, "invalid_id")
		}
	}
	if (did != "" && (gid != "" || cid != "" || scope == "channels")) || (scope == "dm" && (gid != "" || cid != "")) {
		return nil, fail(400, "invalid_search")
	}
	out := []c.SearchRoom{}
	if did == "" && scope != "dm" {
		rows, err := s.DB.Query(r.Context(), `SELECT guild_id::text FROM guild.guild_members WHERE user_id=$1 AND state='ACTIVE' AND ($2='' OR guild_id::text=$2) ORDER BY guild_id`, a.User.ID, gid)
		if err != nil {
			return nil, err
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			tx, err := s.DB.Begin(r.Context())
			if err != nil {
				return nil, err
			}
			state, _, err := load(r, tx, id, false)
			if err == nil {
				for _, ch := range state.Channels {
					if (cid == "" || ch.ID == cid) && Decide(a.User.ID, "READ_HISTORY", ch, state).Allowed {
						g := id
						out = append(out, c.SearchRoom{ID: ch.ID, Kind: "channel", Name: ch.ID, GuildID: &g})
					}
				}
			}
			_ = tx.Rollback(context.Background())

			if err != nil {
				var active bool
				if e := s.DB.QueryRow(r.Context(), `SELECT state='ACTIVE' FROM guild.guilds WHERE id=$1`, id).Scan(&active); e != nil || active {
					return nil, err
				}
			}
		}
	}
	if gid == "" && cid == "" && scope != "channels" {
		rows, err := s.DB.Query(r.Context(), `SELECT c.id::text,c.name FROM guild.conversations c JOIN guild.conversation_members m ON m.conversation_id=c.id WHERE m.user_id=$1 AND m.active AND ($2='' OR c.id::text=$2) ORDER BY c.id`, a.User.ID, did)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			v := c.SearchRoom{Kind: "conversation"}
			if err = rows.Scan(&v.ID, &v.Name); err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		if err = rows.Err(); err != nil {
			return nil, err
		}
	}
	if len(out) > 1000 {
		return nil, fail(400, "search_scope_too_wide")
	}
	ids := []string{}
	for _, v := range out {
		if v.Kind == "channel" {
			ids = append(ids, v.ID)
		}
	}
	names, err := s.DB.Query(r.Context(), `SELECT id::text,name FROM guild.channels WHERE id::text=ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	byID := map[string]string{}
	for names.Next() {
		var id, name string
		if err = names.Scan(&id, &name); err != nil {
			names.Close()
			return nil, err
		}
		byID[id] = name
	}
	err = names.Err()
	names.Close()
	if err != nil {
		return nil, err
	}
	for i := range out {
		if name, ok := byID[out[i].ID]; ok {
			out[i].Name = name
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (s *Server) searchProxy(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	if r.Method != "GET" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	rooms, err := s.searchRooms(r, a)
	if err != nil {
		return 0, nil, err
	}
	fence := identity.Fence(r.Context())
	grant := c.SearchGrant{SchemaVersion: 1, Audience: "search", UserID: a.User.ID, Path: strings.TrimPrefix(r.URL.RequestURI(), "/api/v1"), ExpiresAt: time.Now().Add(5 * time.Second).Unix(), FencePid: fence.PID, FenceTransaction: fence.Transaction, Rooms: rooms}
	raw, err := json.Marshal(grant)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", config.Env("REALTIME_URL", "http://realtime:8080")+"/internal/search", bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("X-Svyaz-Search", base64.RawURLEncoding.EncodeToString(signature(s.RealtimeSecret, string(raw))))
	req.Header.Set("X-Request-ID", w.Header().Get("X-Request-ID"))
	response, err := messagingClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || !json.Valid(raw) {
		return 0, nil, fail(503, "search_unavailable")
	}
	if response.StatusCode >= 400 {
		var e c.ErrorResponse
		if json.Unmarshal(raw, &e) != nil {
			return 0, nil, fail(503, "search_unavailable")
		}
		return 0, nil, fail(response.StatusCode, e.Code)
	}
	return response.StatusCode, json.RawMessage(raw), nil
}
