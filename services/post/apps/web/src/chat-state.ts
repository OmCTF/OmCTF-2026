import type {
  ChatMessage,
  ChatEvent,
  ChatRead,
} from "../../../packages/contracts/generated/ts/models";

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) {
    const old = map.get(m.id);
    if (
      !old ||
      (!old.deleted && m.revision > old.revision) ||
      (m.deleted && m.revision >= old.revision)
    )
      map.set(m.id, m);
  }
  return [...map.values()].sort((a, b) => a.ordinal - b.ordinal);
}
export function replay(current: ChatMessage[], events: ChatEvent[], after: number) {
  const ids = new Set<string>();
  return mergeMessages(
    current,
    events
      .filter((e) => {
        if (e.sequence <= after || ids.has(e.id)) return false;
        ids.add(e.id);
        return true;
      })
      .flatMap((e) => (e.message ? [e.message] : [])),
  );
}
export function historyWindow<T extends { ordinal: number }>(items: T[], ceiling: number | null) {
  const next = ceiling === null ? -1 : items.findIndex((m) => m.ordinal > ceiling);
  const end = next < 0 ? items.length : next;
  const start = Math.max(0, end - 100);
  return {
    items: items.slice(start, end),
    start,
    end,
    older: start > 0,
    newer: end < items.length,
  };
}
export const mergeRead = (current: ChatRead, incoming: ChatRead) =>
  incoming.ordinal < current.ordinal ? current : incoming;
export const reactionNames: Record<string, string> = {
  like: "Нравится",
  heart: "Сердце",
  laugh: "Смешно",
  celebrate: "Ура",
  sad: "Грустно",
  eyes: "Смотрю",
};
export const reactionSymbols: Record<string, string> = {
  like: "👍",
  heart: "❤️",
  laugh: "😄",
  celebrate: "🎉",
  sad: "😢",
  eyes: "👀",
};
