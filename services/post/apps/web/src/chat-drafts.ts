import type { ChatMention } from "../../../packages/contracts/generated/ts/models";

export type DraftScope = {
  userID: string;
  roomKind: "channel" | "conversation";
  roomID: string;
  threadID: string;
};
export type DraftReply = { id: string; author_id: string };
export type ChatDraft = { content: string; mentions: ChatMention[]; reply: DraftReply | null };
type Entry = { userID: string; version: number; draft: ChatDraft };
export const CHAT_DRAFT_LIMIT = 64;
export const CHAT_DRAFT_TEXT_LIMIT = 9000;
const drafts = new Map<string, Entry>();
const listeners = new Map<string, Set<(version: number) => void>>();
let version = 0;
export const chatDraftKey = (scope: DraftScope) =>
  JSON.stringify([scope.userID, scope.roomKind, scope.roomID, scope.threadID]);
export const chatDraftVersion = (scope: DraftScope) => drafts.get(chatDraftKey(scope))?.version;
export function subscribeChatDraft(scope: DraftScope, listener: (version: number) => void) {
  const key = chatDraftKey(scope),
    group = listeners.get(key) ?? new Set();
  group.add(listener);
  listeners.set(key, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(key);
  };
}
const copy = (draft: ChatDraft): ChatDraft => ({
  content: draft.content.slice(0, CHAT_DRAFT_TEXT_LIMIT),
  mentions: draft.mentions.slice(0, 20).map((m) => ({ kind: m.kind, id: m.id })),
  reply: draft.reply ? { id: draft.reply.id, author_id: draft.reply.author_id } : null,
});
export function readChatDraft(scope: DraftScope): ChatDraft {
  const key = chatDraftKey(scope),
    entry = drafts.get(key);
  if (!entry) return { content: "", mentions: [], reply: null };
  drafts.delete(key);
  drafts.set(key, entry);
  return copy(entry.draft);
}
export function writeChatDraft(scope: DraftScope, draft: ChatDraft): number | undefined {
  const key = chatDraftKey(scope);
  const previous = drafts.get(key);
  const normalized = copy(draft);
  drafts.delete(key);
  if (!draft.content && !draft.mentions.length && !draft.reply) return;
  if (previous && JSON.stringify(previous.draft) === JSON.stringify(normalized)) {
    drafts.set(key, previous);
    return previous.version;
  }
  const next = ++version;
  drafts.set(key, { userID: scope.userID, version: next, draft: normalized });
  while (drafts.size > CHAT_DRAFT_LIMIT) drafts.delete(drafts.keys().next().value!);
  return next;
}
export function removeChatDraft(scope: DraftScope, expectedVersion?: number) {
  const key = chatDraftKey(scope);
  const entry = drafts.get(key);
  if (entry && (expectedVersion === undefined || entry.version === expectedVersion)) {
    drafts.delete(key);
    for (const listener of listeners.get(key) ?? []) listener(entry.version);
  }
}
export function clearChatDrafts(userID?: string) {
  for (const [key, entry] of drafts)
    if (userID === undefined || entry.userID === userID) {
      drafts.delete(key);
      for (const listener of listeners.get(key) ?? []) listener(entry.version);
    }
}
