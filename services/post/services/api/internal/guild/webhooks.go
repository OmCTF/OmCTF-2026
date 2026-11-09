package guild

import (
	"crypto/hmac"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
	"time"
	"unicode/utf8"
)

const webhookColumns = `id::text,guild_id::text,channel_id::text,creator_id::text,name,avatar,created_at,revoked_at`

func scanWebhook(row interface{ Scan(...any) error }) (c.WebhookInfo, error) {
	var v c.WebhookInfo
	var created time.Time
	var revoked *time.Time
	err := row.Scan(&v.ID, &v.GuildID, &v.ChannelID, &v.CreatorID, &v.Name, &v.Avatar, &created, &revoked)
	v.CreatedAt = stamp(created)
	if revoked != nil {
		t := stamp(*revoked)
		v.RevokedAt = &t
	}
	return v, err
}
func (g *transaction) webhooks(w http.ResponseWriter, p []string) (int, any, error) {
	if len(p) == 0 && g.r.Method == "GET" {
		out := c.WebhookList{Items: []c.WebhookInfo{}, Revision: g.g.Revision}
		rows, err := g.tx.Query(g.r.Context(), `SELECT `+webhookColumns+` FROM guild.webhooks WHERE guild_id=$1 ORDER BY created_at,id LIMIT 100`, g.g.ID)
		if err != nil {
			return 0, nil, err
		}
		defer rows.Close()
		for rows.Next() {
			v, err := scanWebhook(rows)
			if err != nil {
				return 0, nil, err
			}
			if Decide(g.a.User.ID, "MANAGE_CHANNEL", g.s.Channels[v.ChannelID], g.s).Allowed {
				out.Items = append(out.Items, v)
			}
		}
		return 200, out, rows.Err()
	}
	if len(p) == 0 && g.r.Method == "POST" {
		var in c.WebhookInput
		if err := identity.DecodeRequired(w, g.r, &in, "channel_id", "name", "avatar"); err != nil {
			return 0, nil, err
		}
		resource, ok := g.s.Channels[in.ChannelID]
		if !ok || !contains([]string{"TEXT", "FORUM"}, resource.Kind) || !validName(in.Name) || !contains([]string{"violet", "mint", "amber", "rose", "sky"}, in.Avatar) {
			return 0, nil, fail(400, "invalid_webhook")
		}
		for _, op := range []string{"MANAGE_CHANNEL", "READ_HISTORY", "SEND_MESSAGES"} {
			if err := g.require(op, resource); err != nil {
				return 0, nil, err
			}
		}
		var count int
		if err := g.tx.QueryRow(g.r.Context(), `SELECT count(*) FROM guild.webhooks w JOIN guild.channels c ON c.id=w.channel_id WHERE w.guild_id=$1 AND w.revoked_at IS NULL AND c.state='ACTIVE'`, g.g.ID).Scan(&count); err != nil {
			return 0, nil, err
		}
		if count >= 20 {
			return 0, nil, fail(409, "webhook_limit")
		}
		id, secret := newID(), randomToken()
		if err := g.exec(`INSERT INTO guild.webhooks(id,guild_id,channel_id,creator_id,name,avatar,secret_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, g.g.ID, in.ChannelID, g.a.User.ID, in.Name, in.Avatar, hash(secret)); err != nil {
			return 0, nil, err
		}
		if err := g.touch("webhook.created", id); err != nil {
			return 0, nil, err
		}
		v, err := scanWebhook(g.tx.QueryRow(g.r.Context(), `SELECT `+webhookColumns+` FROM guild.webhooks WHERE id=$1`, id))
		return 201, c.WebhookSecret{Webhook: v, Secret: secret, Revision: g.g.Revision}, err
	}
	if len(p) < 1 || len(p) > 2 || !validID(p[0]) {
		return 0, nil, fail(404, "not_found")
	}
	v, err := scanWebhook(g.tx.QueryRow(g.r.Context(), `SELECT `+webhookColumns+` FROM guild.webhooks WHERE id=$1 AND guild_id=$2`, p[0], g.g.ID))
	if err == pgx.ErrNoRows {
		return 0, nil, fail(404, "webhook_unavailable")
	}
	if err != nil {
		return 0, nil, err
	}
	if err = g.require("MANAGE_CHANNEL", g.s.Channels[v.ChannelID]); err != nil {
		return 0, nil, err
	}
	if len(p) == 1 && g.r.Method == "DELETE" {
		if err = g.exec(`UPDATE guild.webhooks SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1`, v.ID); err != nil {
			return 0, nil, err
		}
		if err = g.touch("webhook.revoked", v.ID); err != nil {
			return 0, nil, err
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	if len(p) == 2 && p[1] == "rotate" && g.r.Method == "POST" {
		for _, op := range []string{"SEND_MESSAGES", "READ_HISTORY"} {
			if err = g.require(op, g.s.Channels[v.ChannelID]); err != nil {
				return 0, nil, err
			}
		}
		if v.RevokedAt != nil {
			var count int
			if err = g.tx.QueryRow(g.r.Context(), `SELECT count(*) FROM guild.webhooks w JOIN guild.channels c ON c.id=w.channel_id WHERE w.guild_id=$1 AND w.revoked_at IS NULL AND c.state='ACTIVE'`, g.g.ID).Scan(&count); err != nil {
				return 0, nil, err
			}
			if count >= 20 {
				return 0, nil, fail(409, "webhook_limit")
			}
		}
		secret := randomToken()
		if err = g.exec(`UPDATE guild.webhooks SET secret_hash=$2,revoked_at=NULL,creator_id=$3 WHERE id=$1`, v.ID, hash(secret), g.a.User.ID); err != nil {
			return 0, nil, err
		}
		if err = g.touch("webhook.rotated", v.ID); err != nil {
			return 0, nil, err
		}
		v.RevokedAt = nil
		v.CreatorID = g.a.User.ID
		return 200, c.WebhookSecret{Webhook: v, Secret: secret, Revision: g.g.Revision}, nil
	}
	return 0, nil, fail(405, "method_not_allowed")
}

func (s *Server) ExecuteWebhook(w http.ResponseWriter, r *http.Request) (int, any, error) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/hooks/")
	secret := strings.TrimPrefix(r.Header.Get("Authorization"), "Webhook ")
	if !validID(id) || !strings.HasPrefix(r.Header.Get("Authorization"), "Webhook ") || !validCode(secret) {
		return 0, nil, fail(404, "webhook_unavailable")
	}
	var stored []byte
	var channel, creator, name, avatar string
	err := s.DB.QueryRow(r.Context(), `SELECT secret_hash,channel_id::text,creator_id::text,name,avatar FROM guild.webhooks WHERE id=$1 AND revoked_at IS NULL`, id).Scan(&stored, &channel, &creator, &name, &avatar)
	if err == pgx.ErrNoRows || err == nil && !hmac.Equal(stored, hash(secret)) {
		return 0, nil, fail(404, "webhook_unavailable")
	}
	if err != nil {
		return 0, nil, err
	}
	actor := c.AuthSession{User: c.PublicProfile{ID: creator}}
	room, err := s.chatRoom(r, actor, "channel", channel)
	if err != nil {
		return 0, nil, err
	}
	var gid string
	if err = s.DB.QueryRow(r.Context(), `SELECT guild_id::text FROM guild.channels WHERE id=$1`, channel).Scan(&gid); err != nil {
		return 0, nil, err
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	state, _, err := load(r, tx, gid, false)
	if err != nil {
		return 0, nil, err
	}
	if !room.CanSend || !Decide(creator, "MANAGE_CHANNEL", state.Channels[channel], state).Allowed {
		return 0, nil, fail(403, "webhook_permission_lost")
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	var input c.WebhookSend
	if err = identity.DecodeRequired(w, r, &input, "client_id", "content"); err != nil {
		return 0, nil, err
	}
	if !validID(input.ClientID) || !utf8.ValidString(input.Content) || utf8.RuneCountInString(input.Content) > 2000 || strings.TrimSpace(input.Content) == "" {
		return 0, nil, fail(400, "invalid_message")
	}
	body, err := json.Marshal(c.ChatSend{ClientID: input.ClientID, Content: input.Content, Mentions: []c.ChatMention{}})
	if err != nil {
		return 0, nil, err
	}

	actor.User.ID = id
	actor.SessionID = id
	room.CanManage = false
	room.CanThread = false
	attach := false
	room.CanAttach = &attach
	request := r.Clone(r.Context())
	u := *r.URL
	request.URL = &u
	request.URL.Path = "/api/v1/channels/" + channel + "/messages"
	request.URL.RawQuery = ""
	return s.forwardChat(w, request, actor, room, body, &c.WebhookSender{ID: id, Name: name, Avatar: avatar})
}
