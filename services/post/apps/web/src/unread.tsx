import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ChatRead } from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";

const Preferences = createContext<{ enabled: boolean; setEnabled: (value: boolean) => void }>({
  enabled: true,
  setEnabled: () => {},
});
export const useNotifications = () => useContext(Preferences);
export function NotificationProvider({
  userID,
  children,
}: {
  userID: string;
  children: ReactNode;
}) {
  const key = `svyaz-notifications:${userID}`;
  const [enabled, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  });
  return (
    <Preferences.Provider
      value={{
        enabled,
        setEnabled(value) {
          setValue(value);
          try {
            localStorage.setItem(key, value ? "on" : "off");
          } catch {
          }
        },
      }}
    >
      {children}
    </Preferences.Provider>
  );
}
export function announceRead(kind: string, id: string, read: ChatRead) {
  window.dispatchEvent(new CustomEvent("svyaz-read", { detail: { kind, id, read } }));
}
export function useUnread(kind: "channel" | "conversation", ids: string[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = ids.join(",");
  useEffect(() => {
    let stopped = false,
      loading = false;
    setCounts({});
    const versions = new Map<string, number>();
    const positions = new Map<string, number>();
    const apply = (id: string, read: ChatRead) => {
      const previous = positions.get(id);
      if (previous !== undefined && read.ordinal < previous) return;
      positions.set(id, read.ordinal);
      setCounts((old) => ({ ...old, [id]: read.unread }));
    };
    const onRead = (event: Event) => {
      const {
        kind: k,
        id,
        read,
      } = (event as CustomEvent<{ kind: string; id: string; read: ChatRead }>).detail;
      if (k === kind && ids.includes(id)) {
        versions.set(id, (versions.get(id) ?? 0) + 1);
        apply(id, read);
      }
    };
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      for (const id of ids) {
        if (stopped) break;
        const version = versions.get(id) ?? 0;
        try {
          const read = await api<ChatRead>(
            `/${kind === "channel" ? "channels" : "conversations"}/${id}/read-position`,
          );
          if (!stopped && version === (versions.get(id) ?? 0))
            apply(id, read);
        } catch {
        }
      }
      loading = false;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    window.addEventListener("svyaz-read", onRead);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("svyaz-read", onRead);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [kind, key]);
  return counts;
}
