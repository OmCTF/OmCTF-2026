package guild

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
	"time"
)

func communityPage(r *http.Request) (int64, int, error) {
	before, limit := int64(0), 50
	if raw := r.URL.Query().Get("before"); raw != "" {
		n, e := strconv.ParseInt(raw, 10, 64)
		if e != nil || n < 1 || n > 9007199254740991 {
			return 0, 0, fail(400, "invalid_cursor")
		}
		before = n
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			return 0, 0, fail(400, "invalid_limit")
		}
		limit = n
	}
	return before, limit, nil
}
func (s *Server) community(w http.ResponseWriter, r *http.Request, a c.AuthSession, p []string) (int, any, error) {
	if len(p) == 0 {
		return 0, nil, fail(404, "not_found")
	}
	switch p[0] {
	case "rules":
		return s.notificationRules(w, r, a, p[1:])
	case "favorites":
		return s.favorites(r, a, p[1:])
	case "inbox":
		return s.inbox(r, a, p[1:])
	case "settings":
		if len(p) != 1 {
			break
		}
		if r.Method == "GET" {
			var v c.CommunitySettings
			err := s.DB.QueryRow(r.Context(), `SELECT coalesce((SELECT browser_notifications FROM guild.community_users WHERE user_id=$1),false)`, a.User.ID).Scan(&v.BrowserNotifications)
			return 200, v, err
		}
		if r.Method == "PUT" {
			var v c.CommunitySettings
			if err := identity.DecodeRequired(w, r, &v, "browser_notifications"); err != nil {
				return 0, nil, err
			}
			_, err := s.DB.Exec(r.Context(), `INSERT INTO guild.community_users(user_id,browser_notifications,revision) VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET browser_notifications=$2,revision=guild.community_users.revision+1`, a.User.ID, v.BrowserNotifications)
			return 200, v, err
		}
	}
	return 0, nil, fail(404, "not_found")
}
func (s *Server) notificationRules(w http.ResponseWriter, r *http.Request, a c.AuthSession, p []string) (int, any, error) {
	if len(p) == 0 && r.Method == "GET" {
		out := c.NotificationRuleList{Items: []c.NotificationRule{}}
		rows, err := s.DB.Query(r.Context(), `SELECT scope,scope_id,mode,mute_until FROM guild.notification_rules WHERE user_id=$1 ORDER BY scope,scope_id`, a.User.ID)
		if err != nil {
			return 0, nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var v c.NotificationRule
			var until *time.Time
			if err = rows.Scan(&v.Scope, &v.ScopeID, &v.Mode, &until); err != nil {
				return 0, nil, err
			}
			if until != nil {
				t := stamp(*until)
				v.MuteUntil = &t
			}
			out.Items = append(out.Items, v)
		}
		return 200, out, rows.Err()
	}
	if len(p) < 1 || len(p) > 2 || !contains([]string{"user", "guild", "channel"}, p[0]) {
		return 0, nil, fail(404, "not_found")
	}
	scope, id := p[0], ""
	if len(p) == 2 {
		id = p[1]
	}
	if scope == "user" && id != "" || scope != "user" && !validID(id) {
		return 0, nil, fail(400, "invalid_scope")
	}
	if r.Method == "DELETE" {
		_, err := s.DB.Exec(r.Context(), `DELETE FROM guild.notification_rules WHERE user_id=$1 AND scope=$2 AND scope_id=$3`, a.User.ID, scope, id)
		return 204, nil, err
	}
	if r.Method != "PUT" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	var in c.NotificationRuleInput
	if err := identity.DecodeRequired(w, r, &in, "mode", "duration_seconds"); err != nil {
		return 0, nil, err
	}
	if !contains([]string{"all", "mentions", "mute", "inherit"}, in.Mode) || in.DurationSeconds < 0 || in.DurationSeconds > 2592000 || in.Mode != "mute" && in.DurationSeconds != 0 {
		return 0, nil, fail(400, "invalid_notification_rule")
	}
	if scope != "user" {
		gid := id
		if scope == "channel" {
			if err := s.DB.QueryRow(r.Context(), `SELECT c.guild_id::text FROM guild.channels c
JOIN guild.guild_members m ON m.guild_id=c.guild_id AND m.user_id=$2 AND m.state='ACTIVE'
JOIN guild.guilds g ON g.id=c.guild_id AND g.state='ACTIVE' WHERE c.id=$1`, id, a.User.ID).Scan(&gid); err == pgx.ErrNoRows {
				return 0, nil, fail(404, "not_found")
			} else if err != nil {
				return 0, nil, err
			}
		}
		_, _, err := s.with(w, r, a, gid, false, func(g *transaction) (int, any, error) {
			if scope == "channel" {
				resource, ok := g.s.Channels[id]
				if !ok || !Decide(a.User.ID, "VIEW_CHANNEL", resource, g.s).Allowed {
					return 0, nil, fail(404, "not_found")
				}
			}
			return 200, nil, nil
		})
		if err != nil {
			return 0, nil, err
		}
	}
	var count int
	var exists bool
	if err := s.DB.QueryRow(r.Context(), `SELECT count(*),coalesce(bool_or(scope=$2 AND scope_id=$3),false) FROM guild.notification_rules WHERE user_id=$1`, a.User.ID, scope, id).Scan(&count, &exists); err != nil {
		return 0, nil, err
	}
	if count >= 500 && !exists {
		return 0, nil, fail(409, "notification_rule_limit")
	}
	var until *time.Time
	if in.Mode == "mute" && in.DurationSeconds > 0 {
		t := time.Now().Add(time.Duration(in.DurationSeconds) * time.Second)
		until = &t
	}
	_, err := s.DB.Exec(r.Context(), `INSERT INTO guild.notification_rules(user_id,scope,scope_id,mode,mute_until) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,scope,scope_id) DO UPDATE SET mode=$4,mute_until=$5,updated_at=clock_timestamp()`, a.User.ID, scope, id, in.Mode, until)
	v := c.NotificationRule{Scope: scope, ScopeID: id, Mode: in.Mode}
	if until != nil {
		t := stamp(*until)
		v.MuteUntil = &t
	}
	return 200, v, err
}

func (s *Server) favorites(r *http.Request, a c.AuthSession, p []string) (int, any, error) {
	if len(p) == 1 && validID(p[0]) && r.Method == "DELETE" {
		_, err := s.DB.Exec(r.Context(), `DELETE FROM guild.favorites WHERE user_id=$1 AND channel_id=$2`, a.User.ID, p[0])
		return 204, nil, err
	}
	if !(len(p) == 0 && r.Method == "GET" || len(p) == 1 && validID(p[0]) && r.Method == "PUT") {
		return 0, nil, fail(404, "not_found")
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	query := `SELECT c.id::text,c.guild_id::text,c.name,c.kind FROM guild.favorites f JOIN guild.channels c ON c.id=f.channel_id WHERE f.user_id=$1 ORDER BY f.created_at,c.id LIMIT 200`
	args := []any{a.User.ID}
	if len(p) == 1 {
		query = `SELECT id::text,guild_id::text,name,kind FROM guild.channels WHERE id=$1`
		args = []any{p[0]}
	}
	rows, err := tx.Query(r.Context(), query, args...)
	if err != nil {
		return 0, nil, err
	}
	candidates := []c.FavoriteChannel{}
	for rows.Next() {
		var v c.FavoriteChannel
		if err = rows.Scan(&v.ChannelID, &v.GuildID, &v.Name, &v.Kind); err != nil {
			rows.Close()
			return 0, nil, err
		}
		candidates = append(candidates, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, nil, err
	}
	out := c.FavoriteList{Items: []c.FavoriteChannel{}}
	states := map[string]State{}
	for _, v := range candidates {
		state, ok := states[v.GuildID]
		if !ok {
			state, _, err = load(r, tx, v.GuildID, false)
			if identity.ErrorStatus(err) == 404 {
				continue
			}
			if err != nil {
				return 0, nil, err
			}
			states[v.GuildID] = state
		}
		if Decide(a.User.ID, "VIEW_CHANNEL", state.Channels[v.ChannelID], state).Allowed {
			out.Items = append(out.Items, v)
		}
	}
	if len(p) == 1 {
		if len(out.Items) == 0 {
			return 0, nil, fail(403, "channel_hidden")
		}
		var count int
		var exists bool
		if err = tx.QueryRow(r.Context(), `SELECT count(*),coalesce(bool_or(channel_id=$2),false) FROM guild.favorites WHERE user_id=$1`, a.User.ID, p[0]).Scan(&count, &exists); err != nil {
			return 0, nil, err
		}
		if count >= 200 && !exists {
			return 0, nil, fail(409, "favorite_limit")
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO guild.favorites(user_id,channel_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, a.User.ID, p[0]); err != nil {
			return 0, nil, err
		}
	}
	return 200, out, tx.Commit(r.Context())
}

type notificationRow struct {
	item   c.InboxItem
	author string
}

func scanNotification(row interface{ Scan(...any) error }) (notificationRow, error) {
	var v notificationRow
	var created time.Time
	err := row.Scan(&v.item.ID, &v.item.Sequence, &v.item.MessageID, &v.item.RoomID, &v.item.RoomKind, &v.item.GuildID, &v.item.ThreadID, &v.author, &v.item.Mention, &created, &v.item.Read)
	v.item.CreatedAt = stamp(created)
	return v, err
}

const inboxColumns = `id::text,sequence,message_id::text,room_id::text,room_kind,guild_id::text,thread_id::text,author_id::text,mention,created_at,read_at IS NOT NULL`

func (s *Server) inbox(r *http.Request, a c.AuthSession, p []string) (int, any, error) {
	before, limit, err := communityPage(r)
	if err != nil {
		return 0, nil, err
	}
	query := `SELECT ` + inboxColumns + ` FROM guild.notifications WHERE user_id=$1 AND ($2::bigint=0 OR sequence<$2) AND created_at>now()-interval '30 days' ORDER BY sequence DESC LIMIT $3`
	args := []any{a.User.ID, before, limit}
	if len(p) > 0 {
		if len(p) != 2 || !validID(p[0]) || !(p[1] == "read" && r.Method == "PUT" || p[1] == "claim" && r.Method == "POST") {
			return 0, nil, fail(404, "not_found")
		}
		query = `SELECT ` + inboxColumns + ` FROM guild.notifications WHERE user_id=$1 AND id=$2 AND created_at>now()-interval '30 days'`
		args = []any{a.User.ID, p[0]}
	} else if r.Method != "GET" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	rows, err := s.DB.Query(r.Context(), query, args...)
	if err != nil {
		return 0, nil, err
	}
	candidates := []notificationRow{}
	for rows.Next() {
		v, e := scanNotification(rows)
		if e != nil {
			rows.Close()
			return 0, nil, e
		}
		candidates = append(candidates, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, nil, err
	}
	out := c.InboxPage{Items: []c.InboxItem{}}
	rooms := map[string]c.ChatRoom{}
	missing := map[string]bool{}
	for _, v := range candidates {
		room, ok := rooms[v.item.RoomID]
		if !ok && !missing[v.item.RoomID] {
			room, err = s.chatRoom(r, a, v.item.RoomKind, v.item.RoomID)
			if err != nil {
				if code := identity.ErrorStatus(err); code == 403 || code == 404 {
					missing[v.item.RoomID] = true
					continue
				}
				return 0, nil, err
			}
			rooms[v.item.RoomID] = room
		}
		if missing[v.item.RoomID] || !room.CanDeliver {
			continue
		}
		created, _ := time.Parse(time.RFC3339Nano, v.item.CreatedAt)
		gid := ""
		if v.item.GuildID != nil {
			gid = *v.item.GuildID
		}
		allowed, err := s.notificationAllowed(r.Context(), s.DB, a.User.ID, gid, v.item.RoomID, v.author, v.item.Mention, created)
		if err != nil {
			return 0, nil, err
		}
		if !allowed {
			continue
		}
		var exists bool
		if err = s.DB.QueryRow(r.Context(), `SELECT guild.notification_source($1)`, v.item.MessageID).Scan(&exists); err != nil {
			return 0, nil, err
		}
		if !exists {
			continue
		}
		v.item.Name = room.Name
		out.Items = append(out.Items, v.item)
	}
	if len(p) > 0 {
		if len(out.Items) == 0 {
			return 0, nil, fail(404, "notification_unavailable")
		}
		if p[1] == "read" {
			_, err = s.DB.Exec(r.Context(), `UPDATE guild.notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2`, p[0], a.User.ID)
			return 204, nil, err
		}

		tag, e := s.DB.Exec(r.Context(), `UPDATE guild.notifications SET browser_claimed_at=now() WHERE id=$1 AND user_id=$2 AND browser_claimed_at IS NULL AND read_at IS NULL AND created_at>now()-interval '2 minutes' AND EXISTS(SELECT 1 FROM guild.community_users WHERE user_id=$2 AND browser_notifications)`, p[0], a.User.ID)
		return 200, c.NotificationClaim{Claimed: e == nil && tag.RowsAffected() == 1}, e
	}
	if len(candidates) == limit {
		cursor := strconv.FormatInt(candidates[len(candidates)-1].item.Sequence, 10)
		out.NextCursor = &cursor
	}
	err = s.DB.QueryRow(r.Context(), `SELECT coalesce((SELECT revision FROM guild.community_users WHERE user_id=$1),0)`, a.User.ID).Scan(&out.Revision)
	return 200, out, err
}
