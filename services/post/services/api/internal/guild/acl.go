package guild

import c "svyaz.local/foundation/packages/contracts/generated/go"

var Operations = []string{"VIEW_CHANNEL", "SEND_MESSAGES", "READ_HISTORY", "ATTACH_FILES", "CREATE_THREAD", "MANAGE_MESSAGES", "CONNECT_VOICE", "SPEAK", "STREAM_VIDEO", "VIEW_STREAM", "CREATE_INVITE", "MANAGE_CHANNEL", "MANAGE_ROLES", "KICK_MEMBER", "MANAGE_GUILD"}
var DefaultPermissions = []string{"VIEW_CHANNEL", "SEND_MESSAGES", "READ_HISTORY", "ATTACH_FILES", "CREATE_THREAD", "CONNECT_VOICE", "SPEAK", "STREAM_VIDEO", "VIEW_STREAM", "CREATE_INVITE"}

type Member struct {
	ID, State string
	Roles     []string
}
type Resource struct{ ID, Kind, CategoryID, State string }
type State struct {
	ID, OwnerID, Status string
	Revision            int64
	Roles               map[string]c.GuildRole
	Members             map[string]Member
	Categories          map[string]Resource
	Channels            map[string]Resource
	Overwrites          []c.GuildOverwrite
	Sanctions           map[string][]string
}
type Decision struct {
	Allowed bool
	Reason  string
}

func contains(items []string, item string) bool {
	for _, v := range items {
		if v == item {
			return true
		}
	}
	return false
}
func Applicable(kind, op string) bool {
	switch op {
	case "MANAGE_GUILD", "MANAGE_ROLES", "KICK_MEMBER":
		return kind == "GUILD"
	case "VIEW_CHANNEL", "MANAGE_CHANNEL":
		return contains([]string{"GUILD", "CATEGORY", "TEXT", "VOICE", "FORUM"}, kind)
	case "CREATE_INVITE":
		return contains([]string{"TEXT", "VOICE", "FORUM"}, kind)
	case "CONNECT_VOICE", "SPEAK", "STREAM_VIDEO", "VIEW_STREAM":
		return kind == "VOICE"
	case "SEND_MESSAGES", "READ_HISTORY", "ATTACH_FILES", "CREATE_THREAD", "MANAGE_MESSAGES":
		return kind == "TEXT" || kind == "FORUM" || kind == "VOICE"
	}
	return false
}
func (s State) roleIDs(user string) []string {
	ids := append([]string{}, s.Members[user].Roles...)
	for _, r := range s.Roles {
		if r.IsDefault {
			ids = append(ids, r.ID)
		}
	}
	return ids
}
func (s State) base(user string) map[string]bool {
	out := map[string]bool{}
	for _, id := range s.roleIDs(user) {
		for _, op := range s.Roles[id].Permissions {
			out[op] = true
		}
	}
	return out
}
func (s State) highest(user string) int64 {
	var pos int64
	for _, id := range s.roleIDs(user) {
		if p := s.Roles[id].Position; p > pos {
			pos = p
		}
	}
	return pos
}

func Decide(subject, operation string, resource Resource, current State) Decision {
	no := func(reason string) Decision { return Decision{false, reason} }
	if !contains(Operations, operation) {
		return no("unknown_operation")
	}

	canonical, exists := current.Channels[resource.ID]
	if resource.Kind == "GUILD" {
		canonical, exists = current.root(), resource.ID == current.ID
	}
	if resource.Kind == "CATEGORY" {
		canonical, exists = current.Categories[resource.ID]
	}
	if !exists || canonical != resource {
		return no("unknown_resource")
	}
	if current.Status != "ACTIVE" || resource.State != "ACTIVE" {
		return no("resource_inactive")
	}
	if current.Members[subject].State != "ACTIVE" {
		return no("not_member")
	}
	if !Applicable(resource.Kind, operation) {
		return no("wrong_channel_type")
	}
	if subject == current.OwnerID {
		return Decision{true, "owner"}
	}
	for _, sanction := range current.Sanctions[subject] {
		if sanction == "BAN" || sanction == "MUTE_TEXT" && contains([]string{"SEND_MESSAGES", "ATTACH_FILES", "CREATE_THREAD", "MANAGE_MESSAGES"}, operation) || sanction == "MUTE_VOICE" && contains([]string{"SPEAK", "STREAM_VIDEO"}, operation) {
			return no("moderation_active")
		}
	}
	allow := current.base(subject)
	deny := map[string]bool{}
	roles := current.roleIDs(subject)
	apply := func(id string) {
		for _, o := range current.Overwrites {
			if o.ResourceID == id && (o.SubjectKind == "user" && o.SubjectID == subject || o.SubjectKind == "role" && contains(roles, o.SubjectID)) {
				for _, op := range o.Allow {
					allow[op] = true
				}
				for _, op := range o.Deny {
					deny[op] = true
				}
			}
		}
	}
	if resource.CategoryID != "" {
		parent, ok := current.Categories[resource.CategoryID]
		if !ok || parent.State != "ACTIVE" {
			return no("parent_inactive")
		}
		apply(parent.ID)
		if !allow["VIEW_CHANNEL"] || deny["VIEW_CHANNEL"] {
			return no("category_hidden")
		}
	}
	if resource.Kind != "GUILD" {
		apply(resource.ID)
		if !allow["VIEW_CHANNEL"] || deny["VIEW_CHANNEL"] {
			return no("channel_hidden")
		}
	}
	if deny[operation] {
		return no("explicit_deny")
	}
	if !allow[operation] {
		return no("permission_missing")
	}
	return Decision{true, "granted"}
}
func (s State) permissions(user string, r Resource) []string {
	out := []string{}
	for _, op := range Operations {
		if Decide(user, op, r, s).Allowed {
			out = append(out, op)
		}
	}
	return out
}
func (s State) root() Resource { return Resource{ID: s.ID, Kind: "GUILD", State: s.Status} }
func (s State) canRole(user string, r c.GuildRole) bool {
	if user == s.OwnerID {
		return true
	}
	return Decide(user, "MANAGE_ROLES", s.root(), s).Allowed && !r.IsDefault && r.Position < s.highest(user) && !contains(s.Members[user].Roles, r.ID)
}
func (s State) canMember(actor, target string) bool {
	return actor == s.OwnerID && target != s.OwnerID || actor != target && target != s.OwnerID && s.highest(actor) > s.highest(target)
}
