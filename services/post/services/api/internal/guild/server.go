package guild

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"svyaz.local/foundation/services/api/internal/identity"
)

var fail = identity.Fail
var validID = identity.ValidID
var newID = identity.NewID

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	var required []string
	switch v.(type) {
	case *c.GuildCreate:
		required = []string{"name"}
	case *c.GuildRoleInput:
		required = []string{"name", "position", "permissions"}
	case *c.RoleOrderInput:
		required = []string{"role_ids"}
	case *c.CategoryInput:
		required = []string{"name", "position"}
	case *c.CategoryDeleteInput:
		required = []string{"detach_children"}
	case *c.ChannelInput:
		required = []string{"name", "position", "kind"}
	case *c.OverwriteInput:
		required = []string{"allow", "deny"}
	case *c.InviteInput:
		required = []string{"channel_id", "max_uses", "ttl_seconds"}
	case *c.ConfirmationInput:
		required = []string{"action"}

	}
	return identity.DecodeRequired(w, r, v, required...)
}

type Server struct {
	DB                                       *pgxpool.Pool
	RealtimeSecret, VoiceSecret, MediaSecret string
}
type transaction struct {
	tx      pgx.Tx
	r       *http.Request
	a       c.AuthSession
	s       State
	g       c.GuildInfo
	server  *Server
	changed bool
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func hash(s string) []byte { h := sha256.Sum256([]byte(s)); return h[:] }
func signature(secret, data string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(data))
	return h.Sum(nil)
}
func validName(s string) bool {
	if !utf8.ValidString(s) || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > 80 {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func validPosition(n int64) bool { return n >= 0 && n <= 10000 }
func validPermissions(p []string) bool {
	seen := map[string]bool{}
	if p == nil {
		return false
	}
	for _, v := range p {
		if !contains(Operations, v) || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
func (g *transaction) exec(query string, args ...any) error {
	_, err := g.tx.Exec(g.r.Context(), query, args...)
	return err
}
func (g *transaction) require(op string, r Resource) error {
	d := Decide(g.a.User.ID, op, r, g.s)
	if d.Allowed {
		return nil
	}
	if d.Reason == "wrong_channel_type" {
		return fail(400, d.Reason)
	}
	return fail(403, d.Reason)
}
func (g *transaction) grant(ops []string) error {
	if !validPermissions(ops) {
		return fail(400, "invalid_permissions")
	}
	if g.a.User.ID == g.s.OwnerID {
		return nil
	}
	base := g.s.base(g.a.User.ID)
	for _, op := range ops {
		if !base[op] {
			return fail(403, "permission_escalation")
		}
	}
	return nil
}
func load(r *http.Request, tx pgx.Tx, id string, lock bool) (State, c.GuildInfo, error) {
	s := State{Roles: map[string]c.GuildRole{}, Members: map[string]Member{}, Categories: map[string]Resource{}, Channels: map[string]Resource{}, Overwrites: []c.GuildOverwrite{}}
	var g c.GuildInfo
	var created time.Time
	suffix := " FOR SHARE"
	if lock {
		suffix = " FOR UPDATE"
	}
	err := tx.QueryRow(r.Context(), `SELECT id::text,owner_id::text,name,description,icon,invites_enabled,revision,created_at,state FROM guild.guilds WHERE id=$1`+suffix, id).Scan(&g.ID, &g.OwnerID, &g.Name, &g.Description, &g.Icon, &g.InvitesEnabled, &g.Revision, &created, &s.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, g, fail(404, "guild_not_found")
	}
	if err != nil {
		return s, g, err
	}
	if s.Status != "ACTIVE" {
		return s, g, fail(404, "guild_not_found")
	}
	s.ID = g.ID
	s.OwnerID = g.OwnerID
	s.Revision = g.Revision
	g.CreatedAt = stamp(created)
	rows, err := tx.Query(r.Context(), `SELECT id::text,guild_id::text,name,position,permissions,is_default FROM guild.roles WHERE guild_id=$1`, id)
	if err != nil {
		return s, g, err
	}
	for rows.Next() {
		var role c.GuildRole
		if err = rows.Scan(&role.ID, &role.GuildID, &role.Name, &role.Position, &role.Permissions, &role.IsDefault); err != nil {
			rows.Close()
			return s, g, err
		}
		s.Roles[role.ID] = role
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, g, err
	}
	rows, err = tx.Query(r.Context(), `SELECT m.user_id::text,m.state,ARRAY(SELECT mr.role_id::text FROM guild.member_roles mr WHERE mr.guild_id=m.guild_id AND mr.user_id=m.user_id) FROM guild.guild_members m JOIN identity.users u ON u.id=m.user_id WHERE m.guild_id=$1 AND u.state='active'`, id)
	if err != nil {
		return s, g, err
	}
	for rows.Next() {
		var m Member
		if err = rows.Scan(&m.ID, &m.State, &m.Roles); err != nil {
			rows.Close()
			return s, g, err
		}
		s.Members[m.ID] = m
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, g, err
	}
	rows, err = tx.Query(r.Context(), `SELECT id::text,state FROM guild.categories WHERE guild_id=$1`, id)
	if err != nil {
		return s, g, err
	}
	for rows.Next() {
		v := Resource{Kind: "CATEGORY"}
		if err = rows.Scan(&v.ID, &v.State); err != nil {
			rows.Close()
			return s, g, err
		}
		s.Categories[v.ID] = v
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, g, err
	}
	rows, err = tx.Query(r.Context(), `SELECT id::text,kind,coalesce(category_id::text,''),state FROM guild.channels WHERE guild_id=$1`, id)
	if err != nil {
		return s, g, err
	}
	for rows.Next() {
		var v Resource
		if err = rows.Scan(&v.ID, &v.Kind, &v.CategoryID, &v.State); err != nil {
			rows.Close()
			return s, g, err
		}
		s.Channels[v.ID] = v
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, g, err
	}
	rows, err = tx.Query(r.Context(), `SELECT id::text,coalesce(category_id,channel_id)::text,CASE WHEN role_id IS NULL THEN 'user' ELSE 'role' END,coalesce(role_id,user_id)::text,allow_ops,deny_ops FROM guild.permission_overwrites WHERE guild_id=$1`, id)
	if err != nil {
		return s, g, err
	}
	for rows.Next() {
		var v c.GuildOverwrite
		if err = rows.Scan(&v.ID, &v.ResourceID, &v.SubjectKind, &v.SubjectID, &v.Allow, &v.Deny); err != nil {
			rows.Close()
			return s, g, err
		}
		s.Overwrites = append(s.Overwrites, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, g, err
	}
	s.Sanctions = map[string][]string{}
	rows, err = tx.Query(r.Context(), `SELECT user_id::text,kind FROM guild.sanctions WHERE guild_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND kind<>'KICK'`, id)
	if err != nil {
		return s, g, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid, kind string
		if err = rows.Scan(&uid, &kind); err != nil {
			return s, g, err
		}
		s.Sanctions[uid] = append(s.Sanctions[uid], kind)
	}
	return s, g, rows.Err()
}
func (g *transaction) touch(action, target string) error {
	if g.changed {
		return fail(500, "duplicate_revision")
	}
	g.changed = true
	g.g.Revision++
	g.s.Revision = g.g.Revision
	if err := g.exec(`UPDATE guild.guilds SET revision=$2 WHERE id=$1`, g.g.ID, g.g.Revision); err != nil {
		return err
	}
	if err := g.exec(`INSERT INTO guild.audit_events(id,guild_id,actor_id,action,target_id,revision) VALUES($1,$2,$3,$4,$5,$6)`, newID(), g.g.ID, g.a.User.ID, action, target, g.g.Revision); err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string]any{"guild_id": g.g.ID, "revision": g.g.Revision, "action": action, "target_id": target})
	if err := g.exec(`INSERT INTO guild.community_users(user_id,revision) SELECT user_id,1 FROM guild.guild_members WHERE guild_id=$1 ON CONFLICT(user_id) DO UPDATE SET revision=guild.community_users.revision+1`, g.g.ID); err != nil {
		return err
	}
	return g.exec(`INSERT INTO guild.outbox(event_id,schema_version,kind,aggregate_id,payload) VALUES($1,1,'guild.changed',$2,$3)`, newID(), g.g.ID, payload)
}
func (s *Server) with(w http.ResponseWriter, r *http.Request, a c.AuthSession, id string, write bool, fn func(*transaction) (int, any, error)) (int, any, error) {
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	state, info, err := load(r, tx, id, write)
	if err != nil {
		return 0, nil, err
	}
	if state.Members[a.User.ID].State != "ACTIVE" {
		return 0, nil, fail(404, "guild_not_found")
	}
	if write {
		raw := r.Header.Get("If-Match")
		n, e := strconv.ParseInt(strings.Trim(raw, "\""), 10, 64)
		if e != nil || raw != "\""+strconv.FormatInt(n, 10)+"\"" || n < 1 {
			return 0, nil, fail(400, "revision_required")
		}
		if n != state.Revision {
			return 0, nil, fail(409, "version_conflict")
		}
	}
	g := &transaction{tx: tx, r: r, a: a, s: state, g: info, server: s}
	status, result, err := fn(g)
	if err != nil {
		return 0, nil, err
	}
	if write && g.changed && a.User.ID != state.OwnerID {
		after, _, e := load(r, tx, id, true)
		if e != nil {
			return 0, nil, e
		}
		resources := []Resource{state.root()}
		for _, v := range state.Categories {
			resources = append(resources, v)
		}
		for _, v := range state.Channels {
			resources = append(resources, v)
		}
		for _, old := range resources {
			next := after.root()
			if old.Kind == "CATEGORY" {
				next = after.Categories[old.ID]
			} else if old.Kind != "GUILD" {
				next = after.Channels[old.ID]
			}
			for _, op := range Operations {
				if !Decide(a.User.ID, op, old, state).Allowed && Decide(a.User.ID, op, next, after).Allowed {
					return 0, nil, fail(403, "self_escalation")
				}
			}
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return 0, nil, fail(409, "position_conflict")
		}
		return 0, nil, err
	}
	w.Header().Set("ETag", "\""+strconv.FormatInt(g.g.Revision, 10)+"\"")
	return status, result, nil
}
func (s *Server) Handle(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/")
	parts := strings.Split(path, "/")
	if parts[0] == "community" {
		return s.community(w, r, a, parts[1:])
	}
	if parts[0] == "uploads" || parts[0] == "attachments" {
		return s.mediaProxy(w, r, a)
	}
	if path == "search" {
		return s.searchProxy(w, r, a)
	}
	if identity.IsMessagePath(r.URL.Path) {
		return s.messageProxy(w, r, a)
	}
	if parts[0] == "conversations" {
		return s.conversations(w, r, a, parts[1:])
	}
	write := r.Method != "GET"

	if len(parts) == 3 && parts[0] == "channels" && parts[2] == "voice-join" {
		write = false
	}
	if path == "guilds" {
		if r.Method == "POST" {
			return s.create(w, r, a)
		}
		if r.Method == "GET" {
			return s.list(w, r, a)
		}
	}
	if parts[0] == "invite-preview" && len(parts) == 2 && r.Method == "GET" {
		return s.preview(r, parts[1])
	}
	if parts[0] == "invites" && len(parts) == 3 && parts[2] == "accept" && r.Method == "POST" {
		return s.accept(w, r, a, parts[1])
	}
	if parts[0] == "guilds" && len(parts) >= 2 {
		return s.with(w, r, a, parts[1], write, func(g *transaction) (int, any, error) { return g.route(w, parts[2:]) })
	}
	if contains([]string{"channels", "categories", "invites"}, parts[0]) && len(parts) >= 2 {
		if !validID(parts[1]) {
			return 0, nil, fail(400, "invalid_id")
		}
		var gid string
		query := map[string]string{
			"channels":   "SELECT c.guild_id::text FROM guild.channels c JOIN guild.guild_members m ON m.guild_id=c.guild_id AND m.user_id=$2 AND m.state='ACTIVE' JOIN guild.guilds g ON g.id=c.guild_id AND g.state='ACTIVE' WHERE c.id=$1",
			"categories": "SELECT c.guild_id::text FROM guild.categories c JOIN guild.guild_members m ON m.guild_id=c.guild_id AND m.user_id=$2 AND m.state='ACTIVE' JOIN guild.guilds g ON g.id=c.guild_id AND g.state='ACTIVE' WHERE c.id=$1",
			"invites":    "SELECT c.guild_id::text FROM guild.invites c JOIN guild.guild_members m ON m.guild_id=c.guild_id AND m.user_id=$2 AND m.state='ACTIVE' JOIN guild.guilds g ON g.id=c.guild_id AND g.state='ACTIVE' WHERE c.id=$1",
		}[parts[0]]
		err := s.DB.QueryRow(r.Context(), query, parts[1], a.User.ID).Scan(&gid)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, fail(404, "not_found")
		}
		if err != nil {
			return 0, nil, err
		}
		return s.with(w, r, a, gid, write, func(g *transaction) (int, any, error) {
			if parts[0] == "invites" && len(parts) == 2 && r.Method == "DELETE" {
				return g.revokeInvite(parts[1])
			}
			return g.resource(w, parts[0], parts[1], parts[2:])
		})
	}
	return 0, nil, fail(404, "not_found")
}
