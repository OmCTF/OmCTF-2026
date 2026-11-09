package guild

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"net/http"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
	"time"
)

type notificationDB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}
type notificationRule struct {
	scope, mode string
	until       *time.Time
}

func notificationMode(rules []notificationRule, mentioned bool, now time.Time) bool {
	mode := "all"
	for _, scope := range []string{"user", "guild", "channel"} {
		for _, r := range rules {
			if r.scope != scope {
				continue
			}
			if r.mode == "mute" {
				if r.until == nil || r.until.After(now) {
					return false
				}
				continue
			}
			if r.mode != "inherit" {
				mode = r.mode
			}
		}
	}
	return mode == "all" || mode == "mentions" && mentioned
}
func (s *Server) notificationAllowed(ctx context.Context, db notificationDB, user, guild, room, author string, mentioned bool, created time.Time) (bool, error) {
	var eligible bool
	err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM identity.users u LEFT JOIN guild.community_users cu ON cu.user_id=u.id WHERE u.id=$1 AND u.state='active' AND coalesce(cu.policy_changed_at,'-infinity')<=$3) AND NOT EXISTS(SELECT 1 FROM identity.blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))`, user, author, created).Scan(&eligible)
	if err != nil || !eligible {
		return false, err
	}
	rows, err := db.Query(ctx, `SELECT scope,mode,mute_until FROM guild.notification_rules WHERE user_id=$1 AND ((scope='user' AND scope_id='') OR (scope='guild' AND scope_id=$2) OR (scope='channel' AND scope_id=$3))`, user, guild, room)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	rules := []notificationRule{}
	for rows.Next() {
		var rule notificationRule
		if err = rows.Scan(&rule.scope, &rule.mode, &rule.until); err != nil {
			return false, err
		}
		rules = append(rules, rule)
	}
	return notificationMode(rules, mentioned, time.Now()), rows.Err()
}

func (s *Server) RunCommunity(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	cleanup := time.NewTicker(time.Hour)
	defer cleanup.Stop()
	metrics := time.NewTicker(10 * time.Second)
	defer metrics.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-metrics.C:
			child, cancel := context.WithTimeout(ctx, time.Second)
			var pending int64
			var oldest float64
			err := s.DB.QueryRow(child, `SELECT count(*),coalesce(extract(epoch FROM now()-min(created_at)),0)::float8 FROM guild.notification_jobs WHERE delivered_at IS NULL`).Scan(&pending, &oldest)
			cancel()
			if err != nil {
				logger.Warn("queue_metrics_unavailable")
			} else {
				logger.Info("queue_metrics", "pending", pending, "oldest_seconds", oldest)
			}
		case <-ticker.C:
			for i := 0; i < 10; i++ {
				child, cancel := context.WithTimeout(ctx, 3*time.Second)
				worked, err := s.deliverNotification(child)
				cancel()
				if err != nil {
					logger.Warn("notification_delivery_retry")
					break
				}
				if !worked {
					break
				}
			}
		case <-cleanup.C:
			child, cancel := context.WithTimeout(ctx, 3*time.Second)
			_, err := s.DB.Exec(child, `DELETE FROM guild.notifications WHERE created_at<now()-interval '30 days' OR id IN(SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY user_id ORDER BY sequence DESC) AS rank FROM guild.notifications) n WHERE rank>1000)`)
			if err == nil {
				_, err = s.DB.Exec(child, `DELETE FROM guild.notification_jobs WHERE created_at<now()-interval '30 days'`)
			}
			cancel()
			if err != nil {
				logger.Warn("notification_retention_retry")
			}
		}
	}
}
func (s *Server) deliverNotification(ctx context.Context) (bool, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err = tx.Exec(ctx, `SET LOCAL statement_timeout='2000ms'`); err != nil {
		return false, err
	}
	var locked bool
	if err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock_shared(73191504)`).Scan(&locked); err != nil {
		return false, err
	}
	if !locked {
		return false, nil
	}
	var mid, room, kind, author string
	var thread *string
	var revision int64
	var created time.Time
	var mentionsRaw []byte
	err = tx.QueryRow(ctx, `SELECT message_id::text,room_id::text,room_kind,author_id::text,thread_id::text,policy_revision,created_at,mentions FROM guild.notification_jobs WHERE delivered_at IS NULL ORDER BY created_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&mid, &room, &kind, &author, &thread, &revision, &created, &mentionsRaw)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	finish := func() (bool, error) {
		if _, e := tx.Exec(ctx, `UPDATE guild.notification_jobs SET delivered_at=now() WHERE message_id=$1`, mid); e != nil {
			return false, e
		}
		return true, tx.Commit(ctx)
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT guild.notification_source($1)`, mid).Scan(&exists); err != nil {
		return false, err
	}
	if !exists {
		return finish()
	}
	mentions := []c.ChatMention{}
	if err = json.Unmarshal(mentionsRaw, &mentions); err != nil {
		return false, err
	}
	r, _ := http.NewRequestWithContext(ctx, "GET", "http://internal", nil)
	gid := ""
	state := State{}
	members := []c.ChatMember{}
	if kind == "channel" {
		if err = tx.QueryRow(ctx, `SELECT guild_id::text FROM guild.channels WHERE id=$1`, room).Scan(&gid); err != nil {
			return false, err
		}
		state, _, err = load(r, tx, gid, false)
		if err != nil {
			if identity.ErrorStatus(err) == 404 {
				return finish()
			}
			return false, err
		}
		for id, m := range state.Members {
			if m.State == "ACTIVE" && Decide(id, "READ_HISTORY", state.Channels[room], state).Allowed {
				members = append(members, c.ChatMember{ID: id})
			}
		}
	} else {
		var current int64
		if err = tx.QueryRow(ctx, `SELECT revision FROM guild.conversations WHERE id=$1`, room).Scan(&current); err != nil {
			return false, err
		}
		rows, e := tx.Query(ctx, `SELECT user_id::text FROM guild.conversation_members WHERE conversation_id=$1 AND active`, room)
		if e != nil {
			return false, e
		}
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return false, e
			}
			members = append(members, c.ChatMember{ID: id})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return false, e
		}
		allowed, e := s.compatible(r, members)
		if e != nil {
			return false, e
		}
		if !allowed {
			return finish()
		}
	}
	for _, member := range members {
		if member.ID == author {
			continue
		}
		mentioned := false
		for _, m := range mentions {
			if m.Kind == "user" && m.ID == member.ID || m.Kind == "role" && kind == "channel" && contains(state.roleIDs(member.ID), m.ID) {
				mentioned = true
			}
		}
		allowed, e := s.notificationAllowed(ctx, tx, member.ID, gid, room, author, mentioned, created)
		if e != nil {
			return false, e
		}
		if !allowed {
			continue
		}
		var guildID *string
		if gid != "" {
			guildID = &gid
		}
		if _, e = tx.Exec(ctx, `INSERT INTO guild.notifications(id,user_id,message_id,room_id,room_kind,guild_id,thread_id,author_id,mention,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,message_id) DO NOTHING`, newID(), member.ID, mid, room, kind, guildID, thread, author, mentioned, created); e != nil {
			return false, e
		}
	}
	return finish()
}
