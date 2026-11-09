import type { ChatMember, ChatMention } from "../../../packages/contracts/generated/ts/models";

export type MentionTarget = ChatMention & { name: string; unavailable?: boolean };
export type MentionPart = {
  text: string;
  rawStart: number;
  rawEnd: number;
  start: number;
  end: number;
  mention?: MentionTarget;
};
export type MentionProjection = { text: string; parts: MentionPart[] };
export const mentionKey = (mention: ChatMention) => `${mention.kind}:${mention.id}`;
export const mentionToken = (mention: ChatMention) =>
  `<@${mention.kind === "role" ? "&" : ""}${mention.id}>`;
const tokenPattern = /<@(&?)([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})>/gi;

export function mentionTargets(
  members: ChatMember[] = [],
  roles: ChatMember[] = [],
): MentionTarget[] {
  return [
    ...members.map((member) => ({ ...member, kind: "user" as const })),
    ...roles.map((role) => ({ ...role, kind: "role" as const })),
  ];
}

export function mentionLabel(target: MentionTarget) {
  return `@${target.name.replace(/\s+/g, " ")}`;
}

export function mentionDisplayTargets(content: string, targets: MentionTarget[]) {
  const displayed = new Map(targets.map((target) => [mentionKey(target), target]));
  for (const match of content.matchAll(tokenPattern)) {
    const target: MentionTarget = {
      kind: match[1] ? "role" : "user",
      id: match[2],
      name: match[1] ? "роль" : "участник",
      unavailable: true,
    };
    if (!displayed.has(mentionKey(target))) displayed.set(mentionKey(target), target);
  }
  return [...displayed.values()];
}

export function projectMentions(content: string, targets: MentionTarget[]): MentionProjection {
  const allowed = new Map(targets.map((target) => [mentionKey(target), target]));
  const parts: MentionPart[] = [];
  let raw = 0;
  let text = "";
  const append = (value: string, rawStart: number, rawEnd: number, mention?: MentionTarget) => {
    parts.push({
      text: value,
      rawStart,
      rawEnd,
      start: text.length,
      end: text.length + value.length,
      mention,
    });
    text += value;
  };
  for (const match of content.matchAll(tokenPattern)) {
    const target = allowed.get(`${match[1] ? "role" : "user"}:${match[2]}`);
    if (!target) continue;
    if (match.index > raw) append(content.slice(raw, match.index), raw, match.index);
    append(mentionLabel(target), match.index, match.index + match[0].length, target);
    raw = match.index + match[0].length;
  }
  if (raw < content.length) append(content.slice(raw), raw, content.length);
  return { text, parts };
}

export function contentMentions(content: string, targets: MentionTarget[]): ChatMention[] {
  const seen = new Set<string>();
  return projectMentions(content, targets).parts.flatMap(({ mention }) => {
    if (!mention || seen.has(mentionKey(mention))) return [];
    seen.add(mentionKey(mention));
    return [{ kind: mention.kind, id: mention.id }];
  });
}

export function withLegacyMentions(content: string, mentions: ChatMention[]) {
  let result = content;
  const seen = new Set<string>();
  for (const mention of mentions) {
    const token = mentionToken(mention);
    if (!seen.has(token) && !result.includes(token))
      result += `${result && !/\s$/.test(result) ? " " : ""}${token}`;
    seen.add(token);
  }
  return result;
}

export function messageMentionTargets(
  mentions: ChatMention[],
  targets: MentionTarget[],
): MentionTarget[] {
  const known = new Map(targets.map((target) => [mentionKey(target), target]));
  return mentions.map(
    (mention) =>
      known.get(mentionKey(mention)) ?? {
        ...mention,
        name: mention.kind === "role" ? "роль" : "участник",
      },
  );
}

export function mentionPreview(content: string) {
  return content
    .replace(tokenPattern, (_token, role: string) => (role ? "@роль" : "@участник"))
    .replace(/<@(&?)[\da-f-]*$/i, (_token, role: string) => (role ? "@роль" : "@участник"));
}

export function atomicSelection(projection: MentionProjection, start: number, end: number) {
  let from = start;
  let to = end;
  for (const part of projection.parts) {
    if (!part.mention) continue;
    if (from > part.start && from < part.end) from = part.start;
    if (to > part.start && to < part.end) to = part.end;
  }
  return { start: from, end: to };
}

export function rawOffset(projection: MentionProjection, position: number) {
  for (const part of projection.parts) {
    if (position <= part.start) return part.rawStart;
    if (position < part.end)
      return part.mention ? part.rawStart : part.rawStart + position - part.start;
    if (position === part.end) return part.rawEnd;
  }
  return projection.parts.at(-1)?.rawEnd ?? 0;
}

export function replaceMentionRange(
  content: string,
  targets: MentionTarget[],
  start: number,
  end: number,
  insertion: string,
) {
  const projection = projectMentions(content, targets);
  const range = atomicSelection(projection, start, end);
  const left = content.slice(0, rawOffset(projection, range.start));
  return {
    content: left + insertion + content.slice(rawOffset(projection, range.end)),
    caret: projectMentions(left + insertion, mentionDisplayTargets(left + insertion, targets)).text
      .length,
  };
}

export function applyMentionInput(
  content: string,
  targets: MentionTarget[],
  next: string,
  selection?: { start: number; end: number },
) {
  const previous = projectMentions(content, targets).text;
  if (previous === next) return { content, caret: selection?.start ?? next.length };
  if (selection) {
    const prefix = previous.slice(0, selection.start);
    const suffix = previous.slice(selection.end);
    if (
      next.startsWith(prefix) &&
      next.endsWith(suffix) &&
      next.length >= prefix.length + suffix.length
    ) {
      return replaceMentionRange(
        content,
        targets,
        selection.start,
        selection.end,
        next.slice(prefix.length, next.length - suffix.length),
      );
    }
  }
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  return replaceMentionRange(content, targets, start, end, next.slice(start, nextEnd));
}

export function mentionQuery(projection: MentionProjection, start: number, end = start) {
  if (
    start !== end ||
    projection.parts.some((part) => part.mention && start > part.start && start <= part.end)
  )
    return null;
  const match = /(?:^|[\s([{])@([^\n@]{0,64})$/.exec(projection.text.slice(0, start));
  if (!match) return null;
  const from = start - match[1].length - 1;
  if (projection.parts.some((part) => part.mention && part.end > from && part.start < start))
    return null;
  return { start: from, end: start, query: match[1] };
}

export function filterMentionTargets(targets: MentionTarget[], query: string) {
  const normalize = (text: string) => text.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const needle = normalize(query.trim());
  return targets
    .filter((target) => normalize(target.name).includes(needle))
    .sort(
      (a, b) =>
        Number(normalize(b.name).startsWith(needle)) - Number(normalize(a.name).startsWith(needle)),
    )
    .slice(0, 20);
}
