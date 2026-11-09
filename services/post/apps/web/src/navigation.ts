import { useSyncExternalStore } from "react";

export const tabs = [
  "guilds",
  "messages",
  "inbox",
  "favorites",
  "search",
  "friends",
  "requests",
  "blocks",
  "profile",
  "settings",
] as const;
export type Tab = (typeof tabs)[number];
export const guildViews = [
  "channels",
  "members",
  "roles",
  "invites",
  "settings",
  "moderation",
  "webhooks",
  "audit",
] as const;
export type Route = {
  tab: Tab;
  guild?: string;
  view?: string;
  room?: string;
  kind?: "channel" | "conversation";
  message?: string;
  thread?: string;
  invite?: string;
  q?: string;
  search?: boolean;
  compose?: boolean;
  serverAction?: "choose" | "create" | "join";
};
const uuid = (value: string | null) =>
  value && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value) ? value : undefined;

export function parseRoute(hash: string): Route {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const room = uuid(p.get("chat_room"));
  const guild = uuid(p.get("guild"));
  const invite = p.get("invite");
  const candidate = p.get("tab") as Tab;
  const tab = tabs.includes(candidate)
    ? candidate
    : guild
      ? "guilds"
      : room
        ? "messages"
        : invite && /^[\w-]{1,200}$/.test(invite)
          ? "guilds"
          : "friends";
  return {
    tab,
    ...(tab === "guilds" && guild
      ? {
          guild,
          view: guildViews.includes(p.get("view") as (typeof guildViews)[number])
            ? p.get("view")!
            : "channels",
        }
      : {}),
    ...((tab === "messages" || (tab === "guilds" && guild)) && room
      ? {
          room,
          kind: tab === "guilds" || p.get("chat_kind") === "channel" ? "channel" : "conversation",
          message: uuid(p.get("message")),
          thread: uuid(p.get("thread")),
        }
      : {}),
    ...(tab === "guilds" && invite && /^[\w-]{1,200}$/.test(invite) ? { invite } : {}),
    ...(tab === "search" || (["guilds", "messages"].includes(tab) && p.get("search") === "1")
      ? { q: (p.get("q") ?? "").slice(0, 256), ...(tab !== "search" ? { search: true } : {}) }
      : {}),
    ...(tab === "messages" && p.get("compose") === "1" ? { compose: true } : {}),
    ...(["choose", "create", "join"].includes(p.get("server_action") ?? "")
      ? { serverAction: p.get("server_action") as Route["serverAction"] }
      : {}),
  };
}
export function routeHash(route: Route) {
  const p = new URLSearchParams({ tab: route.tab });
  if (route.guild) p.set("guild", route.guild);
  if (route.view && route.view !== "channels") p.set("view", route.view);
  if (route.room) {
    p.set("chat_kind", route.kind ?? "conversation");
    p.set("chat_room", route.room);
    if (route.message) p.set("message", route.message);
    if (route.thread) p.set("thread", route.thread);
  }
  if (route.invite) p.set("invite", route.invite);
  if (route.q) p.set("q", route.q);
  if (route.search) p.set("search", "1");
  if (route.compose) p.set("compose", "1");
  if (route.serverAction) p.set("server_action", route.serverAction);
  return `#${p}`;
}
export function navigate(route: Route, replace = false) {
  const hash = routeHash(route);
  if (location.hash === hash) return;
  if (replace) {
    history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else location.hash = hash;
}
const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
export function useRoute() {
  const hash = useSyncExternalStore(
    subscribe,
    () => location.hash,
    () => "",
  );
  return parseRoute(hash);
}
