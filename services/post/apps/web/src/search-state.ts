export type SearchFilters = {
  scope: string;
  guild: string;
  channel: string;
  author: string;
  from: string;
  to: string;
};

export function searchParams(
  query: string,
  filters: SearchFilters,
  sort: string,
  authorID?: string,
  conversation?: string,
) {
  const params = new URLSearchParams({ q: query.trim(), scope: filters.scope, sort });
  if (filters.scope === "dm") {
    if (conversation) params.set("conversation_id", conversation);
  } else if (filters.guild) {
    params.set("guild_id", filters.guild);
    if (filters.channel) params.set("channel_id", filters.channel);
  }
  if (authorID) params.set("author_id", authorID);
  if (filters.from) params.set("after", new Date(`${filters.from}T00:00:00Z`).toISOString());
  if (filters.to)
    params.set("before", new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86400000).toISOString());
  return params;
}

export function searchCount(count: number, more: boolean) {
  if (!count) return "Нет результатов";
  const word =
    ({ one: "результат", few: "результата", many: "результатов" } as Record<string, string>)[
      new Intl.PluralRules("ru").select(count)
    ] ?? "результатов";
  return `${count}${more ? "+" : ""} ${more ? "результатов" : word}`;
}
