package contracts

import (
	"encoding/json"
	"fmt"
)

type User struct {
	ID          ID        `json:"id"`
	Login       string    `json:"login"`
	DisplayName string    `json:"display_name"`
	CreatedAt   Timestamp `json:"created_at"`
}
type Guild struct {
	ID        ID        `json:"id"`
	OwnerID   ID        `json:"owner_id"`
	Name      string    `json:"name"`
	CreatedAt Timestamp `json:"created_at"`
}
type Membership struct {
	GuildID  ID        `json:"guild_id"`
	UserID   ID        `json:"user_id"`
	RoleIDs  []ID      `json:"role_ids"`
	JoinedAt Timestamp `json:"joined_at"`
}
type Role struct {
	ID          ID       `json:"id"`
	GuildID     ID       `json:"guild_id"`
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	Position    int64    `json:"position"`
}
type Category struct {
	ID       ID     `json:"id"`
	GuildID  ID     `json:"guild_id"`
	Name     string `json:"name"`
	Position int64  `json:"position"`
}
type Channel struct {
	ID         ID        `json:"id"`
	GuildID    *ID       `json:"guild_id,omitempty"`
	CategoryID *ID       `json:"category_id,omitempty"`
	Kind       string    `json:"kind"`
	Name       string    `json:"name"`
	Position   int64     `json:"position"`
	CreatedAt  Timestamp `json:"created_at"`
}
type Attachment struct {
	ID          ID        `json:"id"`
	OwnerID     ID        `json:"owner_id"`
	MessageID   *ID       `json:"message_id,omitempty"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	State       string    `json:"state"`
	CreatedAt   Timestamp `json:"created_at"`
}
type Message struct {
	ID          ID           `json:"id"`
	ChannelID   ID           `json:"channel_id"`
	AuthorID    ID           `json:"author_id"`
	Content     string       `json:"content"`
	Attachments []Attachment `json:"attachments"`
	Revision    int64        `json:"revision"`
	CreatedAt   Timestamp    `json:"created_at"`
	EditedAt    *Timestamp   `json:"edited_at,omitempty"`
}
type MessageEdited struct {
	Message  Message   `json:"message"`
	EditedAt Timestamp `json:"edited_at"`
}
type MessageDeleted struct {
	MessageID ID        `json:"message_id"`
	ChannelID ID        `json:"channel_id"`
	Revision  int64     `json:"revision"`
	DeletedAt Timestamp `json:"deleted_at"`
}
type WSCommand struct {
	SchemaVersion int64  `json:"schema_version"`
	RequestID     ID     `json:"request_id"`
	Op            string `json:"op"`
	ChannelID     ID     `json:"channel_id"`
	AfterEventID  *ID    `json:"after_event_id,omitempty"`
}
type WSAck struct {
	SchemaVersion int64          `json:"schema_version"`
	RequestID     ID             `json:"request_id"`
	Accepted      bool           `json:"accepted"`
	Error         *ErrorResponse `json:"error,omitempty"`
}
type WSEvent struct {
	SchemaVersion int64     `json:"schema_version"`
	EventID       ID        `json:"event_id"`
	ChannelID     ID        `json:"channel_id"`
	Kind          string    `json:"kind"`
	PayloadJSON   string    `json:"payload_json"`
	OccurredAt    Timestamp `json:"occurred_at"`
}
type Heartbeat struct {
	SchemaVersion int64     `json:"schema_version"`
	Op            string    `json:"op"`
	Nonce         ID        `json:"nonce"`
	SentAt        Timestamp `json:"sent_at"`
}
type ServiceRequest struct {
	SchemaVersion   int64  `json:"schema_version"`
	RequestID       ID     `json:"request_id"`
	Caller          string `json:"caller"`
	Action          string `json:"action"`
	ResourceID      ID     `json:"resource_id"`
	CapabilityToken string `json:"capability_token"`
	IdempotencyKey  *ID    `json:"idempotency_key,omitempty"`
}
type ServiceEvent struct {
	SchemaVersion int64     `json:"schema_version"`
	EventID       ID        `json:"event_id"`
	Producer      string    `json:"producer"`
	Kind          string    `json:"kind"`
	AggregateID   ID        `json:"aggregate_id"`
	Revision      int64     `json:"revision"`
	PayloadJSON   string    `json:"payload_json"`
	OccurredAt    Timestamp `json:"occurred_at"`
	RequestID     ID        `json:"request_id"`
}
type Capability struct {
	SchemaVersion int64     `json:"schema_version"`
	JTI           ID        `json:"jti"`
	Issuer        string    `json:"issuer"`
	Subject       ID        `json:"subject"`
	Audience      string    `json:"audience"`
	Actions       []string  `json:"actions"`
	ResourceID    ID        `json:"resource_id"`
	ACLRevision   int64     `json:"acl_revision"`
	IssuedAt      Timestamp `json:"issued_at"`
	ExpiresAt     Timestamp `json:"expires_at"`
}
type ValidationDetail struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}
type ErrorResponse struct {
	Code      string              `json:"code"`
	Message   string              `json:"message"`
	RequestID ID                  `json:"request_id"`
	Details   *[]ValidationDetail `json:"details,omitempty"`
}
type DependencyStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}
type HealthResponse struct {
	Service      string             `json:"service"`
	Status       string             `json:"status"`
	RequestID    ID                 `json:"request_id"`
	Dependencies []DependencyStatus `json:"dependencies"`
}
type VersionResponse struct {
	Service       string `json:"service"`
	Version       string `json:"version"`
	APIVersion    string `json:"api_version"`
	SchemaVersion int64  `json:"schema_version"`
	RequestID     ID     `json:"request_id"`
}
type PageCursor struct {
	Limit int64   `json:"limit"`
	After *string `json:"after,omitempty"`
}
type PublicProfile struct {
	ID          ID        `json:"id"`
	Login       string    `json:"login"`
	DisplayName string    `json:"display_name"`
	Avatar      string    `json:"avatar"`
	CreatedAt   Timestamp `json:"created_at"`
}
type RegisterInput struct {
	Login       string `json:"login"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}
type LoginInput struct {
	Login    string  `json:"login"`
	Password string  `json:"password"`
	Device   *string `json:"device,omitempty"`
}
type ProfilePatch struct {
	DisplayName *string `json:"display_name,omitempty"`
	Avatar      *string `json:"avatar,omitempty"`
}
type PrivacySettings struct {
	Discoverable   bool   `json:"discoverable"`
	FriendRequests string `json:"friend_requests"`
	DmPolicy       string `json:"dm_policy"`
}
type SettingsPatch struct {
	Discoverable   *bool   `json:"discoverable,omitempty"`
	FriendRequests *string `json:"friend_requests,omitempty"`
	DmPolicy       *string `json:"dm_policy,omitempty"`
}
type SessionInfo struct {
	ID        ID         `json:"id"`
	UserID    ID         `json:"user_id"`
	IssuedAt  Timestamp  `json:"issued_at"`
	ExpiresAt Timestamp  `json:"expires_at"`
	RevokedAt *Timestamp `json:"revoked_at,omitempty"`
	Device    string     `json:"device"`
	Current   bool       `json:"current"`
}
type CommunitySettings struct {
	BrowserNotifications bool `json:"browser_notifications"`
}
type CommunityChanged struct {
	Kind     string `json:"kind"`
	Revision int64  `json:"revision"`
}
type NotificationRule struct {
	Scope     string     `json:"scope"`
	ScopeID   string     `json:"scope_id"`
	Mode      string     `json:"mode"`
	MuteUntil *Timestamp `json:"mute_until,omitempty"`
}
type NotificationRuleInput struct {
	Mode            string `json:"mode"`
	DurationSeconds int64  `json:"duration_seconds"`
}
type NotificationRuleList struct {
	Items []NotificationRule `json:"items"`
}
type InboxItem struct {
	ID        ID        `json:"id"`
	Sequence  int64     `json:"sequence"`
	MessageID ID        `json:"message_id"`
	RoomID    ID        `json:"room_id"`
	RoomKind  string    `json:"room_kind"`
	GuildID   *ID       `json:"guild_id,omitempty"`
	ThreadID  *ID       `json:"thread_id,omitempty"`
	Name      string    `json:"name"`
	Mention   bool      `json:"mention"`
	Read      bool      `json:"read"`
	CreatedAt Timestamp `json:"created_at"`
}
type InboxPage struct {
	Items      []InboxItem `json:"items"`
	Revision   int64       `json:"revision"`
	NextCursor *string     `json:"next_cursor,omitempty"`
}
type NotificationClaim struct {
	Claimed bool `json:"claimed"`
}
type FavoriteChannel struct {
	ChannelID ID     `json:"channel_id"`
	GuildID   ID     `json:"guild_id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
}
type FavoriteList struct {
	Items []FavoriteChannel `json:"items"`
}
type ModerationInput struct {
	UserID          ID     `json:"user_id"`
	Kind            string `json:"kind"`
	Reason          string `json:"reason"`
	DurationSeconds int64  `json:"duration_seconds"`
}
type ModerationRevoke struct {
	Reason string `json:"reason"`
}
type ModerationRecord struct {
	ID               ID         `json:"id"`
	GuildID          ID         `json:"guild_id"`
	UserID           ID         `json:"user_id"`
	ActorID          ID         `json:"actor_id"`
	Kind             string     `json:"kind"`
	Reason           string     `json:"reason"`
	CreatedAt        Timestamp  `json:"created_at"`
	ExpiresAt        *Timestamp `json:"expires_at,omitempty"`
	RevokedAt        *Timestamp `json:"revoked_at,omitempty"`
	RevocationReason *string    `json:"revocation_reason,omitempty"`
	Active           bool       `json:"active"`
	CanRevoke        bool       `json:"can_revoke"`
}
type ModerationList struct {
	Items    []ModerationRecord `json:"items"`
	Revision int64              `json:"revision"`
}
type WebhookSender struct {
	ID     ID     `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}
type WebhookInput struct {
	ChannelID ID     `json:"channel_id"`
	Name      string `json:"name"`
	Avatar    string `json:"avatar"`
}
type WebhookInfo struct {
	ID        ID         `json:"id"`
	GuildID   ID         `json:"guild_id"`
	ChannelID ID         `json:"channel_id"`
	CreatorID ID         `json:"creator_id"`
	Name      string     `json:"name"`
	Avatar    string     `json:"avatar"`
	CreatedAt Timestamp  `json:"created_at"`
	RevokedAt *Timestamp `json:"revoked_at,omitempty"`
}
type WebhookSecret struct {
	Webhook  WebhookInfo `json:"webhook"`
	Secret   string      `json:"secret"`
	Revision int64       `json:"revision"`
}
type WebhookList struct {
	Items    []WebhookInfo `json:"items"`
	Revision int64         `json:"revision"`
}
type WebhookSend struct {
	ClientID ID     `json:"client_id"`
	Content  string `json:"content"`
}
type AuthSession struct {
	User              PublicProfile `json:"user"`
	SessionID         ID            `json:"session_id"`
	CommunityRevision *int64        `json:"community_revision,omitempty"`
	AccessExpiresAt   Timestamp     `json:"access_expires_at"`
	ExpiresAt         Timestamp     `json:"expires_at"`
}
type FriendRequestInput struct {
	UserID ID `json:"user_id"`
}
type FriendRequest struct {
	ID        ID            `json:"id"`
	Sender    PublicProfile `json:"sender"`
	Recipient PublicProfile `json:"recipient"`
	Status    string        `json:"status"`
	CreatedAt Timestamp     `json:"created_at"`
	UpdatedAt Timestamp     `json:"updated_at"`
}
type ContactEligibility struct {
	UserID  ID   `json:"user_id"`
	Allowed bool `json:"allowed"`
}
type ProfilePage struct {
	Items      []PublicProfile `json:"items"`
	NextCursor *string         `json:"next_cursor,omitempty"`
}
type RequestPage struct {
	Items      []FriendRequest `json:"items"`
	NextCursor *string         `json:"next_cursor,omitempty"`
}
type SessionPage struct {
	Items      []SessionInfo `json:"items"`
	NextCursor *string       `json:"next_cursor,omitempty"`
}
type IdentityWSReady struct {
	Kind      string `json:"kind"`
	UserID    ID     `json:"user_id"`
	SessionID ID     `json:"session_id"`
}
type IdentityPing struct {
	Op string `json:"op"`
}
type IdentityPong struct {
	Op string `json:"op"`
}
type Permission = string
type GuildInfo struct {
	ID             ID        `json:"id"`
	OwnerID        ID        `json:"owner_id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Icon           string    `json:"icon"`
	InvitesEnabled bool      `json:"invites_enabled"`
	Revision       int64     `json:"revision"`
	CreatedAt      Timestamp `json:"created_at"`
	Permissions    []string  `json:"permissions"`
}
type GuildCreate struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Icon        *string `json:"icon,omitempty"`
}
type GuildPatch struct {
	Name           *string `json:"name,omitempty"`
	Description    *string `json:"description,omitempty"`
	Icon           *string `json:"icon,omitempty"`
	InvitesEnabled *bool   `json:"invites_enabled,omitempty"`
}
type GuildRole struct {
	ID          ID       `json:"id"`
	GuildID     ID       `json:"guild_id"`
	Name        string   `json:"name"`
	Position    int64    `json:"position"`
	Permissions []string `json:"permissions"`
	IsDefault   bool     `json:"is_default"`
	CanEdit     bool     `json:"can_edit"`
	CanAssign   bool     `json:"can_assign"`
}
type GuildRoleInput struct {
	Name        string   `json:"name"`
	Position    int64    `json:"position"`
	Permissions []string `json:"permissions"`
}
type GuildRolePatch struct {
	Name        *string   `json:"name,omitempty"`
	Permissions *[]string `json:"permissions,omitempty"`
}
type RoleOrderInput struct {
	RoleIDs []ID `json:"role_ids"`
}
type CategoryOrderEntry struct {
	ID       ID    `json:"id"`
	Position int64 `json:"position"`
}
type ChannelOrderEntry struct {
	ID         ID      `json:"id"`
	Position   int64   `json:"position"`
	CategoryID *string `json:"category_id,omitempty"`
}
type ChannelOrderInput struct {
	Categories *[]CategoryOrderEntry `json:"categories,omitempty"`
	Channels   *[]ChannelOrderEntry  `json:"channels,omitempty"`
}
type GuildMember struct {
	GuildID         ID            `json:"guild_id"`
	User            PublicProfile `json:"user"`
	JoinedAt        Timestamp     `json:"joined_at"`
	State           string        `json:"state"`
	RoleIDs         []ID          `json:"role_ids"`
	HighestPosition int64         `json:"highest_position"`
	CanManage       bool          `json:"can_manage"`
}
type GuildCategory struct {
	ID          ID       `json:"id"`
	GuildID     ID       `json:"guild_id"`
	Name        string   `json:"name"`
	Position    int64    `json:"position"`
	Permissions []string `json:"permissions"`
}
type CategoryInput struct {
	Name     string `json:"name"`
	Position int64  `json:"position"`
}
type CategoryPatch struct {
	Name     *string `json:"name,omitempty"`
	Position *int64  `json:"position,omitempty"`
}
type CategoryDeleteInput struct {
	DetachChildren bool `json:"detach_children"`
}
type GuildChannel struct {
	ID          ID       `json:"id"`
	GuildID     ID       `json:"guild_id"`
	CategoryID  *ID      `json:"category_id,omitempty"`
	Name        string   `json:"name"`
	Kind        string   `json:"kind"`
	Position    int64    `json:"position"`
	State       string   `json:"state"`
	Revision    int64    `json:"revision"`
	Permissions []string `json:"permissions"`
}
type ChannelInput struct {
	Name       string  `json:"name"`
	Kind       string  `json:"kind"`
	CategoryID *string `json:"category_id,omitempty"`
	Position   int64   `json:"position"`
}
type ChannelPatch struct {
	Name       *string `json:"name,omitempty"`
	CategoryID *string `json:"category_id,omitempty"`
	Position   *int64  `json:"position,omitempty"`
}
type GuildOverwrite struct {
	ID          ID       `json:"id"`
	ResourceID  ID       `json:"resource_id"`
	SubjectKind string   `json:"subject_kind"`
	SubjectID   ID       `json:"subject_id"`
	Allow       []string `json:"allow"`
	Deny        []string `json:"deny"`
}
type OverwriteInput struct {
	Allow []string `json:"allow"`
	Deny  []string `json:"deny"`
}
type GuildInvite struct {
	ID        ID        `json:"id"`
	GuildID   ID        `json:"guild_id"`
	CreatorID ID        `json:"creator_id"`
	ChannelID ID        `json:"channel_id"`
	MaxUses   int64     `json:"max_uses"`
	Uses      int64     `json:"uses"`
	ExpiresAt Timestamp `json:"expires_at"`
	Revoked   bool      `json:"revoked"`
}
type InviteInput struct {
	ChannelID  ID    `json:"channel_id"`
	MaxUses    int64 `json:"max_uses"`
	TtlSeconds int64 `json:"ttl_seconds"`
}
type CreatedInvite struct {
	Invite   GuildInvite `json:"invite"`
	Code     string      `json:"code"`
	Revision int64       `json:"revision"`
}
type InvitePreview struct {
	GuildID   ID        `json:"guild_id"`
	Name      string    `json:"name"`
	Icon      string    `json:"icon"`
	ExpiresAt Timestamp `json:"expires_at"`
}
type InviteAccepted struct {
	GuildID       ID    `json:"guild_id"`
	AlreadyMember bool  `json:"already_member"`
	Revision      int64 `json:"revision"`
}
type GuildAudit struct {
	Reason    *string   `json:"reason,omitempty"`
	ID        ID        `json:"id"`
	GuildID   ID        `json:"guild_id"`
	ActorID   ID        `json:"actor_id"`
	Action    string    `json:"action"`
	TargetID  ID        `json:"target_id"`
	Revision  int64     `json:"revision"`
	CreatedAt Timestamp `json:"created_at"`
}
type GuildRevision struct {
	Revision int64 `json:"revision"`
}
type ConfirmationInput struct {
	Action       string `json:"action"`
	TargetUserID *ID    `json:"target_user_id,omitempty"`
}
type GuildConfirmation struct {
	ID           ID        `json:"id"`
	Token        string    `json:"token"`
	Action       string    `json:"action"`
	TargetUserID *ID       `json:"target_user_id,omitempty"`
	Revision     int64     `json:"revision"`
	ExpiresAt    Timestamp `json:"expires_at"`
}
type ConfirmationProof struct {
	ConfirmationID    ID     `json:"confirmation_id"`
	ConfirmationToken string `json:"confirmation_token"`
}
type ChannelGrantClaims struct {
	SchemaVersion int64  `json:"schema_version"`
	JTI           ID     `json:"jti"`
	Issuer        string `json:"issuer"`
	Subject       ID     `json:"subject"`
	SessionID     ID     `json:"session_id"`
	Audience      string `json:"audience"`
	Action        string `json:"action"`
	ResourceID    ID     `json:"resource_id"`
	GuildID       ID     `json:"guild_id"`
	ACLRevision   int64  `json:"acl_revision"`
	IssuedAtUnix  int64  `json:"issued_at_unix"`
	ExpiresAtUnix int64  `json:"expires_at_unix"`
}
type ChannelAccess struct {
	Allowed    bool    `json:"allowed"`
	Reason     string  `json:"reason"`
	GuildID    ID      `json:"guild_id"`
	ResourceID ID      `json:"resource_id"`
	Operation  string  `json:"operation"`
	Revision   int64   `json:"revision"`
	Capability *string `json:"capability,omitempty"`
}
type GuildWSEvent struct {
	Kind      string `json:"kind"`
	GuildID   ID     `json:"guild_id"`
	ChannelID ID     `json:"channel_id"`
	Operation string `json:"operation"`
	Revision  int64  `json:"revision"`
}
type GuildList struct {
	Items []GuildInfo `json:"items"`
}
type GuildRoleList struct {
	Items    []GuildRole `json:"items"`
	Revision int64       `json:"revision"`
}
type GuildMemberList struct {
	Items    []GuildMember `json:"items"`
	Revision int64         `json:"revision"`
}
type GuildCategoryList struct {
	Items    []GuildCategory `json:"items"`
	Revision int64           `json:"revision"`
}
type GuildChannelList struct {
	Items    []GuildChannel `json:"items"`
	Revision int64          `json:"revision"`
}
type GuildOverwriteList struct {
	Items    []GuildOverwrite `json:"items"`
	Revision int64            `json:"revision"`
}
type GuildInviteList struct {
	Items    []GuildInvite `json:"items"`
	Revision int64         `json:"revision"`
}
type GuildAuditList struct {
	NextCursor *string      `json:"next_cursor,omitempty"`
	Items      []GuildAudit `json:"items"`
	Revision   int64        `json:"revision"`
}
type ChatMember struct {
	ID   ID     `json:"id"`
	Name string `json:"name"`
}
type ChatMention struct {
	ID   ID     `json:"id"`
	Kind string `json:"kind"`
}
type ChatRoom struct {
	CanAttach  *bool        `json:"can_attach,omitempty"`
	ID         ID           `json:"id"`
	Kind       string       `json:"kind"`
	Name       string       `json:"name"`
	Revision   int64        `json:"revision"`
	CanSend    bool         `json:"can_send"`
	CanManage  bool         `json:"can_manage"`
	CanThread  bool         `json:"can_thread"`
	CanDeliver bool         `json:"can_deliver"`
	Members    []ChatMember `json:"members"`
	Roles      []ChatMember `json:"roles"`
}
type ChatGrant struct {
	Webhook          *WebhookSender `json:"webhook,omitempty"`
	SchemaVersion    int64          `json:"schema_version"`
	Audience         string         `json:"audience"`
	UserID           ID             `json:"user_id"`
	SessionID        ID             `json:"session_id"`
	Method           string         `json:"method"`
	Path             string         `json:"path"`
	BodyHash         string         `json:"body_hash"`
	ExpiresAt        int64          `json:"expires_at"`
	FencePid         int64          `json:"fence_pid"`
	FenceTransaction string         `json:"fence_transaction"`
	Room             ChatRoom       `json:"room"`
}
type Conversation struct {
	ID       ID           `json:"id"`
	Kind     string       `json:"kind"`
	Name     string       `json:"name"`
	OwnerID  ID           `json:"owner_id"`
	Revision int64        `json:"revision"`
	Members  []ChatMember `json:"members"`
}
type ConversationInput struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	MemberIDs []ID   `json:"member_ids"`
}
type ConversationList struct {
	Items []Conversation `json:"items"`
}
type MediaGrant struct {
	SchemaVersion    int64    `json:"schema_version"`
	Audience         string   `json:"audience"`
	UserID           ID       `json:"user_id"`
	SessionID        ID       `json:"session_id"`
	Method           string   `json:"method"`
	Path             string   `json:"path"`
	BodyHash         string   `json:"body_hash"`
	ExpiresAt        int64    `json:"expires_at"`
	FencePid         int64    `json:"fence_pid"`
	FenceTransaction string   `json:"fence_transaction"`
	Room             ChatRoom `json:"room"`
}
type UploadInput struct {
	ClientID  ID     `json:"client_id"`
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
}
type UploadStatus struct {
	ID        ID           `json:"id"`
	RoomID    ID           `json:"room_id"`
	Filename  string       `json:"filename"`
	SizeBytes int64        `json:"size_bytes"`
	State     string       `json:"state"`
	Received  bool         `json:"received"`
	ExpiresAt Timestamp    `json:"expires_at"`
	Error     *string      `json:"error,omitempty"`
	File      *MessageFile `json:"file,omitempty"`
}
type MessageFile struct {
	ID          ID     `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	Sha256      string `json:"sha256"`
	HasPreview  bool   `json:"has_preview"`
}
type SearchRoom struct {
	ID      ID     `json:"id"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	GuildID *ID    `json:"guild_id,omitempty"`
}
type SearchGrant struct {
	SchemaVersion    int64        `json:"schema_version"`
	Audience         string       `json:"audience"`
	UserID           ID           `json:"user_id"`
	Path             string       `json:"path"`
	ExpiresAt        int64        `json:"expires_at"`
	FencePid         int64        `json:"fence_pid"`
	FenceTransaction string       `json:"fence_transaction"`
	Rooms            []SearchRoom `json:"rooms"`
}
type SearchHit struct {
	MessageID ID         `json:"message_id"`
	Room      SearchRoom `json:"room"`
	AuthorID  ID         `json:"author_id"`
	ThreadID  *ID        `json:"thread_id,omitempty"`
	Snippet   string     `json:"snippet"`
	CreatedAt Timestamp  `json:"created_at"`
}
type SearchPage struct {
	Items     []SearchHit `json:"items"`
	Cursor    *string     `json:"cursor,omitempty"`
	IndexedAt Timestamp   `json:"indexed_at"`
}
type ChatReaction struct {
	Emoji string `json:"emoji"`
	Count int64  `json:"count"`
	Mine  bool   `json:"mine"`
}
type ChatMessage struct {
	Webhook     *WebhookSender `json:"webhook,omitempty"`
	Attachments *[]MessageFile `json:"attachments,omitempty"`
	ID          ID             `json:"id"`
	RoomID      ID             `json:"room_id"`
	AuthorID    ID             `json:"author_id"`
	ClientID    ID             `json:"client_id"`
	Ordinal     int64          `json:"ordinal"`
	Revision    int64          `json:"revision"`
	Content     string         `json:"content"`
	CreatedAt   Timestamp      `json:"created_at"`
	EditedAt    *Timestamp     `json:"edited_at,omitempty"`
	Deleted     bool           `json:"deleted"`
	ReplyTo     *ID            `json:"reply_to,omitempty"`
	ThreadID    *ID            `json:"thread_id,omitempty"`
	Mentions    []ChatMention  `json:"mentions"`
	Reactions   []ChatReaction `json:"reactions"`
	Pinned      bool           `json:"pinned"`
}
type ChatSend struct {
	UploadIDs *[]ID         `json:"upload_ids,omitempty"`
	ClientID  ID            `json:"client_id"`
	Content   string        `json:"content"`
	ReplyTo   *ID           `json:"reply_to,omitempty"`
	ThreadID  *ID           `json:"thread_id,omitempty"`
	Mentions  []ChatMention `json:"mentions"`
}
type ChatEdit struct {
	Revision int64         `json:"revision"`
	Content  string        `json:"content"`
	Mentions []ChatMention `json:"mentions"`
}
type ChatVersion struct {
	Revision int64 `json:"revision"`
}
type ChatThread struct {
	ID        ID     `json:"id"`
	RoomID    ID     `json:"room_id"`
	RootID    ID     `json:"root_id"`
	CreatorID ID     `json:"creator_id"`
	Name      string `json:"name"`
	Archived  bool   `json:"archived"`
	Revision  int64  `json:"revision"`
}
type ChatThreadInput struct {
	Name string `json:"name"`
}
type ChatThreadEdit struct {
	Revision int64 `json:"revision"`
	Archived bool  `json:"archived"`
}
type ChatThreadList struct {
	Items []ChatThread `json:"items"`
}
type ChatRead struct {
	Ordinal int64 `json:"ordinal"`
	Unread  int64 `json:"unread"`
}
type ChatReadInput struct {
	MessageID ID `json:"message_id"`
}
type ChatPage struct {
	Items    []ChatMessage `json:"items"`
	Cursor   *string       `json:"cursor,omitempty"`
	Sequence int64         `json:"sequence"`
	Room     ChatRoom      `json:"room"`
	Read     ChatRead      `json:"read"`
}
type ChatEvent struct {
	ID            ID           `json:"id"`
	Sequence      int64        `json:"sequence"`
	SchemaVersion int64        `json:"schema_version"`
	Kind          string       `json:"kind"`
	RoomID        ID           `json:"room_id"`
	Message       *ChatMessage `json:"message,omitempty"`
	Thread        *ChatThread  `json:"thread,omitempty"`
	UserID        *ID          `json:"user_id,omitempty"`
}
type ChatEvents struct {
	Events   []ChatEvent `json:"events"`
	Sequence int64       `json:"sequence"`
	HasMore  bool        `json:"has_more"`
	Room     ChatRoom    `json:"room"`
	Read     ChatRead    `json:"read"`
	Typing   []ID        `json:"typing"`
	Presence []ID        `json:"presence"`
}
type ChatCommand struct {
	Op            string  `json:"op"`
	RequestID     ID      `json:"request_id"`
	SchemaVersion int64   `json:"schema_version"`
	RoomID        *ID     `json:"room_id,omitempty"`
	RoomKind      *string `json:"room_kind,omitempty"`
	After         *int64  `json:"after,omitempty"`
}
type ChatFrame struct {
	Op            string      `json:"op"`
	SchemaVersion int64       `json:"schema_version"`
	RequestID     *ID         `json:"request_id,omitempty"`
	Code          *string     `json:"code,omitempty"`
	Data          *ChatEvents `json:"data,omitempty"`
}
type VoiceJoinInput struct {
	DeviceID ID `json:"device_id"`
	CallID   ID `json:"call_id"`
}
type VoiceGrant struct {
	SchemaVersion int64  `json:"schema_version"`
	Audience      string `json:"audience"`
	UserID        ID     `json:"user_id"`
	SessionID     ID     `json:"session_id"`
	DeviceID      ID     `json:"device_id"`
	CallID        ID     `json:"call_id"`
	ChannelID     ID     `json:"channel_id"`
	GuildID       ID     `json:"guild_id"`
	ChannelName   string `json:"channel_name"`
	DisplayName   string `json:"display_name"`
	CanSpeak      bool   `json:"can_speak"`
	CanStream     bool   `json:"can_stream"`
	CanViewStream bool   `json:"can_view_stream"`
	Revision      int64  `json:"revision"`
	IssuedAtUnix  int64  `json:"issued_at_unix"`
	ExpiresAtUnix int64  `json:"expires_at_unix"`
}
type VoiceIceServer struct {
	Urls       []string `json:"urls"`
	Username   *string  `json:"username,omitempty"`
	Credential *string  `json:"credential,omitempty"`
}
type VoiceJoin struct {
	Grant           string           `json:"grant"`
	SignalingPath   string           `json:"signaling_path"`
	IceServers      []VoiceIceServer `json:"ice_servers"`
	MaxParticipants int64            `json:"max_participants"`
	MaxWidth        int64            `json:"max_width"`
	MaxHeight       int64            `json:"max_height"`
	MaxVideoBitrate int64            `json:"max_video_bitrate"`
}
type VoiceParticipant struct {
	ID            ID     `json:"id"`
	UserID        ID     `json:"user_id"`
	DeviceID      ID     `json:"device_id"`
	CallID        ID     `json:"call_id"`
	TransportID   ID     `json:"transport_id"`
	Slot          int64  `json:"slot"`
	DisplayName   string `json:"display_name"`
	CanSpeak      bool   `json:"can_speak"`
	CanStream     bool   `json:"can_stream"`
	CanViewStream bool   `json:"can_view_stream"`
}
type VoicePublication struct {
	ID            ID     `json:"id"`
	ParticipantID ID     `json:"participant_id"`
	Kind          string `json:"kind"`
	Active        bool   `json:"active"`
}
type VoiceSubscription struct {
	ID            ID     `json:"id"`
	PublicationID ID     `json:"publication_id"`
	Mid           string `json:"mid"`
}
type VoiceRoomState struct {
	ID            ID                  `json:"id"`
	GuildID       ID                  `json:"guild_id"`
	Name          string              `json:"name"`
	Participants  []VoiceParticipant  `json:"participants"`
	Publications  []VoicePublication  `json:"publications"`
	Subscriptions []VoiceSubscription `json:"subscriptions"`
}
type VoiceCommand struct {
	SchemaVersion int64   `json:"schema_version"`
	Op            string  `json:"op"`
	RequestID     ID      `json:"request_id"`
	Grant         *string `json:"grant,omitempty"`
	Sdp           *string `json:"sdp,omitempty"`
	Kind          *string `json:"kind,omitempty"`
	Active        *bool   `json:"active,omitempty"`
	SoundID       *ID     `json:"sound_id,omitempty"`
}
type VoiceStats struct {
	ReceivedFrames  int64 `json:"received_frames"`
	ForwardedFrames int64 `json:"forwarded_frames"`
	DroppedFrames   int64 `json:"dropped_frames"`
}
type VoiceFrame struct {
	SchemaVersion int64           `json:"schema_version"`
	Op            string          `json:"op"`
	RequestID     *ID             `json:"request_id,omitempty"`
	Code          *string         `json:"code,omitempty"`
	ParticipantID *ID             `json:"participant_id,omitempty"`
	TransportID   *ID             `json:"transport_id,omitempty"`
	Slot          *int64          `json:"slot,omitempty"`
	Sdp           *string         `json:"sdp,omitempty"`
	Room          *VoiceRoomState `json:"room,omitempty"`
	Stats         *VoiceStats     `json:"stats,omitempty"`
	PlayID        *ID             `json:"play_id,omitempty"`
	SoundID       *ID             `json:"sound_id,omitempty"`
	Name          *string         `json:"name,omitempty"`
	Emoji         *string         `json:"emoji,omitempty"`
	ActorID       *ID             `json:"actor_id,omitempty"`
	AudioUrl      *string         `json:"audio_url,omitempty"`
}
type ID = string
type Timestamp = string

func RoundTrip(name string, data []byte) ([]byte, error) {
	var value any
	switch name {
	case "User":
		value = &User{}
	case "Guild":
		value = &Guild{}
	case "Membership":
		value = &Membership{}
	case "Role":
		value = &Role{}
	case "Category":
		value = &Category{}
	case "Channel":
		value = &Channel{}
	case "Attachment":
		value = &Attachment{}
	case "Message":
		value = &Message{}
	case "MessageEdited":
		value = &MessageEdited{}
	case "MessageDeleted":
		value = &MessageDeleted{}
	case "WSCommand":
		value = &WSCommand{}
	case "WSAck":
		value = &WSAck{}
	case "WSEvent":
		value = &WSEvent{}
	case "Heartbeat":
		value = &Heartbeat{}
	case "ServiceRequest":
		value = &ServiceRequest{}
	case "ServiceEvent":
		value = &ServiceEvent{}
	case "Capability":
		value = &Capability{}
	case "ValidationDetail":
		value = &ValidationDetail{}
	case "ErrorResponse":
		value = &ErrorResponse{}
	case "DependencyStatus":
		value = &DependencyStatus{}
	case "HealthResponse":
		value = &HealthResponse{}
	case "VersionResponse":
		value = &VersionResponse{}
	case "PageCursor":
		value = &PageCursor{}
	case "PublicProfile":
		value = &PublicProfile{}
	case "RegisterInput":
		value = &RegisterInput{}
	case "LoginInput":
		value = &LoginInput{}
	case "ProfilePatch":
		value = &ProfilePatch{}
	case "PrivacySettings":
		value = &PrivacySettings{}
	case "SettingsPatch":
		value = &SettingsPatch{}
	case "SessionInfo":
		value = &SessionInfo{}
	case "CommunitySettings":
		value = &CommunitySettings{}
	case "CommunityChanged":
		value = &CommunityChanged{}
	case "NotificationRule":
		value = &NotificationRule{}
	case "NotificationRuleInput":
		value = &NotificationRuleInput{}
	case "NotificationRuleList":
		value = &NotificationRuleList{}
	case "InboxItem":
		value = &InboxItem{}
	case "InboxPage":
		value = &InboxPage{}
	case "NotificationClaim":
		value = &NotificationClaim{}
	case "FavoriteChannel":
		value = &FavoriteChannel{}
	case "FavoriteList":
		value = &FavoriteList{}
	case "ModerationInput":
		value = &ModerationInput{}
	case "ModerationRevoke":
		value = &ModerationRevoke{}
	case "ModerationRecord":
		value = &ModerationRecord{}
	case "ModerationList":
		value = &ModerationList{}
	case "WebhookSender":
		value = &WebhookSender{}
	case "WebhookInput":
		value = &WebhookInput{}
	case "WebhookInfo":
		value = &WebhookInfo{}
	case "WebhookSecret":
		value = &WebhookSecret{}
	case "WebhookList":
		value = &WebhookList{}
	case "WebhookSend":
		value = &WebhookSend{}
	case "AuthSession":
		value = &AuthSession{}
	case "FriendRequestInput":
		value = &FriendRequestInput{}
	case "FriendRequest":
		value = &FriendRequest{}
	case "ContactEligibility":
		value = &ContactEligibility{}
	case "ProfilePage":
		value = &ProfilePage{}
	case "RequestPage":
		value = &RequestPage{}
	case "SessionPage":
		value = &SessionPage{}
	case "IdentityWSReady":
		value = &IdentityWSReady{}
	case "IdentityPing":
		value = &IdentityPing{}
	case "IdentityPong":
		value = &IdentityPong{}
	case "GuildInfo":
		value = &GuildInfo{}
	case "GuildCreate":
		value = &GuildCreate{}
	case "GuildPatch":
		value = &GuildPatch{}
	case "GuildRole":
		value = &GuildRole{}
	case "GuildRoleInput":
		value = &GuildRoleInput{}
	case "GuildRolePatch":
		value = &GuildRolePatch{}
	case "RoleOrderInput":
		value = &RoleOrderInput{}
	case "CategoryOrderEntry":
		value = &CategoryOrderEntry{}
	case "ChannelOrderEntry":
		value = &ChannelOrderEntry{}
	case "ChannelOrderInput":
		value = &ChannelOrderInput{}
	case "GuildMember":
		value = &GuildMember{}
	case "GuildCategory":
		value = &GuildCategory{}
	case "CategoryInput":
		value = &CategoryInput{}
	case "CategoryPatch":
		value = &CategoryPatch{}
	case "CategoryDeleteInput":
		value = &CategoryDeleteInput{}
	case "GuildChannel":
		value = &GuildChannel{}
	case "ChannelInput":
		value = &ChannelInput{}
	case "ChannelPatch":
		value = &ChannelPatch{}
	case "GuildOverwrite":
		value = &GuildOverwrite{}
	case "OverwriteInput":
		value = &OverwriteInput{}
	case "GuildInvite":
		value = &GuildInvite{}
	case "InviteInput":
		value = &InviteInput{}
	case "CreatedInvite":
		value = &CreatedInvite{}
	case "InvitePreview":
		value = &InvitePreview{}
	case "InviteAccepted":
		value = &InviteAccepted{}
	case "GuildAudit":
		value = &GuildAudit{}
	case "GuildRevision":
		value = &GuildRevision{}
	case "ConfirmationInput":
		value = &ConfirmationInput{}
	case "GuildConfirmation":
		value = &GuildConfirmation{}
	case "ConfirmationProof":
		value = &ConfirmationProof{}
	case "ChannelGrantClaims":
		value = &ChannelGrantClaims{}
	case "ChannelAccess":
		value = &ChannelAccess{}
	case "GuildWSEvent":
		value = &GuildWSEvent{}
	case "GuildList":
		value = &GuildList{}
	case "GuildRoleList":
		value = &GuildRoleList{}
	case "GuildMemberList":
		value = &GuildMemberList{}
	case "GuildCategoryList":
		value = &GuildCategoryList{}
	case "GuildChannelList":
		value = &GuildChannelList{}
	case "GuildOverwriteList":
		value = &GuildOverwriteList{}
	case "GuildInviteList":
		value = &GuildInviteList{}
	case "GuildAuditList":
		value = &GuildAuditList{}
	case "ChatMember":
		value = &ChatMember{}
	case "ChatMention":
		value = &ChatMention{}
	case "ChatRoom":
		value = &ChatRoom{}
	case "ChatGrant":
		value = &ChatGrant{}
	case "Conversation":
		value = &Conversation{}
	case "ConversationInput":
		value = &ConversationInput{}
	case "ConversationList":
		value = &ConversationList{}
	case "MediaGrant":
		value = &MediaGrant{}
	case "UploadInput":
		value = &UploadInput{}
	case "UploadStatus":
		value = &UploadStatus{}
	case "MessageFile":
		value = &MessageFile{}
	case "SearchRoom":
		value = &SearchRoom{}
	case "SearchGrant":
		value = &SearchGrant{}
	case "SearchHit":
		value = &SearchHit{}
	case "SearchPage":
		value = &SearchPage{}
	case "ChatReaction":
		value = &ChatReaction{}
	case "ChatMessage":
		value = &ChatMessage{}
	case "ChatSend":
		value = &ChatSend{}
	case "ChatEdit":
		value = &ChatEdit{}
	case "ChatVersion":
		value = &ChatVersion{}
	case "ChatThread":
		value = &ChatThread{}
	case "ChatThreadInput":
		value = &ChatThreadInput{}
	case "ChatThreadEdit":
		value = &ChatThreadEdit{}
	case "ChatThreadList":
		value = &ChatThreadList{}
	case "ChatRead":
		value = &ChatRead{}
	case "ChatReadInput":
		value = &ChatReadInput{}
	case "ChatPage":
		value = &ChatPage{}
	case "ChatEvent":
		value = &ChatEvent{}
	case "ChatEvents":
		value = &ChatEvents{}
	case "ChatCommand":
		value = &ChatCommand{}
	case "ChatFrame":
		value = &ChatFrame{}
	case "VoiceJoinInput":
		value = &VoiceJoinInput{}
	case "VoiceGrant":
		value = &VoiceGrant{}
	case "VoiceIceServer":
		value = &VoiceIceServer{}
	case "VoiceJoin":
		value = &VoiceJoin{}
	case "VoiceParticipant":
		value = &VoiceParticipant{}
	case "VoicePublication":
		value = &VoicePublication{}
	case "VoiceSubscription":
		value = &VoiceSubscription{}
	case "VoiceRoomState":
		value = &VoiceRoomState{}
	case "VoiceCommand":
		value = &VoiceCommand{}
	case "VoiceStats":
		value = &VoiceStats{}
	case "VoiceFrame":
		value = &VoiceFrame{}
	default:
		return nil, fmt.Errorf("unknown contract %s", name)
	}
	if err := json.Unmarshal(data, value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}
