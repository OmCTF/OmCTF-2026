package guild

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	c "svyaz.local/foundation/packages/contracts/generated/go"
)

func (s *Server) create(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	var in c.GuildCreate
	if err := decode(w, r, &in); err != nil {
		return 0, nil, err
	}
	if !validName(in.Name) {
		return 0, nil, fail(400, "invalid_name")
	}
	description, icon := "", "violet"
	if in.Description != nil {
		description = *in.Description
	}
	if in.Icon != nil {
		icon = *in.Icon
	}
	if utf8.RuneCountInString(description) > 1024 || !contains([]string{"violet", "mint", "amber", "rose", "sky"}, icon) {
		return 0, nil, fail(400, "invalid_guild")
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	existing, digest, err := creationReceipt(r, tx, a.User.ID, "guild", in)
	if err != nil {
		return 0, nil, err
	}
	if existing != "" {
		state, info, err := load(r, tx, existing, false)
		if err != nil {
			return 0, nil, err
		}
		if state.Members[a.User.ID].State != "ACTIVE" {
			return 0, nil, fail(404, "guild_not_found")
		}
		info.Permissions = state.permissions(a.User.ID, state.root())
		w.Header().Set("ETag", "\""+strconv.FormatInt(info.Revision, 10)+"\"")
		return 200, info, nil
	}
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "guild-user:"+a.User.ID); err != nil {
		return 0, nil, err
	}
	var count int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.guilds WHERE owner_id=$1 AND state='ACTIVE'`, a.User.ID).Scan(&count); err != nil {
		return 0, nil, err
	}
	if count >= 20 {
		return 0, nil, fail(409, "guild_limit")
	}
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM guild.guild_members WHERE user_id=$1 AND state='ACTIVE'`, a.User.ID).Scan(&count); err != nil {
		return 0, nil, err
	}
	if count >= 100 {
		return 0, nil, fail(409, "membership_limit")
	}
	id := newID()
	g := &transaction{server: s, tx: tx, r: r, a: a, g: c.GuildInfo{ID: id}}
	if err = g.exec(`INSERT INTO guild.guilds(id,owner_id,name,description,icon) VALUES($1,$2,$3,$4,$5)`, id, a.User.ID, in.Name, description, icon); err != nil {
		return 0, nil, err
	}
	if err = g.exec(`INSERT INTO guild.guild_members(guild_id,user_id) VALUES($1,$2)`, id, a.User.ID); err != nil {
		return 0, nil, err
	}
	if err = g.exec(`INSERT INTO guild.roles(id,guild_id,name,position,permissions,is_default) VALUES($1,$2,'everyone',0,$3,true)`, newID(), id, DefaultPermissions); err != nil {
		return 0, nil, err
	}
	if err = g.exec(`INSERT INTO guild.channels(id,guild_id,name,kind,position) VALUES($1,$2,'general','TEXT',0)`, newID(), id); err != nil {
		return 0, nil, err
	}
	if err = g.touch("guild.created", id); err != nil {
		return 0, nil, err
	}
	state, info, err := load(r, tx, id, true)
	if err != nil {
		return 0, nil, err
	}
	info.Permissions = state.permissions(a.User.ID, state.root())
	if err = saveCreation(r, tx, a.User.ID, "guild", id, digest); err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	w.Header().Set("ETag", "\"1\"")
	return 201, info, nil
}
func (s *Server) list(w http.ResponseWriter, r *http.Request, a c.AuthSession) (int, any, error) {
	rows, err := s.DB.Query(r.Context(), `SELECT g.id::text FROM guild.guilds g JOIN guild.guild_members m ON m.guild_id=g.id WHERE m.user_id=$1 AND m.state='ACTIVE' AND g.state='ACTIVE' ORDER BY g.id`, a.User.ID)
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
	result := c.GuildList{Items: []c.GuildInfo{}}
	for _, id := range ids {
		_, item, e := s.with(w, r, a, id, false, func(g *transaction) (int, any, error) { return g.get() })
		if e != nil {
			return 0, nil, e
		}
		result.Items = append(result.Items, item.(c.GuildInfo))
	}
	w.Header().Del("ETag")
	return 200, result, nil
}
func (g *transaction) get() (int, any, error) {
	info := g.g
	info.Permissions = g.s.permissions(g.a.User.ID, g.s.root())
	return 200, info, nil
}
func (g *transaction) route(w http.ResponseWriter, p []string) (int, any, error) {
	method := g.r.Method
	if len(p) > 0 && p[0] == "moderation" {
		return g.moderation(w, p[1:])
	}
	if len(p) > 0 && p[0] == "webhooks" {
		return g.webhooks(w, p[1:])
	}
	if len(p) == 0 {
		switch method {
		case "GET":
			return g.get()
		case "PATCH":
			return g.patch(w)
		case "DELETE":
			return g.confirmed(w, "DELETE_GUILD")
		}
	}
	if len(p) == 1 {
		switch p[0] {
		case "members":
			if method == "GET" {
				return g.members()
			}
		case "roles":
			if method == "GET" {
				return g.roles()
			}
			if method == "POST" {
				return g.createRole(w)
			}
		case "role-order":
			if method == "PUT" {
				return g.reorder(w)
			}
		case "channel-order":
			if method == "PUT" {
				return g.reorderChannels(w)
			}
		case "categories":
			if method == "GET" {
				return g.categories()
			}
			if method == "POST" {
				return g.createResource(w, false)
			}
		case "channels":
			if method == "GET" {
				return g.channels()
			}
			if method == "POST" {
				return g.createResource(w, true)
			}
		case "invites":
			if method == "GET" {
				return g.invites()
			}
			if method == "POST" {
				return g.createInvite(w)
			}
		case "confirmations":
			if method == "POST" {
				return g.confirmation(w)
			}
		case "ownership":
			if method == "POST" {
				return g.confirmed(w, "TRANSFER_OWNER")
			}
		case "audit":
			if method == "GET" {
				return g.audit()
			}
		}
	}
	if len(p) == 2 && p[0] == "roles" {
		return g.role(w, p[1])
	}
	if len(p) == 2 && p[0] == "members" {
		return g.membership(p[1])
	}
	if len(p) == 4 && p[0] == "members" && p[2] == "roles" {
		return g.assignment(p[1], p[3])
	}
	return 0, nil, fail(404, "not_found")
}
func (g *transaction) patch(w http.ResponseWriter) (int, any, error) {
	if err := g.require("MANAGE_GUILD", g.s.root()); err != nil {
		return 0, nil, err
	}
	var in c.GuildPatch
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if in.Name != nil && !validName(*in.Name) || in.Description != nil && utf8.RuneCountInString(*in.Description) > 1024 || in.Icon != nil && !contains([]string{"violet", "mint", "amber", "rose", "sky"}, *in.Icon) {
		return 0, nil, fail(400, "invalid_guild")
	}
	if err := g.exec(`UPDATE guild.guilds SET name=coalesce($2,name),description=coalesce($3,description),icon=coalesce($4,icon),invites_enabled=coalesce($5,invites_enabled) WHERE id=$1`, g.g.ID, in.Name, in.Description, in.Icon, in.InvitesEnabled); err != nil {
		return 0, nil, err
	}
	if err := g.touch("guild.updated", g.g.ID); err != nil {
		return 0, nil, err
	}
	state, info, err := load(g.r, g.tx, g.g.ID, true)
	if err != nil {
		return 0, nil, err
	}
	info.Permissions = state.permissions(g.a.User.ID, state.root())
	return 200, info, nil
}
func (g *transaction) categories() (int, any, error) {
	result := c.GuildCategoryList{Items: []c.GuildCategory{}, Revision: g.g.Revision}
	rows, err := g.tx.Query(g.r.Context(), `SELECT id::text,guild_id::text,name,position FROM guild.categories WHERE guild_id=$1 AND state='ACTIVE' ORDER BY position,id`, g.g.ID)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v c.GuildCategory
		if err = rows.Scan(&v.ID, &v.GuildID, &v.Name, &v.Position); err != nil {
			return 0, nil, err
		}
		v.Permissions = g.s.permissions(g.a.User.ID, g.s.Categories[v.ID])
		if contains(v.Permissions, "VIEW_CHANNEL") {
			result.Items = append(result.Items, v)
		}
	}
	return 200, result, rows.Err()
}
func (g *transaction) channel(id string) (c.GuildChannel, error) {
	var v c.GuildChannel
	err := g.tx.QueryRow(g.r.Context(), `SELECT id::text,guild_id::text,category_id::text,name,kind,position,state FROM guild.channels WHERE id=$1 AND guild_id=$2`, id, g.g.ID).Scan(&v.ID, &v.GuildID, &v.CategoryID, &v.Name, &v.Kind, &v.Position, &v.State)
	v.Revision = g.g.Revision
	v.Permissions = g.s.permissions(g.a.User.ID, g.s.Channels[id])
	return v, err
}
func (g *transaction) channels() (int, any, error) {
	result := c.GuildChannelList{Items: []c.GuildChannel{}, Revision: g.g.Revision}
	for id, r := range g.s.Channels {
		if r.State == "ACTIVE" && Decide(g.a.User.ID, "VIEW_CHANNEL", r, g.s).Allowed {
			v, e := g.channel(id)
			if e != nil {
				return 0, nil, e
			}
			result.Items = append(result.Items, v)
		}
	}
	sort.Slice(result.Items, func(i, j int) bool {
		a, b := result.Items[i], result.Items[j]
		return a.Position < b.Position || a.Position == b.Position && a.ID < b.ID
	})
	return 200, result, nil
}
func (g *transaction) parent(id string) error {
	if id == "" {
		return g.require("MANAGE_CHANNEL", g.s.root())
	}
	if !validID(id) {
		return fail(400, "invalid_id")
	}
	r, ok := g.s.Categories[id]
	if !ok || r.State != "ACTIVE" {
		return fail(404, "category_not_found")
	}
	return g.require("MANAGE_CHANNEL", r)
}
func (g *transaction) createResource(w http.ResponseWriter, channel bool) (int, any, error) {
	if err := g.require("MANAGE_CHANNEL", g.s.root()); err != nil {
		return 0, nil, err
	}
	var in c.ChannelInput
	table := "guild.categories"
	kind := "CATEGORY"
	limit := 32
	count := activeResourceCount(g.s.Categories)
	if channel {
		if err := decode(w, g.r, &in); err != nil {
			return 0, nil, err
		}
		kind = in.Kind
		table = "guild.channels"
		limit = 100
		count = activeResourceCount(g.s.Channels)
		if !contains([]string{"TEXT", "VOICE", "FORUM"}, kind) {
			return 0, nil, fail(400, "wrong_channel_type")
		}
	} else {
		var v c.CategoryInput
		if err := decode(w, g.r, &v); err != nil {
			return 0, nil, err
		}
		in.Name = v.Name
		in.Position = v.Position
	}
	if !validName(in.Name) || !validPosition(in.Position) {
		return 0, nil, fail(400, "invalid_resource")
	}
	if count >= limit {
		return 0, nil, fail(409, "resource_limit")
	}
	parent := ""
	if in.CategoryID != nil {
		parent = *in.CategoryID
	}
	if err := g.parent(parent); err != nil {
		return 0, nil, err
	}
	id := newID()
	if channel {
		if err := g.exec(`INSERT INTO guild.channels(id,guild_id,category_id,name,kind,position) VALUES($1,$2,nullif($3,'')::uuid,$4,$5,$6)`, id, g.g.ID, parent, in.Name, kind, in.Position); err != nil {
			return 0, nil, err
		}
	} else {
		if err := g.exec(`INSERT INTO `+table+`(id,guild_id,name,position) VALUES($1,$2,$3,$4)`, id, g.g.ID, in.Name, in.Position); err != nil {
			return 0, nil, err
		}
	}
	if err := g.touch(strings.ToLower(kind)+".created", id); err != nil {
		return 0, nil, err
	}
	resource := Resource{ID: id, Kind: kind, CategoryID: parent, State: "ACTIVE"}
	if channel {
		g.s.Channels[id] = resource
		v, e := g.channel(id)
		return 201, v, e
	}
	g.s.Categories[id] = resource
	return 201, c.GuildCategory{ID: id, GuildID: g.g.ID, Name: in.Name, Position: in.Position, Permissions: g.s.permissions(g.a.User.ID, resource)}, nil
}
func activeResourceCount(resources map[string]Resource) int {
	count := 0
	for _, resource := range resources {
		if resource.State == "ACTIVE" {
			count++
		}
	}
	return count
}
func (g *transaction) resource(w http.ResponseWriter, table, id string, p []string) (int, any, error) {
	channel := table == "channels"
	r, ok := g.s.Categories[id]
	if channel {
		r, ok = g.s.Channels[id]
	}
	if !ok || r.State != "ACTIVE" {
		return 0, nil, fail(404, "not_found")
	}
	if !Decide(g.a.User.ID, "VIEW_CHANNEL", r, g.s).Allowed {
		return 0, nil, fail(404, "not_found")
	}
	if len(p) == 1 && p[0] == "access" && channel && g.r.Method == "GET" {
		return g.access(r)
	}
	if len(p) == 1 && channel && ((p[0] == "voice-join" && g.r.Method == "POST") || (p[0] == "voice-access" && g.r.Method == "GET")) {
		return g.voiceJoin(w, r)
	}
	if channel && len(p) >= 1 && p[0] == "sounds" {
		return g.soundboard(w, r, p[1:])
	}
	if len(p) >= 1 && p[0] == "overwrites" {
		return g.overwrites(w, r, p[1:])
	}
	if len(p) != 0 {
		return 0, nil, fail(404, "not_found")
	}
	if g.r.Method == "GET" {
		if channel {
			v, e := g.channel(id)
			return 200, v, e
		}
		return 0, nil, fail(405, "method_not_allowed")
	}
	if err := g.require("MANAGE_CHANNEL", r); err != nil {
		return 0, nil, err
	}
	if g.r.Method == "PATCH" {
		var in c.ChannelPatch
		if channel {
			if err := decode(w, g.r, &in); err != nil {
				return 0, nil, err
			}
		} else {
			var v c.CategoryPatch
			if err := decode(w, g.r, &v); err != nil {
				return 0, nil, err
			}
			in.Name = v.Name
			in.Position = v.Position
		}
		if in.Name != nil && !validName(*in.Name) || in.Position != nil && !validPosition(*in.Position) {
			return 0, nil, fail(400, "invalid_resource")
		}
		if in.CategoryID != nil {
			if err := g.parent(*in.CategoryID); err != nil {
				return 0, nil, err
			}
		}
		query := `UPDATE guild.categories SET name=coalesce($2,name),position=coalesce($3,position) WHERE id=$1`
		args := []any{id, in.Name, in.Position}
		if channel {
			query = `UPDATE guild.channels SET name=coalesce($2,name),position=coalesce($3,position),category_id=CASE WHEN $4::text IS NULL THEN category_id ELSE nullif($4,'')::uuid END WHERE id=$1`
			args = append(args, in.CategoryID)
		}
		if err := g.exec(query, args...); err != nil {
			return 0, nil, err
		}
		if err := g.touch(table+".updated", id); err != nil {
			return 0, nil, err
		}
		next, _, err := load(g.r, g.tx, g.g.ID, true)
		if err != nil {
			return 0, nil, err
		}
		g.s = next
		if channel {
			v, e := g.channel(id)
			return 200, v, e
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	if g.r.Method == "DELETE" {
		if !channel {
			var in c.CategoryDeleteInput
			if err := decode(w, g.r, &in); err != nil {
				return 0, nil, err
			}
			for _, ch := range g.s.Channels {
				if ch.CategoryID == id && ch.State == "ACTIVE" {
					if !in.DetachChildren {
						return 0, nil, fail(409, "category_has_channels")
					}
					if err := g.require("MANAGE_CHANNEL", ch); err != nil {
						return 0, nil, err
					}
				}
			}
			if err := g.exec(`UPDATE guild.channels SET category_id=NULL WHERE category_id=$1`, id); err != nil {
				return 0, nil, err
			}
		}
		if err := g.exec("UPDATE guild."+table+" SET state='ARCHIVED' WHERE id=$1", id); err != nil {
			return 0, nil, err
		}
		if channel {
			if err := g.exec(`UPDATE guild.invites SET revoked_at=coalesce(revoked_at,now()) WHERE channel_id=$1`, id); err != nil {
				return 0, nil, err
			}
		}
		if err := g.touch(table+".archived", id); err != nil {
			return 0, nil, err
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	return 0, nil, fail(405, "method_not_allowed")
}
func (g *transaction) audit() (int, any, error) {
	if err := g.require("MANAGE_GUILD", g.s.root()); err != nil {
		return 0, nil, err
	}
	result := c.GuildAuditList{Items: []c.GuildAudit{}, Revision: g.g.Revision}
	before, limit, err := communityPage(g.r)
	if err != nil {
		return 0, nil, err
	}
	actor, target, action := g.r.URL.Query().Get("actor_id"), g.r.URL.Query().Get("target_id"), g.r.URL.Query().Get("action")
	if actor != "" && !validID(actor) || target != "" && !validID(target) || len(action) > 80 {
		return 0, nil, fail(400, "invalid_filter")
	}
	rows, err := g.tx.Query(g.r.Context(), `SELECT id::text,guild_id::text,actor_id::text,action,target_id::text,revision,created_at,reason FROM guild.audit_events WHERE guild_id=$1 AND ($2::bigint=0 OR revision<$2) AND ($3='' OR actor_id::text=$3) AND ($4='' OR target_id::text=$4) AND ($5='' OR action=$5) ORDER BY revision DESC LIMIT $6`, g.g.ID, before, actor, target, action, limit)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v c.GuildAudit
		var t time.Time
		if err = rows.Scan(&v.ID, &v.GuildID, &v.ActorID, &v.Action, &v.TargetID, &v.Revision, &t, &v.Reason); err != nil {
			return 0, nil, err
		}
		v.CreatedAt = stamp(t)
		result.Items = append(result.Items, v)
	}
	if len(result.Items) == limit {
		cursor := strconv.FormatInt(result.Items[len(result.Items)-1].Revision, 10)
		result.NextCursor = &cursor
	}
	return 200, result, rows.Err()
}
