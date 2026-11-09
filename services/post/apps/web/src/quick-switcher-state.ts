export type QuickTarget = {
  id: string;
  kind: "conversation" | "text" | "voice" | "guild";
  name: string;
  context: string;
  keywords: string;
  guild?: string;
  room?: string;
};

export function filterQuickTargets(items: QuickTarget[], query: string): QuickTarget[] {
  const prefix = query.trim()[0];
  const scope = ({ "@": "conversation", "#": "text", "!": "voice", "*": "guild" } as const)[
    prefix as "@" | "#" | "!" | "*"
  ];
  const text = (scope ? query.trim().slice(1) : query).trim().toLocaleLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  return items
    .filter(
      (item) =>
        (!scope || item.kind === scope) &&
        words.every((word) =>
          `${item.name} ${item.context} ${item.keywords}`.toLocaleLowerCase().includes(word),
        ),
    )
    .map((item, order) => ({
      item,
      order,
      score:
        text && item.name.toLocaleLowerCase() === text
          ? 0
          : text && item.name.toLocaleLowerCase().startsWith(text)
            ? 1
            : 2,
    }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ item }) => item);
}

export function quickSelectionIndex(index: number, direction: number, count: number): number {
  return count ? (index + direction + count) % count : 0;
}
