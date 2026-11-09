export interface User {
id: ID;
login: string;
display_name: string;
created_at: Timestamp;
}
export interface Guild {
id: ID;
owner_id: ID;
name: string;
created_at: Timestamp;
}
export interface Membership {
guild_id: ID;
user_id: ID;
role_ids: Array<ID>;
joined_at: Timestamp;
}
export interface Role {
id: ID;
guild_id: ID;
name: string;
permissions: Array<string>;
position: number;
}
export interface Category {
id: ID;
guild_id: ID;
name: string;
position: number;
}
export interface Channel {
id: ID;
guild_id?: ID;
category_id?: ID;
kind: "text" | "voice" | "dm" | "thread";
name: string;
position: number;
created_at: Timestamp;
}
export interface Attachment {
id: ID;
owner_id: ID;
message_id?: ID;
filename: string;
content_type: string;
size_bytes: number;
state: "pending" | "ready" | "rejected";
created_at: Timestamp;
}
export interface Message {
id: ID;
channel_id: ID;
author_id: ID;
content: string;
attachments: Array<Attachment>;
revision: number;
created_at: Timestamp;
edited_at?: Timestamp;
}
export interface MessageEdited {
message: Message;
edited_at: Timestamp;
}
export interface MessageDeleted {
message_id: ID;
channel_id: ID;
revision: number;
deleted_at: Timestamp;
}
export interface WSCommand {
schema_version: 1;
request_id: ID;
op: "subscribe" | "unsubscribe";
channel_id: ID;
after_event_id?: ID;
}
export interface WSAck {
schema_version: 1;
request_id: ID;
accepted: boolean;
error?: ErrorResponse;
}
export interface WSEvent {
schema_version: 1;
event_id: ID;
channel_id: ID;
kind: "message.created" | "message.edited" | "message.deleted";
payload_json: string;
occurred_at: Timestamp;
}
export interface Heartbeat {
schema_version: 1;
op: "ping" | "pong";
nonce: ID;
sent_at: Timestamp;
}
export interface ServiceRequest {
schema_version: 1;
request_id: ID;
caller: "api" | "realtime" | "media" | "voice";
action: string;
resource_id: ID;
capability_token: string;
idempotency_key?: ID;
}
export interface ServiceEvent {
schema_version: 1;
event_id: ID;
producer: "api" | "realtime" | "media" | "voice";
kind: string;
aggregate_id: ID;
revision: number;
payload_json: string;
occurred_at: Timestamp;
request_id: ID;
}
export interface Capability {
schema_version: 1;
jti: ID;
issuer: "api";
subject: ID;
audience: "realtime" | "media" | "voice";
actions: Array<string>;
resource_id: ID;
acl_revision: number;
issued_at: Timestamp;
expires_at: Timestamp;
}
export interface ValidationDetail {
field: string;
reason: string;
}
export interface ErrorResponse {
code: string;
message: string;
request_id: ID;
details?: Array<ValidationDetail>;
}
export interface DependencyStatus {
name: string;
status: "up" | "down";
}
export interface HealthResponse {
service: string;
status: "ok" | "unavailable";
request_id: ID;
dependencies: Array<DependencyStatus>;
}
export interface VersionResponse {
service: string;
version: string;
api_version: "v1";
schema_version: 1;
request_id: ID;
}
export interface PageCursor {
limit: number;
after?: string;
}
export interface PublicProfile {
id: ID;
login: string;
display_name: string;
avatar: "violet" | "mint" | "amber" | "rose" | "sky";
created_at: Timestamp;
}
export interface RegisterInput {
login: string;
password: string;
display_name: string;
}
export interface LoginInput {
login: string;
password: string;
device?: string;
}
export interface ProfilePatch {
display_name?: string;
avatar?: "violet" | "mint" | "amber" | "rose" | "sky";
}
export interface PrivacySettings {
discoverable: boolean;
friend_requests: "everyone" | "nobody";
dm_policy: "everyone" | "friends" | "nobody";
}
export interface SettingsPatch {
discoverable?: boolean;
friend_requests?: "everyone" | "nobody";
dm_policy?: "everyone" | "friends" | "nobody";
}
export interface SessionInfo {
id: ID;
user_id: ID;
issued_at: Timestamp;
expires_at: Timestamp;
revoked_at?: Timestamp;
device: string;
current: boolean;
}
export interface CommunitySettings {
browser_notifications: boolean;
}
export interface CommunityChanged {
kind: "community.changed";
revision: number;
}
export interface NotificationRule {
scope: "user" | "guild" | "channel";
scope_id: string;
mode: "all" | "mentions" | "mute" | "inherit";
mute_until?: Timestamp;
}
export interface NotificationRuleInput {
mode: "all" | "mentions" | "mute" | "inherit";
duration_seconds: number;
}
export interface NotificationRuleList {
items: Array<NotificationRule>;
}
export interface InboxItem {
id: ID;
sequence: number;
message_id: ID;
room_id: ID;
room_kind: "channel" | "conversation";
guild_id?: ID;
thread_id?: ID;
name: string;
mention: boolean;
read: boolean;
created_at: Timestamp;
}
export interface InboxPage {
items: Array<InboxItem>;
revision: number;
next_cursor?: string;
}
export interface NotificationClaim {
claimed: boolean;
}
export interface FavoriteChannel {
channel_id: ID;
guild_id: ID;
name: string;
kind: "TEXT" | "FORUM" | "VOICE";
}
export interface FavoriteList {
items: Array<FavoriteChannel>;
}
export interface ModerationInput {
user_id: ID;
kind: "KICK" | "BAN" | "MUTE_TEXT" | "MUTE_VOICE";
reason: string;
duration_seconds: number;
}
export interface ModerationRevoke {
reason: string;
}
export interface ModerationRecord {
id: ID;
guild_id: ID;
user_id: ID;
actor_id: ID;
kind: "KICK" | "BAN" | "MUTE_TEXT" | "MUTE_VOICE";
reason: string;
created_at: Timestamp;
expires_at?: Timestamp;
revoked_at?: Timestamp;
revocation_reason?: string;
active: boolean;
can_revoke: boolean;
}
export interface ModerationList {
items: Array<ModerationRecord>;
revision: number;
}
export interface WebhookSender {
id: ID;
name: string;
avatar: "violet" | "mint" | "amber" | "rose" | "sky";
}
export interface WebhookInput {
channel_id: ID;
name: string;
avatar: "violet" | "mint" | "amber" | "rose" | "sky";
}
export interface WebhookInfo {
id: ID;
guild_id: ID;
channel_id: ID;
creator_id: ID;
name: string;
avatar: string;
created_at: Timestamp;
revoked_at?: Timestamp;
}
export interface WebhookSecret {
webhook: WebhookInfo;
secret: string;
revision: number;
}
export interface WebhookList {
items: Array<WebhookInfo>;
revision: number;
}
export interface WebhookSend {
client_id: ID;
content: string;
}
export interface AuthSession {
user: PublicProfile;
session_id: ID;
community_revision?: number;
access_expires_at: Timestamp;
expires_at: Timestamp;
}
export interface FriendRequestInput {
user_id: ID;
}
export interface FriendRequest {
id: ID;
sender: PublicProfile;
recipient: PublicProfile;
status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
created_at: Timestamp;
updated_at: Timestamp;
}
export interface ContactEligibility {
user_id: ID;
allowed: boolean;
}
export interface ProfilePage {
items: Array<PublicProfile>;
next_cursor?: string;
}
export interface RequestPage {
items: Array<FriendRequest>;
next_cursor?: string;
}
export interface SessionPage {
items: Array<SessionInfo>;
next_cursor?: string;
}
export interface IdentityWSReady {
kind: "session.ready";
user_id: ID;
session_id: ID;
}
export interface IdentityPing {
op: "ping";
}
export interface IdentityPong {
op: "pong";
}
export type Permission = "VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD";
export interface GuildInfo {
id: ID;
owner_id: ID;
name: string;
description: string;
icon: "violet" | "mint" | "amber" | "rose" | "sky";
invites_enabled: boolean;
revision: number;
created_at: Timestamp;
permissions: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface GuildCreate {
name: string;
description?: string;
icon?: "violet" | "mint" | "amber" | "rose" | "sky";
}
export interface GuildPatch {
name?: string;
description?: string;
icon?: "violet" | "mint" | "amber" | "rose" | "sky";
invites_enabled?: boolean;
}
export interface GuildRole {
id: ID;
guild_id: ID;
name: string;
position: number;
permissions: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
is_default: boolean;
can_edit: boolean;
can_assign: boolean;
}
export interface GuildRoleInput {
name: string;
position: number;
permissions: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface GuildRolePatch {
name?: string;
permissions?: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface RoleOrderInput {
role_ids: Array<ID>;
}
export interface CategoryOrderEntry {
id: ID;
position: number;
}
export interface ChannelOrderEntry {
id: ID;
position: number;
category_id?: string;
}
export interface ChannelOrderInput {
categories?: Array<CategoryOrderEntry>;
channels?: Array<ChannelOrderEntry>;
}
export interface GuildMember {
guild_id: ID;
user: PublicProfile;
joined_at: Timestamp;
state: "ACTIVE" | "LEFT" | "KICKED";
role_ids: Array<ID>;
highest_position: number;
can_manage: boolean;
}
export interface GuildCategory {
id: ID;
guild_id: ID;
name: string;
position: number;
permissions: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface CategoryInput {
name: string;
position: number;
}
export interface CategoryPatch {
name?: string;
position?: number;
}
export interface CategoryDeleteInput {
detach_children: boolean;
}
export interface GuildChannel {
id: ID;
guild_id: ID;
category_id?: ID;
name: string;
kind: "TEXT" | "VOICE" | "FORUM";
position: number;
state: "ACTIVE" | "ARCHIVED";
revision: number;
permissions: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface ChannelInput {
name: string;
kind: "TEXT" | "VOICE" | "FORUM";
category_id?: string;
position: number;
}
export interface ChannelPatch {
name?: string;
category_id?: string;
position?: number;
}
export interface GuildOverwrite {
id: ID;
resource_id: ID;
subject_kind: "user" | "role";
subject_id: ID;
allow: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
deny: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface OverwriteInput {
allow: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
deny: Array<"VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD">;
}
export interface GuildInvite {
id: ID;
guild_id: ID;
creator_id: ID;
channel_id: ID;
max_uses: number;
uses: number;
expires_at: Timestamp;
revoked: boolean;
}
export interface InviteInput {
channel_id: ID;
max_uses: number;
ttl_seconds: number;
}
export interface CreatedInvite {
invite: GuildInvite;
code: string;
revision: number;
}
export interface InvitePreview {
guild_id: ID;
name: string;
icon: "violet" | "mint" | "amber" | "rose" | "sky";
expires_at: Timestamp;
}
export interface InviteAccepted {
guild_id: ID;
already_member: boolean;
revision: number;
}
export interface GuildAudit {
reason?: string;
id: ID;
guild_id: ID;
actor_id: ID;
action: string;
target_id: ID;
revision: number;
created_at: Timestamp;
}
export interface GuildRevision {
revision: number;
}
export interface ConfirmationInput {
action: "DELETE_GUILD" | "TRANSFER_OWNER";
target_user_id?: ID;
}
export interface GuildConfirmation {
id: ID;
token: string;
action: "DELETE_GUILD" | "TRANSFER_OWNER";
target_user_id?: ID;
revision: number;
expires_at: Timestamp;
}
export interface ConfirmationProof {
confirmation_id: ID;
confirmation_token: string;
}
export interface ChannelGrantClaims {
schema_version: 1;
jti: ID;
issuer: "api";
subject: ID;
session_id: ID;
audience: "realtime" | "voice";
action: "VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD";
resource_id: ID;
guild_id: ID;
acl_revision: number;
issued_at_unix: number;
expires_at_unix: number;
}
export interface ChannelAccess {
allowed: boolean;
reason: string;
guild_id: ID;
resource_id: ID;
operation: "VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD";
revision: number;
capability?: string;
}
export interface GuildWSEvent {
kind: "channel.authorized" | "acl.changed" | "access.revoked";
guild_id: ID;
channel_id: ID;
operation: "VIEW_CHANNEL" | "SEND_MESSAGES" | "READ_HISTORY" | "ATTACH_FILES" | "CREATE_THREAD" | "MANAGE_MESSAGES" | "CONNECT_VOICE" | "SPEAK" | "STREAM_VIDEO" | "VIEW_STREAM" | "CREATE_INVITE" | "MANAGE_CHANNEL" | "MANAGE_ROLES" | "KICK_MEMBER" | "MANAGE_GUILD";
revision: number;
}
export interface GuildList {
items: Array<GuildInfo>;
}
export interface GuildRoleList {
items: Array<GuildRole>;
revision: number;
}
export interface GuildMemberList {
items: Array<GuildMember>;
revision: number;
}
export interface GuildCategoryList {
items: Array<GuildCategory>;
revision: number;
}
export interface GuildChannelList {
items: Array<GuildChannel>;
revision: number;
}
export interface GuildOverwriteList {
items: Array<GuildOverwrite>;
revision: number;
}
export interface GuildInviteList {
items: Array<GuildInvite>;
revision: number;
}
export interface GuildAuditList {
next_cursor?: string;
items: Array<GuildAudit>;
revision: number;
}
export interface ChatMember {
id: ID;
name: string;
}
export interface ChatMention {
id: ID;
kind: "user" | "role";
}
export interface ChatRoom {
can_attach?: boolean;
id: ID;
kind: "channel" | "conversation";
name: string;
revision: number;
can_send: boolean;
can_manage: boolean;
can_thread: boolean;
can_deliver: boolean;
members: Array<ChatMember>;
roles: Array<ChatMember>;
}
export interface ChatGrant {
webhook?: WebhookSender;
schema_version: 1;
audience: "messaging";
user_id: ID;
session_id: ID;
method: string;
path: string;
body_hash: string;
expires_at: number;
fence_pid: number;
fence_transaction: string;
room: ChatRoom;
}
export interface Conversation {
id: ID;
kind: "DM" | "GROUP";
name: string;
owner_id: ID;
revision: number;
members: Array<ChatMember>;
}
export interface ConversationInput {
kind: "DM" | "GROUP";
name: string;
member_ids: Array<ID>;
}
export interface ConversationList {
items: Array<Conversation>;
}
export interface MediaGrant {
schema_version: 1;
audience: "media";
user_id: ID;
session_id: ID;
method: string;
path: string;
body_hash: string;
expires_at: number;
fence_pid: number;
fence_transaction: string;
room: ChatRoom;
}
export interface UploadInput {
client_id: ID;
filename: string;
size_bytes: number;
}
export interface UploadStatus {
id: ID;
room_id: ID;
filename: string;
size_bytes: number;
state: "INITIATED" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
received: boolean;
expires_at: Timestamp;
error?: string;
file?: MessageFile;
}
export interface MessageFile {
id: ID;
filename: string;
content_type: string;
size_bytes: number;
sha256: string;
has_preview: boolean;
}
export interface SearchRoom {
id: ID;
kind: "channel" | "conversation";
name: string;
guild_id?: ID;
}
export interface SearchGrant {
schema_version: 1;
audience: "search";
user_id: ID;
path: string;
expires_at: number;
fence_pid: number;
fence_transaction: string;
rooms: Array<SearchRoom>;
}
export interface SearchHit {
message_id: ID;
room: SearchRoom;
author_id: ID;
thread_id?: ID;
snippet: string;
created_at: Timestamp;
}
export interface SearchPage {
items: Array<SearchHit>;
cursor?: string;
indexed_at: Timestamp;
}
export interface ChatReaction {
emoji: string;
count: number;
mine: boolean;
}
export interface ChatMessage {
webhook?: WebhookSender;
attachments?: Array<MessageFile>;
id: ID;
room_id: ID;
author_id: ID;
client_id: ID;
ordinal: number;
revision: number;
content: string;
created_at: Timestamp;
edited_at?: Timestamp;
deleted: boolean;
reply_to?: ID;
thread_id?: ID;
mentions: Array<ChatMention>;
reactions: Array<ChatReaction>;
pinned: boolean;
}
export interface ChatSend {
upload_ids?: Array<ID>;
client_id: ID;
content: string;
reply_to?: ID;
thread_id?: ID;
mentions: Array<ChatMention>;
}
export interface ChatEdit {
revision: number;
content: string;
mentions: Array<ChatMention>;
}
export interface ChatVersion {
revision: number;
}
export interface ChatThread {
id: ID;
room_id: ID;
root_id: ID;
creator_id: ID;
name: string;
archived: boolean;
revision: number;
}
export interface ChatThreadInput {
name: string;
}
export interface ChatThreadEdit {
revision: number;
archived: boolean;
}
export interface ChatThreadList {
items: Array<ChatThread>;
}
export interface ChatRead {
ordinal: number;
unread: number;
}
export interface ChatReadInput {
message_id: ID;
}
export interface ChatPage {
items: Array<ChatMessage>;
cursor?: string;
sequence: number;
room: ChatRoom;
read: ChatRead;
}
export interface ChatEvent {
id: ID;
sequence: number;
schema_version: 1;
kind: "message.created" | "message.updated" | "message.deleted" | "reaction.changed" | "thread.changed" | "member.changed" | "permission.changed" | "read.changed" | "pin.changed";
room_id: ID;
message?: ChatMessage;
thread?: ChatThread;
user_id?: ID;
}
export interface ChatEvents {
events: Array<ChatEvent>;
sequence: number;
has_more: boolean;
room: ChatRoom;
read: ChatRead;
typing: Array<ID>;
presence: Array<ID>;
}
export interface ChatCommand {
op: "subscribe" | "ping" | "typing";
request_id: ID;
schema_version: 1;
room_id?: ID;
room_kind?: "channel" | "conversation";
after?: number;
}
export interface ChatFrame {
op: "ready" | "ack" | "error" | "events";
schema_version: 1;
request_id?: ID;
code?: string;
data?: ChatEvents;
}
export interface VoiceJoinInput {
device_id: ID;
call_id: ID;
}
export interface VoiceGrant {
schema_version: 1;
audience: "voice-media";
user_id: ID;
session_id: ID;
device_id: ID;
call_id: ID;
channel_id: ID;
guild_id: ID;
channel_name: string;
display_name: string;
can_speak: boolean;
can_stream: boolean;
can_view_stream: boolean;
revision: number;
issued_at_unix: number;
expires_at_unix: number;
}
export interface VoiceIceServer {
urls: Array<string>;
username?: string;
credential?: string;
}
export interface VoiceJoin {
grant: string;
signaling_path: string;
ice_servers: Array<VoiceIceServer>;
max_participants: 6;
max_width: 1280;
max_height: 720;
max_video_bitrate: 1200000;
}
export interface VoiceParticipant {
id: ID;
user_id: ID;
device_id: ID;
call_id: ID;
transport_id: ID;
slot: number;
display_name: string;
can_speak: boolean;
can_stream: boolean;
can_view_stream: boolean;
}
export interface VoicePublication {
id: ID;
participant_id: ID;
kind: "audio" | "camera" | "screen";
active: boolean;
}
export interface VoiceSubscription {
id: ID;
publication_id: ID;
mid: string;
}
export interface VoiceRoomState {
id: ID;
guild_id: ID;
name: string;
participants: Array<VoiceParticipant>;
publications: Array<VoicePublication>;
subscriptions: Array<VoiceSubscription>;
}
export interface VoiceCommand {
schema_version: 1;
op: "join" | "offer" | "refresh" | "publish" | "play_sound" | "ping" | "leave";
request_id: ID;
grant?: string;
sdp?: string;
kind?: "audio" | "camera" | "screen";
active?: boolean;
sound_id?: ID;
}
export interface VoiceStats {
received_frames: number;
forwarded_frames: number;
dropped_frames: number;
}
export interface VoiceFrame {
schema_version: 1;
op: "hello" | "answer" | "connected" | "refresh_required" | "room" | "sound_played" | "ack" | "error" | "closed" | "stats";
request_id?: ID;
code?: string;
participant_id?: ID;
transport_id?: ID;
slot?: number;
sdp?: string;
room?: VoiceRoomState;
stats?: VoiceStats;
play_id?: ID;
sound_id?: ID;
name?: string;
emoji?: string;
actor_id?: ID;
audio_url?: string;
}
export type ID = string;
export type Timestamp = string;
