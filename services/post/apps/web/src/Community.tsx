import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type {
  CommunitySettings,
  NotificationRule,
  NotificationRuleList,
  InboxPage,
  InboxItem,
  NotificationClaim,
  FavoriteList,
  FavoriteChannel,
} from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";
import { navigate } from "./navigation";
import { Icon } from "./Icons";
import { EmptyArt } from "./Brand";
import { SelectField } from "./SelectField";
import {
  notificationModes,
  notificationDurations,
  notificationPayload,
} from "./community-form-state";
import "./community.css";
import "./community-controls.css";

type CommunityState = {
  rules: NotificationRule[];
  favorites: FavoriteChannel[];
  inbox: InboxPage;
  settings: CommunitySettings;
  error: string;
  refresh: () => Promise<void>;
};
const Context = createContext<CommunityState>({
  rules: [],
  favorites: [],
  inbox: { items: [], revision: 0 },
  settings: { browser_notifications: false },
  error: "",
  refresh: async () => {},
});
export const useCommunity = () => useContext(Context);
export function communityChanged() {
  window.dispatchEvent(new Event("svyaz-community"));
}
export type InboxView = "unread" | "mentions" | "all" | "favorites";
export function openInbox(view: InboxView = "unread") {
  window.dispatchEvent(new CustomEvent("svyaz:open-inbox", { detail: view }));
}
export function CommunityProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Omit<CommunityState, "refresh" | "error">>({
    rules: [],
    favorites: [],
    inbox: { items: [], revision: 0 },
    settings: { browser_notifications: false },
  });
  const [error, setError] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const claimed = useRef(new Set<string>());
  const popups = useRef<Notification[]>([]);
  async function refresh() {
    const version = ++generation.current;
    const [rules, favorites, inbox, settings] = await Promise.all([
      api<NotificationRuleList>("/community/rules"),
      api<FavoriteList>("/community/favorites"),
      api<InboxPage>("/community/inbox"),
      api<CommunitySettings>("/community/settings"),
    ]);
    if (!alive.current || version !== generation.current) return;
    setData({ rules: rules.items, favorites: favorites.items, inbox, settings });
    setError("");
    if (
      settings.browser_notifications &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      for (const item of inbox.items
        .filter((i) => !i.read && Date.now() - Date.parse(i.created_at) < 120000)
        .slice(0, 3)) {
        if (claimed.current.has(item.id)) continue;
        claimed.current.add(item.id);
        try {
          const claim = await api<NotificationClaim>(`/community/inbox/${item.id}/claim`, "POST");
          if (claim.claimed && alive.current) {
            const popup = new Notification("Связь", {
              body: item.mention
                ? "Вас упомянули. Откройте входящие."
                : "Есть новое уведомление. Откройте входящие.",
              tag: `svyaz:${item.id}`,
            });
            popup.onclick = () => {
              window.focus();
              navigate({ tab: "inbox" });
              popup.close();
            };
            popups.current.push(popup);
            if (popups.current.length > 20) popups.current.shift()?.close();
          }
        } catch {
          claimed.current.delete(item.id);
        }
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    const load = () => {
      void refresh().catch((e) => {
        if (alive.current) setError(e.message);
      });
    };
    load();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15000);
    window.addEventListener("svyaz-community", load);
    window.addEventListener("focus", load);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(poll);
      window.removeEventListener("svyaz-community", load);
      window.removeEventListener("focus", load);
      popups.current.forEach((n) => n.close());
    };
  }, []);
  return <Context.Provider value={{ ...data, error, refresh }}>{children}</Context.Provider>;
}
export function NotificationRuleEditor({
  scope,
  id = "",
  label,
}: {
  scope: NotificationRule["scope"];
  id?: string;
  label: string;
}) {
  const community = useCommunity();
  const rule = community.rules.find((r) => r.scope === scope && r.scope_id === id);
  const [mode, setMode] = useState<NotificationRule["mode"]>(rule?.mode ?? "inherit");
  const [duration, setDuration] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const groupID = useId();
  const saving = useRef(false);
  useEffect(() => {
    setMode(rule?.mode ?? "inherit");
  }, [rule?.mode, rule?.mute_until, scope, id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const payload = notificationPayload(mode, duration);
    if (!payload) {
      setError("Выберите режим и срок уведомлений.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api(`/community/rules/${scope}${id ? `/${id}` : ""}`, "PUT", payload);
      await community.refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  return (
    <form className="community-rule" onSubmit={(e) => void save(e)}>
      <fieldset className="community-notification-modes" disabled={busy}>
        <legend>{label}</legend>
        {notificationModes.map((option) => (
          <label key={option.value} className="community-notification-mode">
            <input
              type="radio"
              name={`notification-mode-${groupID}`}
              value={option.value}
              checked={mode === option.value}
              onChange={() => {
                setMode(option.value);
                setSaved(false);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      {mode === "mute" && (
        <label>
          Срок отключения
          <SelectField
            label="Срок отключения"
            value={duration}
            options={notificationDurations}
            onChange={(value) => {
              setDuration(value);
              setSaved(false);
            }}
            disabled={busy}
          />
        </label>
      )}
      {rule?.mute_until && (
        <small>Отключено до {new Date(rule.mute_until).toLocaleString()}.</small>
      )}
      <button disabled={busy}>Сохранить уведомления</button>
      {saved && <span role="status">Настройка сохранена</span>}
      {error && (
        <p role="alert" className="id-error">
          {error}
        </p>
      )}
    </form>
  );
}
export function FavoriteButton({ channelID }: { channelID: string }) {
  const community = useCommunity();
  const active = community.favorites.some((f) => f.channel_id === channelID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/community/favorites/${channelID}`, active ? "DELETE" : "PUT");
      await community.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        aria-label={active ? "Убрать из избранного" : "В избранное"}
        title={active ? "Убрать из избранного" : "В избранное"}
        aria-pressed={active}
        disabled={busy}
        onClick={() => void toggle()}
      >
        <Icon name="star" />
      </button>
      {error && (
        <p role="alert" className="id-error">
          {error}
        </p>
      )}
    </>
  );
}
export function CommunityPreferences() {
  const community = useCommunity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  async function enable() {
    setBusy(true);
    setError("");
    try {
      if (typeof Notification === "undefined")
        throw Error("Этот браузер не поддерживает уведомления.");
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted")
        throw Error(
          "Разрешение не выдано. Входящие продолжают работать без всплывающих уведомлений.",
        );
      await api("/community/settings", "PUT", { browser_notifications: true });
      await community.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError("");
    try {
      await api("/community/settings", "PUT", { browser_notifications: false });
      await community.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="community-card">
      <h2>Входящие и уведомления</h2>
      <NotificationRuleEditor scope="user" label="Уведомления аккаунта" />
      <button
        disabled={busy || permission === "unsupported"}
        onClick={() => void (community.settings.browser_notifications ? disable() : enable())}
      >
        {community.settings.browser_notifications
          ? "Отключить браузерные уведомления"
          : "Разрешить браузерные уведомления"}
      </button>
      {error && (
        <p className="id-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function openItem(item: InboxItem) {
  navigate({
    tab: item.guild_id ? "guilds" : "messages",
    guild: item.guild_id,
    room: item.room_id,
    kind: item.room_kind,
    message: item.message_id,
    thread: item.thread_id,
  });
}
export function InboxPopover({
  view,
  onView,
  onClose,
}: {
  view: InboxView;
  onView: (view: InboxView) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleID = useId();
  const community = useCommunity();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const tabs: [InboxView, string][] = [
    ["unread", "Непрочитанные"],
    ["mentions", "Упоминания"],
    ["all", "Все"],
    ["favorites", "Избранное"],
  ];
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const node = panel.current;
    node?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!node?.contains(target) && !target?.closest("[data-inbox-trigger]")) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      if (
        prior?.isConnected &&
        (node?.contains(document.activeElement) || document.activeElement === document.body)
      )
        prior.focus();
    };
  }, []);
  return (
    <section
      ref={panel}
      role="dialog"
      aria-labelledby={titleID}
      tabIndex={-1}
      className="inbox-popover"
    >
      <header className="inbox-popover-heading">
        <Icon name="inbox" size={24} />
        <h2 id={titleID}>Входящие</h2>
        <button
          className="icon-button"
          aria-label="Обновить входящие"
          data-tooltip="Обновить"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            setError("");
            void community
              .refresh()
              .catch((e) => setError(e.message))
              .finally(() => setRefreshing(false));
          }}
        >
          <Icon name="refresh" size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="Запросы дружбы"
          data-tooltip="Запросы дружбы"
          onClick={() => {
            navigate({ tab: "requests" });
            onClose();
          }}
        >
          <Icon name="users" size={20} />
        </button>
        <button className="icon-button" aria-label="Закрыть входящие" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <nav className="inbox-tabs" aria-label="Фильтр входящих" role="tablist">
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            role="tab"
            data-inbox-view={id}
            aria-selected={view === id}
            tabIndex={view === id ? 0 : -1}
            onClick={() => onView(id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              onView(tabs[next][0]);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`[data-inbox-view="${tabs[next][0]}"]`)
                ?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div
        className="inbox-popover-body"
        role="tabpanel"
        aria-label={tabs.find(([id]) => id === view)?.[1]}
      >
        {error && (
          <p className="id-error" role="alert">
            {error}
          </p>
        )}
        {view === "favorites" ? (
          <Favorites onOpen={onClose} />
        ) : (
          <Inbox filter={view} onOpen={onClose} />
        )}
      </div>
    </section>
  );
}

export function Inbox({
  filter = "unread",
  onOpen,
}: {
  filter?: Exclude<InboxView, "favorites">;
  onOpen?: () => void;
}) {
  const community = useCommunity();
  const [older, setOlder] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [paged, setPaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageVersion = useRef(0);
  const list = [
    ...new Map([...older, ...community.inbox.items].map((i) => [i.id, i])).values(),
  ].sort((a, b) => b.sequence - a.sequence);
  const visible = list.filter(
    (item) => filter === "all" || (filter === "unread" ? !item.read : item.mention),
  );
  useEffect(() => {
    pageVersion.current++;
    setOlder([]);
    setPaged(false);
    setCursor(undefined);
    setBusy(false);
    return () => {
      pageVersion.current++;
    };
  }, [community.inbox.revision]);
  async function more() {
    const version = pageVersion.current;
    setBusy(true);
    setError("");
    try {
      const page = await api<InboxPage>(
        `/community/inbox?before=${encodeURIComponent((paged ? cursor : community.inbox.next_cursor)!)}`,
      );
      if (version !== pageVersion.current) return;
      setOlder((old) => [...old, ...page.items]);
      setCursor(page.next_cursor);
      setPaged(true);
    } catch (e) {
      if (version === pageVersion.current) setError((e as Error).message);
    } finally {
      if (version === pageVersion.current) setBusy(false);
    }
  }
  async function read(item: InboxItem) {
    setBusy(true);
    setError("");
    try {
      await api(`/community/inbox/${item.id}/read`, "PUT");
      await community.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="community-card inbox-screen">
      {(error || community.error) && (
        <p className="id-error" role="alert">
          {error || community.error}
        </p>
      )}
      {!visible.length && !community.error && (
        <div className="product-empty">
          <EmptyArt kind="inbox" />
          <h3>
            {filter === "unread"
              ? "Вы всё прочитали"
              : filter === "mentions"
                ? "Вас пока не упоминали"
                : "Пока нет уведомлений"}
          </h3>
        </div>
      )}
      <div className="community-list">
        {visible.map((item) => (
          <article key={item.id} className={item.read ? "" : "unread"}>
            <span className="inbox-room-icon">
              <Icon name={item.room_kind === "channel" ? "hash" : "chat"} size={24} />
            </span>
            <div className="inbox-item-content">
              <strong>{item.name}</strong>
              <p>{item.mention ? "Вас упомянули" : "Новое сообщение"}</p>
              <small>
                {new Date(item.created_at).toLocaleString()} · {item.read ? "Прочитано" : "Новое"}
              </small>
            </div>
            <div className="community-toolbar">
              <button
                className="icon-button"
                aria-label={`Открыть сообщение: ${item.name}`}
                data-tooltip="Открыть сообщение"
                onClick={() => {
                  openItem(item);
                  onOpen?.();
                }}
              >
                <Icon name="arrow" size={20} />
              </button>
              {!item.read && (
                <button
                  className="icon-button"
                  aria-label={`Пометить как прочитанное: ${item.name}`}
                  data-tooltip="Пометить как прочитанное"
                  disabled={busy}
                  onClick={() => void read(item)}
                >
                  <Icon name="check" size={20} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {(paged ? cursor : community.inbox.next_cursor) && (
        <button disabled={busy} onClick={() => void more()}>
          Более ранние уведомления
        </button>
      )}
    </section>
  );
}
export function Favorites({ onOpen }: { onOpen?: () => void }) {
  const community = useCommunity();
  return (
    <section className="community-card favorites-screen">
      {community.error && (
        <p className="id-error" role="alert">
          {community.error}
        </p>
      )}
      {!community.favorites.length && (
        <div className="product-empty">
          <EmptyArt />
          <h3>Здесь будут ваши избранные каналы</h3>
        </div>
      )}
      <div className="community-list">
        {community.favorites.map((f) => (
          <article key={f.channel_id}>
            <button
              onClick={() => {
                navigate({ tab: "guilds", guild: f.guild_id, kind: "channel", room: f.channel_id });
                onOpen?.();
              }}
            >
              <Icon name={f.kind === "VOICE" ? "speaker" : f.kind === "FORUM" ? "chat" : "hash"} />{" "}
              {f.name}
            </button>
            <FavoriteButton channelID={f.channel_id} />
          </article>
        ))}
      </div>
    </section>
  );
}
