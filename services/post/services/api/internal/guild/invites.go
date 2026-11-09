package guild

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"time"
)

func (g *transaction) invite(id string) (c.GuildInvite, error) {
	var v c.GuildInvite
	var expires time.Time
	err := g.tx.QueryRow(g.r.Context(), `SELECT id::text,guild_id::text,creator_id::text,channel_id::text,max_uses,uses,expires_at,revoked_at IS NOT NULL FROM guild.invites WHERE id=$1 AND guild_id=$2`, id, g.g.ID).Scan(&v.ID, &v.GuildID, &v.CreatorID, &v.ChannelID, &v.MaxUses, &v.Uses, &expires, &v.Revoked)
	v.ExpiresAt = stamp(expires)
	return v, err
}
func (g *transaction) invites() (int, any, error) {
	if err := g.require("MANAGE_GUILD", g.s.root()); err != nil {
		return 0, nil, err
	}
	rows, err := g.tx.Query(g.r.Context(), `SELECT id::text FROM guild.invites WHERE guild_id=$1 ORDER BY created_at DESC,id`, g.g.ID)
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
	result := c.GuildInviteList{Items: []c.GuildInvite{}, Revision: g.g.Revision}
	for _, id := range ids {
		v, e := g.invite(id)
		if e != nil {
			return 0, nil, e
		}
		result.Items = append(result.Items, v)
	}
	return 200, result, nil
}
func (g *transaction) createInvite(w http.ResponseWriter) (int, any, error) {
	var in c.InviteInput
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if !validID(in.ChannelID) || in.MaxUses < 1 || in.MaxUses > 1000 || in.TtlSeconds < 60 || in.TtlSeconds > 604800 {
		return 0, nil, fail(400, "invalid_invite")
	}
	resource, ok := g.s.Channels[in.ChannelID]
	if !ok || resource.State != "ACTIVE" {
		return 0, nil, fail(404, "channel_not_found")
	}
	if err := g.require("CREATE_INVITE", resource); err != nil {
		return 0, nil, err
	}
	if !g.g.InvitesEnabled {
		return 0, nil, fail(403, "invites_disabled")
	}
	var count int
	if err := g.tx.QueryRow(g.r.Context(), `SELECT count(*) FROM guild.invites i JOIN guild.channels c ON c.id=i.channel_id WHERE i.guild_id=$1 AND i.revoked_at IS NULL AND i.expires_at>now() AND i.uses<i.max_uses AND c.state='ACTIVE'`, g.g.ID).Scan(&count); err != nil {
		return 0, nil, err
	}
	if count >= 1000 {
		return 0, nil, fail(409, "invite_limit")
	}
	id, code := newID(), randomToken()
	if err := g.exec(`INSERT INTO guild.invites(id,guild_id,creator_id,channel_id,code_hash,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(secs=>$7))`, id, g.g.ID, g.a.User.ID, in.ChannelID, hash(code), in.MaxUses, float64(in.TtlSeconds)); err != nil {
		return 0, nil, err
	}
	if err := g.touch("invite.created", id); err != nil {
		return 0, nil, err
	}
	v, err := g.invite(id)
	return 201, c.CreatedInvite{Invite: v, Code: code, Revision: g.g.Revision}, err
}
func (g *transaction) revokeInvite(id string) (int, any, error) {
	v, err := g.invite(id)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "invite_not_found")
	}
	if err != nil {
		return 0, nil, err
	}
	if v.CreatorID != g.a.User.ID {
		if err = g.require("MANAGE_GUILD", g.s.root()); err != nil {
			return 0, nil, err
		}
	}
	if err = g.exec(`UPDATE guild.invites SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1`, id); err != nil {
		return 0, nil, err
	}
	if err = g.touch("invite.revoked", id); err != nil {
		return 0, nil, err
	}
	return 200, c.GuildRevision{Revision: g.g.Revision}, nil
}
func validCode(code string) bool {
	b, e := base64.RawURLEncoding.DecodeString(code)
	return len(code) == 43 && len(b) == 32 && e == nil
}
func (s *Server) preview(r *http.Request, code string) (int, any, error) {
	if !validCode(code) {
		return 0, nil, fail(404, "invite_unavailable")
	}
	var v c.InvitePreview
	var expires time.Time
	err := s.DB.QueryRow(r.Context(), `SELECT g.id::text,g.name,g.icon,i.expires_at FROM guild.invites i JOIN guild.guilds g ON g.id=i.guild_id JOIN guild.channels ch ON ch.id=i.channel_id WHERE i.code_hash=$1 AND g.state='ACTIVE' AND g.invites_enabled AND ch.state='ACTIVE' AND i.revoked_at IS NULL AND i.expires_at>now() AND i.uses<i.max_uses`, hash(code)).Scan(&v.GuildID, &v.Name, &v.Icon, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "invite_unavailable")
	}
	v.ExpiresAt = stamp(expires)
	return 200, v, err
}
func (s *Server) accept(w http.ResponseWriter, r *http.Request, a c.AuthSession, code string) (int, any, error) {
	if !validCode(code) {
		return 0, nil, fail(404, "invite_unavailable")
	}
	key := r.Header.Get("Idempotency-Key")
	if !validID(key) {
		return 0, nil, fail(400, "idempotency_key_required")
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "guild-user:"+a.User.ID); err != nil {
		return 0, nil, err
	}
	var id, gid string
	err = tx.QueryRow(r.Context(), `SELECT id::text,guild_id::text FROM guild.invites WHERE code_hash=$1`, hash(code)).Scan(&id, &gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fail(404, "invite_unavailable")
	}
	if err != nil {
		return 0, nil, err
	}
	var previousID string
	var previous []byte
	var banned bool
	if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM guild.sanctions WHERE guild_id=$1 AND user_id=$2 AND kind='BAN' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()))`, gid, a.User.ID).Scan(&banned); err != nil {
		return 0, nil, err
	}
	if banned {
		return 0, nil, fail(403, "guild_banned")
	}
	err = tx.QueryRow(r.Context(), `SELECT invite_id::text,response FROM guild.invite_attempts WHERE user_id=$1 AND attempt_id=$2`, a.User.ID, key).Scan(&previousID, &previous)
	if err == nil {
		if previousID != id {
			return 0, nil, fail(409, "idempotency_conflict")
		}
		var active bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM guild.guild_members WHERE guild_id=$1 AND user_id=$2 AND state='ACTIVE')`, gid, a.User.ID).Scan(&active); err != nil {
			return 0, nil, err
		}
		if !active {
			return 0, nil, fail(409, "membership_changed")
		}
		var result c.InviteAccepted
		if err = json.Unmarshal(previous, &result); err != nil {
			return 0, nil, err
		}
		return 200, result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, err
	}
	state, info, err := load(r, tx, gid, true)
	if err != nil {
		return 0, nil, err
	}
	g := &transaction{tx: tx, r: r, a: a, s: state, g: info, server: s}
	var available bool
	err = tx.QueryRow(r.Context(), `SELECT i.revoked_at IS NULL AND i.expires_at>now() AND i.uses<i.max_uses AND c.state='ACTIVE' FROM guild.invites i JOIN guild.channels c ON c.id=i.channel_id WHERE i.id=$1`, id).Scan(&available)
	if err != nil {
		return 0, nil, err
	}
	if !available || !g.g.InvitesEnabled {
		return 0, nil, fail(404, "invite_unavailable")
	}
	joined := state.Members[a.User.ID].State == "ACTIVE"
	if !joined {
		var users, memberships int
		if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.guild_members WHERE guild_id=$1 AND state='ACTIVE'`, gid).Scan(&users); err != nil {
			return 0, nil, err
		}
		if users >= 200 {
			return 0, nil, fail(409, "member_limit")
		}
		if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.guild_members WHERE user_id=$1 AND state='ACTIVE'`, a.User.ID).Scan(&memberships); err != nil {
			return 0, nil, err
		}
		if memberships >= 100 {
			return 0, nil, fail(409, "membership_limit")
		}
		if err = g.exec(`INSERT INTO guild.guild_members(guild_id,user_id) VALUES($1,$2) ON CONFLICT(guild_id,user_id) DO UPDATE SET state='ACTIVE',joined_at=now()`, gid, a.User.ID); err != nil {
			return 0, nil, err
		}
		if err = g.exec(`UPDATE guild.invites SET uses=uses+1 WHERE id=$1`, id); err != nil {
			return 0, nil, err
		}
		if err = g.touch("member.joined", a.User.ID); err != nil {
			return 0, nil, err
		}
	}
	result := c.InviteAccepted{GuildID: gid, AlreadyMember: joined, Revision: g.g.Revision}
	if joined {
		return 200, result, nil
	}
	body, _ := json.Marshal(result)
	if err = g.exec(`INSERT INTO guild.invite_attempts(user_id,attempt_id,invite_id,response) VALUES($1,$2,$3,$4)`, a.User.ID, key, id, body); err != nil {
		return 0, nil, err
	}
	if err = g.exec(`DELETE FROM guild.invite_attempts WHERE user_id=$1 AND attempt_id NOT IN (
		SELECT attempt_id FROM guild.invite_attempts WHERE user_id=$1
		ORDER BY created_at DESC,attempt_id DESC LIMIT 128
	)`, a.User.ID); err != nil {
		return 0, nil, err
	}
	return 200, result, tx.Commit(r.Context())
}
func (g *transaction) confirmation(w http.ResponseWriter) (int, any, error) {
	if g.a.User.ID != g.s.OwnerID {
		return 0, nil, fail(403, "owner_required")
	}
	var in c.ConfirmationInput
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if in.Action == "TRANSFER_OWNER" {
		if in.TargetUserID == nil || !validID(*in.TargetUserID) || *in.TargetUserID == g.s.OwnerID {
			return 0, nil, fail(400, "invalid_owner")
		}
		if g.s.Members[*in.TargetUserID].State != "ACTIVE" || len(g.s.Sanctions[*in.TargetUserID]) > 0 {
			return 0, nil, fail(404, "member_not_found")
		}
	} else if in.Action != "DELETE_GUILD" || in.TargetUserID != nil {
		return 0, nil, fail(400, "invalid_confirmation")
	}
	if err := g.exec(`DELETE FROM guild.confirmations WHERE guild_id=$1 AND expires_at<now()`, g.g.ID); err != nil {
		return 0, nil, err
	}
	var count int
	if err := g.tx.QueryRow(g.r.Context(), `SELECT count(*) FROM guild.confirmations WHERE guild_id=$1`, g.g.ID).Scan(&count); err != nil {
		return 0, nil, err
	}
	if count >= 10 {
		return 0, nil, fail(429, "confirmation_limit")
	}
	id, token := newID(), randomToken()
	expires := time.Now().Add(time.Minute)
	if err := g.exec(`INSERT INTO guild.confirmations(id,guild_id,user_id,session_id,token_hash,action,target_user_id,revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, g.g.ID, g.a.User.ID, g.a.SessionID, hash(token), in.Action, in.TargetUserID, g.g.Revision, expires); err != nil {
		return 0, nil, err
	}
	return 201, c.GuildConfirmation{ID: id, Token: token, Action: in.Action, TargetUserID: in.TargetUserID, Revision: g.g.Revision, ExpiresAt: stamp(expires)}, nil
}
func (g *transaction) confirmed(w http.ResponseWriter, action string) (int, any, error) {
	if g.a.User.ID != g.s.OwnerID {
		return 0, nil, fail(403, "owner_required")
	}
	var in c.ConfirmationProof
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if !validID(in.ConfirmationID) || !validCode(in.ConfirmationToken) {
		return 0, nil, fail(400, "confirmation_required")
	}
	var tokenHash []byte
	var target *string
	err := g.tx.QueryRow(g.r.Context(), `SELECT token_hash,target_user_id FROM guild.confirmations WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND session_id=$4 AND revision=$5 AND action=$6 AND consumed_at IS NULL AND expires_at>now()`, in.ConfirmationID, g.g.ID, g.a.User.ID, g.a.SessionID, g.g.Revision, action).Scan(&tokenHash, &target)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !hmac.Equal(tokenHash, hash(in.ConfirmationToken)) {
		return 0, nil, fail(403, "confirmation_invalid")
	}
	if err != nil {
		return 0, nil, err
	}
	if action == "TRANSFER_OWNER" {
		if target == nil || g.s.Members[*target].State != "ACTIVE" || len(g.s.Sanctions[*target]) > 0 {
			return 0, nil, fail(409, "owner_target_inactive")
		}
		if err = g.exec(`UPDATE guild.guilds SET owner_id=$2 WHERE id=$1`, g.g.ID, *target); err != nil {
			return 0, nil, err
		}
	} else {
		for _, q := range []string{`UPDATE guild.guilds SET state='DELETED' WHERE id=$1`, `UPDATE guild.guild_members SET state='LEFT' WHERE guild_id=$1`, `UPDATE guild.channels SET state='ARCHIVED' WHERE guild_id=$1`, `UPDATE guild.categories SET state='ARCHIVED' WHERE guild_id=$1`, `UPDATE guild.invites SET revoked_at=coalesce(revoked_at,now()) WHERE guild_id=$1`} {
			if err = g.exec(q, g.g.ID); err != nil {
				return 0, nil, err
			}
		}
	}
	if err = g.exec(`UPDATE guild.confirmations SET consumed_at=now() WHERE id=$1`, in.ConfirmationID); err != nil {
		return 0, nil, err
	}
	if err = g.touch(action, g.g.ID); err != nil {
		return 0, nil, err
	}
	return 200, c.GuildRevision{Revision: g.g.Revision}, nil
}
func (g *transaction) access(resource Resource) (int, any, error) {
	op := g.r.URL.Query().Get("operation")
	if !contains(Operations, op) {
		return 0, nil, fail(400, "unknown_operation")
	}
	if !Decide(g.a.User.ID, "VIEW_CHANNEL", resource, g.s).Allowed {
		return 0, nil, fail(403, "channel_hidden")
	}
	d := Decide(g.a.User.ID, op, resource, g.s)
	if d.Reason == "wrong_channel_type" {
		return 0, nil, fail(400, d.Reason)
	}
	result := c.ChannelAccess{Allowed: d.Allowed, Reason: d.Reason, GuildID: g.g.ID, ResourceID: resource.ID, Operation: op, Revision: g.g.Revision}
	if d.Allowed {
		audience := g.r.URL.Query().Get("audience")
		secret := g.server.RealtimeSecret
		if audience == "voice" {
			secret = g.server.VoiceSecret
			if op != "CONNECT_VOICE" {
				return 0, nil, fail(400, "invalid_audience_operation")
			}
		} else if audience != "realtime" || op != "VIEW_CHANNEL" {
			return 0, nil, fail(400, "invalid_audience_operation")
		}
		now := time.Now()
		end := now.Add(30 * time.Second)
		accessEnd, err := time.Parse(time.RFC3339Nano, g.a.AccessExpiresAt)
		if err != nil {
			return 0, nil, err
		}
		if end.After(accessEnd) {
			end = accessEnd
		}
		claims := c.ChannelGrantClaims{SchemaVersion: 1, JTI: newID(), Issuer: "api", Subject: g.a.User.ID, SessionID: g.a.SessionID, Audience: audience, Action: op, ResourceID: resource.ID, GuildID: g.g.ID, ACLRevision: g.g.Revision, IssuedAtUnix: now.Unix(), ExpiresAtUnix: end.Unix()}
		body, _ := json.Marshal(claims)
		encoded := base64.RawURLEncoding.EncodeToString(body)
		token := encoded + "." + base64.RawURLEncoding.EncodeToString(signature(secret, encoded))
		result.Capability = &token
	}
	return 200, result, nil
}
