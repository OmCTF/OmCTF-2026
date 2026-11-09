import { useEffect, useState } from "react";
import type {
  Conversation,
  ConversationList,
} from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";
import { navigate, useRoute } from "./navigation";
import { useUnread, useNotifications } from "./unread";
import { Icon } from "./Icons";
import { openInbox } from "./Community";

export function HomeSidebar({
  userID,
  items: supplied,
  onPick,
  onCreate,
}: {
  userID: string;
  items?: Conversation[];
  onPick?: () => void;
  onCreate?: () => void;
}) {
  const [loaded, setLoaded] = useState<Conversation[]>([]);
  const [failed, setFailed] = useState(false);
  const route = useRoute();
  const items = supplied ?? loaded;
  const unread = useUnread(
    "conversation",
    items.map((c) => c.id),
  );
  const notifications = useNotifications();
  useEffect(() => {
    if (supplied) return;
    let alive = true,
      busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const list = await api<ConversationList>("/conversations");
        if (alive) {
          setLoaded(list.items);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [supplied]);
  return (
    <>
      <nav className="home-primary-nav" aria-label="Личный кабинет">
        <button
          aria-current={["friends", "requests", "blocks"].includes(route.tab) ? "page" : undefined}
          onClick={() => {
            navigate({ tab: "friends" });
            onPick?.();
          }}
        >
          <Icon name="users" size={22} />
          Друзья
        </button>
        <button
          data-inbox-trigger
          aria-current={route.tab === "inbox" ? "page" : undefined}
          onClick={() => {
            openInbox();
            onPick?.();
          }}
        >
          <Icon name="inbox" size={22} />
          Входящие
        </button>
        <button
          data-inbox-trigger
          aria-current={route.tab === "favorites" ? "page" : undefined}
          onClick={() => {
            openInbox("favorites");
            onPick?.();
          }}
        >
          <Icon name="star" size={22} />
          Избранное
        </button>
      </nav>
      <div className="home-dm-heading">
        <span>Личные сообщения</span>
        <button
          aria-label="Новая переписка"
          data-tooltip="Новая переписка"
          onClick={() => (onCreate ? onCreate() : navigate({ tab: "messages", compose: true }))}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>
      <nav className="home-conversations" aria-label="Список переписок">
        {items.map((c) => {
          const name =
            c.kind === "DM" ? (c.members.find((m) => m.id !== userID)?.name ?? c.name) : c.name;
          return (
            <button
              key={c.id}
              aria-current={route.room === c.id ? "page" : undefined}
              onClick={() => {
                navigate({ tab: "messages", room: c.id, kind: "conversation" });
                onPick?.();
              }}
            >
              <span className={`dm-avatar ${c.kind === "GROUP" ? "group-avatar" : ""}`}>
                {c.kind === "GROUP" ? <Icon name="users" /> : Array.from(name)[0]}
              </span>
              <span>
                <strong>{name}</strong>
                {c.kind === "GROUP" && <small>{c.members.length} участников</small>}
              </span>
              {notifications.enabled && unread[c.id] > 0 && (
                <b className="dm-count" aria-label={`${unread[c.id]} непрочитанных`}>
                  {unread[c.id]}
                </b>
              )}
            </button>
          );
        })}
        {failed && (
          <small className="sidebar-error" role="status">
            Не удалось обновить переписки
          </small>
        )}
      </nav>
    </>
  );
}
