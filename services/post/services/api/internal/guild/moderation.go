package guild

import (
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
	"time"
	"unicode"
	"unicode/utf8"
)

func validReason(s string) bool {
	if !utf8.ValidString(s) || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > 500 {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}
func (g *transaction) auditReason(reason string) error {
	return g.exec(`UPDATE guild.audit_events SET reason=$3 WHERE guild_id=$1 AND revision=$2`, g.g.ID, g.g.Revision, reason)
}
func (g *transaction) removeMember(id string) error {
	for _, q := range []string{
		`UPDATE guild.guild_members SET state='KICKED' WHERE guild_id=$1 AND user_id=$2`,
		`DELETE FROM guild.member_roles WHERE guild_id=$1 AND user_id=$2`,
		`UPDATE guild.permission_overwrites SET allow_ops='{}' WHERE guild_id=$1 AND user_id=$2`,
	} {
		if err := g.exec(q, g.g.ID, id); err != nil {
			return err
		}
	}
	return nil
}
func (g *transaction) moderation(w http.ResponseWriter, p []string) (int, any, error) {
	if err := g.require("KICK_MEMBER", g.s.root()); err != nil {
		return 0, nil, err
	}
	if len(p) == 0 && g.r.Method == "GET" {
		out := c.ModerationList{Items: []c.ModerationRecord{}, Revision: g.g.Revision}
		rows, err := g.tx.Query(g.r.Context(), `SELECT id::text,guild_id::text,user_id::text,actor_id::text,kind,reason,created_at,expires_at,revoked_at,revocation_reason,target_position FROM guild.sanctions WHERE guild_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, g.g.ID)
		if err != nil {
			return 0, nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var v c.ModerationRecord
			var created time.Time
			var expires, revoked *time.Time
			var rank int64
			if err = rows.Scan(&v.ID, &v.GuildID, &v.UserID, &v.ActorID, &v.Kind, &v.Reason, &created, &expires, &revoked, &v.RevocationReason, &rank); err != nil {
				return 0, nil, err
			}
			v.CreatedAt = stamp(created)
			if expires != nil {
				t := stamp(*expires)
				v.ExpiresAt = &t
			}
			if revoked != nil {
				t := stamp(*revoked)
				v.RevokedAt = &t
			}
			v.Active = v.Kind != "KICK" && revoked == nil && (expires == nil || expires.After(time.Now()))
			v.CanRevoke = v.Active && g.s.canMember(g.a.User.ID, v.UserID) && (g.a.User.ID == g.s.OwnerID || g.s.highest(g.a.User.ID) > rank)
			out.Items = append(out.Items, v)
		}
		return 200, out, rows.Err()
	}
	if len(p) == 0 && g.r.Method == "POST" {
		var in c.ModerationInput
		if err := identity.DecodeRequired(w, g.r, &in, "user_id", "kind", "reason", "duration_seconds"); err != nil {
			return 0, nil, err
		}
		if !validID(in.UserID) || !validReason(in.Reason) || !contains([]string{"KICK", "BAN", "MUTE_TEXT", "MUTE_VOICE"}, in.Kind) || in.DurationSeconds < 0 || in.DurationSeconds > 2592000 || in.Kind == "KICK" && in.DurationSeconds != 0 {
			return 0, nil, fail(400, "invalid_sanction")
		}
		if g.s.Members[in.UserID].State != "ACTIVE" {
			return 0, nil, fail(404, "member_not_found")
		}
		if !g.s.canMember(g.a.User.ID, in.UserID) {
			return 0, nil, fail(403, "role_hierarchy")
		}
		if contains(g.s.Sanctions[in.UserID], in.Kind) {
			return 0, nil, fail(409, "sanction_exists")
		}
		var expires *time.Time
		if in.DurationSeconds > 0 {
			t := time.Now().Add(time.Duration(in.DurationSeconds) * time.Second)
			expires = &t
		}
		id := newID()
		if err := g.exec(`INSERT INTO guild.sanctions(id,guild_id,user_id,actor_id,target_position,kind,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, g.g.ID, in.UserID, g.a.User.ID, g.s.highest(in.UserID), in.Kind, in.Reason, expires); err != nil {
			return 0, nil, err
		}
		if in.Kind == "BAN" || in.Kind == "KICK" {
			if err := g.removeMember(in.UserID); err != nil {
				return 0, nil, err
			}
		}
		if err := g.touch("moderation."+strings.ToLower(in.Kind), in.UserID); err != nil {
			return 0, nil, err
		}
		if err := g.auditReason(in.Reason); err != nil {
			return 0, nil, err
		}
		return 201, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	if len(p) == 2 && p[1] == "revoke" && g.r.Method == "POST" && validID(p[0]) {
		var in c.ModerationRevoke
		if err := identity.DecodeRequired(w, g.r, &in, "reason"); err != nil {
			return 0, nil, err
		}
		if !validReason(in.Reason) {
			return 0, nil, fail(400, "invalid_reason")
		}
		var target, kind string
		var rank int64
		var active bool
		err := g.tx.QueryRow(g.r.Context(), `SELECT user_id::text,kind,target_position,revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FROM guild.sanctions WHERE id=$1 AND guild_id=$2`, p[0], g.g.ID).Scan(&target, &kind, &rank, &active)
		if err == pgx.ErrNoRows {
			return 0, nil, fail(404, "sanction_not_found")
		}
		if err != nil {
			return 0, nil, err
		}
		if !g.s.canMember(g.a.User.ID, target) || g.a.User.ID != g.s.OwnerID && g.s.highest(g.a.User.ID) <= rank {
			return 0, nil, fail(403, "role_hierarchy")
		}
		if kind == "KICK" {
			return 0, nil, fail(409, "kick_requires_invite")
		}
		if !active {
			return 200, c.GuildRevision{Revision: g.g.Revision}, nil
		}
		if err = g.exec(`UPDATE guild.sanctions SET revoked_at=now(),revoked_by=$3,revocation_reason=$4 WHERE id=$1 AND guild_id=$2`, p[0], g.g.ID, g.a.User.ID, in.Reason); err != nil {
			return 0, nil, err
		}
		if err = g.touch("moderation.revoked", target); err != nil {
			return 0, nil, err
		}
		if err = g.auditReason(in.Reason); err != nil {
			return 0, nil, err
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	return 0, nil, fail(404, "not_found")
}
