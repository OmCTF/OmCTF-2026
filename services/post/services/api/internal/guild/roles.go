package guild

import (
	"net/http"
	"sort"
	"strings"
	c "svyaz.local/foundation/packages/contracts/generated/go"
	"time"
	"unicode/utf8"
)

func (g *transaction) roles() (int, any, error) {
	result := c.GuildRoleList{Items: []c.GuildRole{}, Revision: g.g.Revision}
	for _, r := range g.s.Roles {
		r.CanEdit = g.s.canRole(g.a.User.ID, r)
		r.CanAssign = r.CanEdit && !r.IsDefault
		result.Items = append(result.Items, r)
	}
	sort.Slice(result.Items, func(i, j int) bool { return result.Items[i].Position > result.Items[j].Position })
	return 200, result, nil
}
func (g *transaction) grantRole(ops []string) error {
	if err := g.grant(ops); err != nil {
		return err
	}
	if g.a.User.ID == g.s.OwnerID {
		return nil
	}
	for _, op := range ops {
		for _, channel := range g.s.Channels {
			if channel.State == "ACTIVE" && Applicable(channel.Kind, op) && !Decide(g.a.User.ID, op, channel, g.s).Allowed {
				return fail(403, "permission_escalation")
			}
		}
	}
	return nil
}
func rolesToShiftForInsert(roles map[string]c.GuildRole, position int64) ([]c.GuildRole, bool) {
	shift := make([]c.GuildRole, 0, len(roles))
	for _, role := range roles {
		if role.Position < position {
			continue
		}
		if !validPosition(role.Position + 1) {
			return nil, false
		}
		shift = append(shift, role)
	}
	sort.Slice(shift, func(i, j int) bool { return shift[i].Position > shift[j].Position })
	return shift, true
}
func (g *transaction) createRole(w http.ResponseWriter) (int, any, error) {
	if err := g.require("MANAGE_ROLES", g.s.root()); err != nil {
		return 0, nil, err
	}
	var in c.GuildRoleInput
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if !validName(in.Name) || !validPosition(in.Position) || in.Position == 0 {
		return 0, nil, fail(400, "invalid_role")
	}
	if len(g.s.Roles) >= 32 {
		return 0, nil, fail(409, "role_limit")
	}
	if g.a.User.ID != g.s.OwnerID && in.Position >= g.s.highest(g.a.User.ID) {
		return 0, nil, fail(403, "role_hierarchy")
	}
	if err := g.grantRole(in.Permissions); err != nil {
		return 0, nil, err
	}
	shift, valid := rolesToShiftForInsert(g.s.Roles, in.Position)
	if !valid {
		return 0, nil, fail(409, "position_conflict")
	}
	for _, role := range shift {
		if err := g.exec(`UPDATE guild.roles SET position=position+1 WHERE id=$1`, role.ID); err != nil {
			return 0, nil, err
		}
	}
	id := newID()
	if err := g.exec(`INSERT INTO guild.roles(id,guild_id,name,position,permissions) VALUES($1,$2,$3,$4,$5)`, id, g.g.ID, in.Name, in.Position, in.Permissions); err != nil {
		return 0, nil, err
	}
	if err := g.touch("role.created", id); err != nil {
		return 0, nil, err
	}
	return 201, c.GuildRole{ID: id, GuildID: g.g.ID, Name: in.Name, Position: in.Position, Permissions: in.Permissions, CanEdit: true, CanAssign: true}, nil
}
func (g *transaction) role(w http.ResponseWriter, id string) (int, any, error) {
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	role, ok := g.s.Roles[id]
	if !ok {
		return 0, nil, fail(404, "role_not_found")
	}
	if !g.s.canRole(g.a.User.ID, role) {
		return 0, nil, fail(403, "role_hierarchy")
	}
	if g.r.Method == "DELETE" {
		if role.IsDefault {
			return 0, nil, fail(409, "default_role_required")
		}
		if err := g.exec(`DELETE FROM guild.roles WHERE id=$1`, id); err != nil {
			return 0, nil, err
		}
		if err := g.touch("role.deleted", id); err != nil {
			return 0, nil, err
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	if g.r.Method != "PATCH" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	var in c.GuildRolePatch
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if in.Name != nil && !validName(*in.Name) {
		return 0, nil, fail(400, "invalid_name")
	}
	if in.Permissions != nil {
		if err := g.grantRole(*in.Permissions); err != nil {
			return 0, nil, err
		}
		role.Permissions = *in.Permissions
	}
	if in.Name != nil {
		role.Name = *in.Name
	}
	if err := g.exec(`UPDATE guild.roles SET name=$2,permissions=$3 WHERE id=$1`, id, role.Name, role.Permissions); err != nil {
		return 0, nil, err
	}
	if err := g.touch("role.updated", id); err != nil {
		return 0, nil, err
	}
	role.CanEdit = true
	role.CanAssign = !role.IsDefault
	return 200, role, nil
}
func (g *transaction) reorder(w http.ResponseWriter) (int, any, error) {
	if err := g.require("MANAGE_ROLES", g.s.root()); err != nil {
		return 0, nil, err
	}
	var in c.RoleOrderInput
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if in.RoleIDs == nil || len(in.RoleIDs) != len(g.s.Roles)-1 {
		return 0, nil, fail(400, "invalid_role_order")
	}
	seen := map[string]bool{}
	for i, id := range in.RoleIDs {
		role, ok := g.s.Roles[id]
		if !ok || role.IsDefault || seen[id] {
			return 0, nil, fail(400, "invalid_role_order")
		}
		seen[id] = true
		position := int64(i + 1)
		if position != role.Position && (!g.s.canRole(g.a.User.ID, role) || g.a.User.ID != g.s.OwnerID && position >= g.s.highest(g.a.User.ID)) {
			return 0, nil, fail(403, "role_hierarchy")
		}
	}
	for i, id := range in.RoleIDs {
		if err := g.exec(`UPDATE guild.roles SET position=$2 WHERE id=$1`, id, i+1); err != nil {
			return 0, nil, err
		}
	}
	if err := g.touch("roles.reordered", g.g.ID); err != nil {
		return 0, nil, err
	}
	next, _, err := load(g.r, g.tx, g.g.ID, true)
	if err != nil {
		return 0, nil, err
	}
	g.s = next
	return g.roles()
}
func (g *transaction) members() (int, any, error) {
	result := c.GuildMemberList{Items: []c.GuildMember{}, Revision: g.g.Revision}
	query := strings.TrimSpace(g.r.URL.Query().Get("q"))
	if !utf8.ValidString(query) || utf8.RuneCountInString(query) > 80 {
		return 0, nil, fail(400, "invalid_query")
	}
	rows, err := g.tx.Query(g.r.Context(), `SELECT u.id::text,u.login,u.display_name,u.avatar,u.created_at,m.joined_at,m.state FROM guild.guild_members m JOIN identity.users u ON u.id=m.user_id WHERE m.guild_id=$1 AND m.state='ACTIVE' AND u.state='active' AND strpos(lower(u.display_name||' '||u.login),lower($2))>0 ORDER BY m.joined_at,u.id`, g.g.ID, query)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var v c.GuildMember
		var created, joined time.Time
		if err = rows.Scan(&v.User.ID, &v.User.Login, &v.User.DisplayName, &v.User.Avatar, &created, &joined, &v.State); err != nil {
			return 0, nil, err
		}
		v.GuildID = g.g.ID
		v.User.CreatedAt = stamp(created)
		v.JoinedAt = stamp(joined)
		v.RoleIDs = g.s.Members[v.User.ID].Roles
		if v.RoleIDs == nil {
			v.RoleIDs = []string{}
		}
		v.HighestPosition = g.s.highest(v.User.ID)
		v.CanManage = g.s.canMember(g.a.User.ID, v.User.ID) && (Decide(g.a.User.ID, "MANAGE_ROLES", g.s.root(), g.s).Allowed || Decide(g.a.User.ID, "KICK_MEMBER", g.s.root(), g.s).Allowed)
		result.Items = append(result.Items, v)
	}
	return 200, result, rows.Err()
}
func (g *transaction) membership(id string) (int, any, error) {
	if !validID(id) {
		return 0, nil, fail(400, "invalid_id")
	}
	if g.r.Method == "POST" {
		return 0, nil, fail(403, "invite_required")
	}
	if g.r.Method != "DELETE" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	if g.s.Members[id].State != "ACTIVE" {
		return 0, nil, fail(404, "member_not_found")
	}
	if id == g.s.OwnerID {
		return 0, nil, fail(409, "owner_must_transfer")
	}
	state := "LEFT"
	if id != g.a.User.ID {
		state = "KICKED"
		if err := g.require("KICK_MEMBER", g.s.root()); err != nil {
			return 0, nil, err
		}
		if !g.s.canMember(g.a.User.ID, id) {
			return 0, nil, fail(403, "role_hierarchy")
		}
	}
	if err := g.exec(`UPDATE guild.guild_members SET state=$3 WHERE guild_id=$1 AND user_id=$2`, g.g.ID, id, state); err != nil {
		return 0, nil, err
	}
	if err := g.exec(`DELETE FROM guild.member_roles WHERE guild_id=$1 AND user_id=$2`, g.g.ID, id); err != nil {
		return 0, nil, err
	}

	if err := g.exec(`UPDATE guild.permission_overwrites SET allow_ops='{}' WHERE guild_id=$1 AND user_id=$2`, g.g.ID, id); err != nil {
		return 0, nil, err
	}
	if err := g.touch("member."+strings.ToLower(state), id); err != nil {
		return 0, nil, err
	}
	return 200, c.GuildRevision{Revision: g.g.Revision}, nil
}
func (g *transaction) assignment(user, roleID string) (int, any, error) {
	if !validID(user) || !validID(roleID) {
		return 0, nil, fail(400, "invalid_id")
	}
	role, ok := g.s.Roles[roleID]
	if !ok {
		return 0, nil, fail(404, "role_not_found")
	}
	if g.s.Members[user].State != "ACTIVE" {
		return 0, nil, fail(404, "member_not_found")
	}
	if role.IsDefault {
		return 0, nil, fail(409, "default_role_implicit")
	}
	if !g.s.canRole(g.a.User.ID, role) || g.a.User.ID != g.s.OwnerID && !g.s.canMember(g.a.User.ID, user) {
		return 0, nil, fail(403, "role_hierarchy")
	}
	if g.r.Method == "PUT" {
		if err := g.grantRole(role.Permissions); err != nil {
			return 0, nil, err
		}
		if err := g.exec(`INSERT INTO guild.member_roles(guild_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, g.g.ID, user, roleID); err != nil {
			return 0, nil, err
		}
	} else if g.r.Method == "DELETE" {
		if err := g.exec(`DELETE FROM guild.member_roles WHERE guild_id=$1 AND user_id=$2 AND role_id=$3`, g.g.ID, user, roleID); err != nil {
			return 0, nil, err
		}
	} else {
		return 0, nil, fail(405, "method_not_allowed")
	}
	if err := g.touch("member.roles_updated", user); err != nil {
		return 0, nil, err
	}
	return 200, c.GuildRevision{Revision: g.g.Revision}, nil
}
func (g *transaction) canChangeOverwrite(r Resource, lists ...[]string) error {
	if g.a.User.ID == g.s.OwnerID {
		return nil
	}
	seen := map[string]bool{}
	for _, ops := range lists {
		for _, op := range ops {
			if seen[op] {
				continue
			}
			seen[op] = true
			if !Decide(g.a.User.ID, op, r, g.s).Allowed {
				return fail(403, "permission_escalation")
			}
			if r.Kind == "CATEGORY" {
				for _, child := range g.s.Channels {
					if child.CategoryID == r.ID && child.State == "ACTIVE" && !Decide(g.a.User.ID, op, child, g.s).Allowed {
						return fail(403, "permission_escalation")
					}
				}
			}
		}
	}
	return nil
}
func (g *transaction) overwrites(w http.ResponseWriter, r Resource, path []string) (int, any, error) {
	if err := g.require("MANAGE_CHANNEL", r); err != nil {
		return 0, nil, err
	}
	if err := g.require("MANAGE_ROLES", g.s.root()); err != nil {
		return 0, nil, err
	}
	if len(path) == 0 && g.r.Method == "GET" {
		result := c.GuildOverwriteList{Items: []c.GuildOverwrite{}, Revision: g.g.Revision}
		for _, o := range g.s.Overwrites {
			if o.ResourceID == r.ID {
				result.Items = append(result.Items, o)
			}
		}
		return 200, result, nil
	}
	if len(path) != 1 {
		return 0, nil, fail(404, "not_found")
	}
	parts := strings.Split(path[0], ":")
	if len(parts) != 2 || !contains([]string{"role", "user"}, parts[0]) || !validID(parts[1]) {
		return 0, nil, fail(400, "invalid_subject")
	}
	kind, target := parts[0], parts[1]
	if kind == "role" {
		role, ok := g.s.Roles[target]
		if !ok {
			return 0, nil, fail(404, "role_not_found")
		}
		if !g.s.canRole(g.a.User.ID, role) {
			return 0, nil, fail(403, "role_hierarchy")
		}
	} else {
		if g.s.Members[target].State != "ACTIVE" {
			return 0, nil, fail(404, "member_not_found")
		}
		if g.a.User.ID != g.s.OwnerID && !g.s.canMember(g.a.User.ID, target) {
			return 0, nil, fail(403, "role_hierarchy")
		}
	}
	if g.r.Method == "DELETE" {
		for _, o := range g.s.Overwrites {
			if o.ResourceID == r.ID && o.SubjectKind == kind && o.SubjectID == target {
				if err := g.canChangeOverwrite(r, o.Allow, o.Deny); err != nil {
					return 0, nil, err
				}
				if err := g.exec(`DELETE FROM guild.permission_overwrites WHERE id=$1`, o.ID); err != nil {
					return 0, nil, err
				}
			}
		}
		if err := g.touch("overwrite.deleted", r.ID); err != nil {
			return 0, nil, err
		}
		return 200, c.GuildRevision{Revision: g.g.Revision}, nil
	}
	if g.r.Method != "PUT" {
		return 0, nil, fail(405, "method_not_allowed")
	}
	var in c.OverwriteInput
	if err := decode(w, g.r, &in); err != nil {
		return 0, nil, err
	}
	if !validPermissions(in.Deny) {
		return 0, nil, fail(400, "invalid_permissions")
	}
	if err := g.grant(in.Allow); err != nil {
		return 0, nil, err
	}
	for _, op := range in.Allow {
		if contains(in.Deny, op) {
			return 0, nil, fail(400, "allow_deny_overlap")
		}
	}
	for _, op := range append(append([]string{}, in.Allow...), in.Deny...) {
		if !(r.Kind == "CATEGORY" && !contains([]string{"MANAGE_GUILD", "MANAGE_ROLES", "KICK_MEMBER"}, op)) && !Applicable(r.Kind, op) {
			return 0, nil, fail(400, "wrong_channel_type")
		}
	}
	count := 0
	var previous *c.GuildOverwrite
	for _, o := range g.s.Overwrites {
		if o.ResourceID == r.ID {
			count++
		}
		if o.ResourceID == r.ID && o.SubjectID == target && o.SubjectKind == kind {
			copy := o
			previous = &copy
		}
	}
	if previous != nil {
		if err := g.canChangeOverwrite(r, previous.Allow, previous.Deny, in.Allow, in.Deny); err != nil {
			return 0, nil, err
		}
	} else if err := g.canChangeOverwrite(r, in.Allow, in.Deny); err != nil {
		return 0, nil, err
	}
	id := newID()
	if previous != nil {
		id = previous.ID
		if err := g.exec(`UPDATE guild.permission_overwrites SET allow_ops=$2,deny_ops=$3 WHERE id=$1`, id, in.Allow, in.Deny); err != nil {
			return 0, nil, err
		}
	} else {
		if count >= 100 {
			return 0, nil, fail(409, "overwrite_limit")
		}
		var categoryID, channelID, roleID, userID *string
		if r.Kind == "CATEGORY" {
			categoryID = &r.ID
		} else {
			channelID = &r.ID
		}
		if kind == "role" {
			roleID = &target
		} else {
			userID = &target
		}
		if err := g.exec(`INSERT INTO guild.permission_overwrites(id,guild_id,category_id,channel_id,role_id,user_id,allow_ops,deny_ops) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, g.g.ID, categoryID, channelID, roleID, userID, in.Allow, in.Deny); err != nil {
			return 0, nil, err
		}
	}
	if err := g.touch("overwrite.updated", r.ID); err != nil {
		return 0, nil, err
	}
	return 200, c.GuildOverwrite{ID: id, ResourceID: r.ID, SubjectKind: kind, SubjectID: target, Allow: in.Allow, Deny: in.Deny}, nil
}
