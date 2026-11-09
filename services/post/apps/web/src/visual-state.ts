export const DEFAULT_SIDEBAR = 303;
export function clampSidebar(width: number) {
  return Math.max(220, Math.min(420, Number.isFinite(width) ? width : DEFAULT_SIDEBAR));
}
export function groupMessage(
  current: { author_id: string; created_at: string; reply_to?: string; webhook?: unknown },
  previous?: { author_id: string; created_at: string; webhook?: unknown },
) {
  if (
    !previous ||
    current.reply_to ||
    current.webhook ||
    previous.webhook ||
    current.author_id !== previous.author_id
  )
    return false;
  const now = new Date(current.created_at),
    before = new Date(previous.created_at);
  const gap = now.getTime() - before.getTime();
  return gap >= 0 && gap < 7 * 60 * 1000 && now.toDateString() === before.toDateString();
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
export type VisualPreferences = { sidebar: number; reducedMotion: boolean; compact: boolean };
export function parseVisualPreferences(raw: string | null): VisualPreferences {
  try {
    const p = JSON.parse(raw ?? "{}");
    return {
      sidebar: clampSidebar(p?.sidebar ?? DEFAULT_SIDEBAR),
      reducedMotion: p?.reducedMotion === true,
      compact: p?.compact === true,
    };
  } catch {
    return { sidebar: DEFAULT_SIDEBAR, reducedMotion: false, compact: false };
  }
}
