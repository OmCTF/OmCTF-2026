import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  AuthSession,
  PublicProfile,
  ProfilePage,
  RequestPage,
  SessionPage,
  PrivacySettings,
  Conversation,
} from "../../../packages/contracts/generated/ts/models";
import { api, ApiError, NetworkError, session, signOut, setSessionIdentity, endSession } from "./identity-api";
import { requestID } from "./request-id";
import "./identity.css";
import { GuildApp } from "./GuildApp";
import { VoiceProvider, useVoice } from "./VoicePanel";
import { MessagesApp } from "./MessagesApp";
import { SearchApp } from "./SearchApp";
import { clearChatDrafts } from "./chat-drafts";
import { QuickSwitcher, QUICK_SWITCHER_EVENT, openQuickSwitcher } from "./QuickSwitcher";
import { navigate, useRoute, type Tab, type Route } from "./navigation";
import { NotificationProvider, useNotifications } from "./unread";
import {
  CommunityProvider,
  CommunityPreferences,
  InboxPopover,
  type InboxView,
  useCommunity,
  communityChanged,
} from "./Community";
import "./product.css";
import { Icon, type IconName } from "./Icons";
import { ServerRail } from "./ServerRail";
import { ServerGateway } from "./ServerGateway";
import { BrandMark, Wordmark, EmptyArt } from "./Brand";
import {
  SettingsDialog,
  SidebarResize,
  useAppearance,
  useMenuDismissal,
  Skeleton,
  type SettingsPage,
} from "./AppUI";
import { HomeSidebar } from "./HomeSidebar";
import { PrivacyPolicyFields, ProfileAvatarField } from "./IdentitySettingsFields";
import "./fidelity.css";
import "./dialogs-fidelity.css";
import "./settings-fidelity.css";
import "./conversation-fidelity.css";
import "./guild-settings-fidelity.css";
import "./search-fidelity.css";
import "./friends-home-fidelity.css";

const labels = {
  guilds: "Серверы",
  messages: "Сообщения",
  inbox: "Входящие",
  favorites: "Избранное",
  search: "Поиск",
  friends: "Друзья",
  requests: "Заявки",
  blocks: "Блокировки",
  profile: "Мой профиль",
  settings: "Настройки",
};
const navIcons: Record<Tab, IconName> = {
  guilds: "hash",
  messages: "chat",
  inbox: "inbox",
  favorites: "star",
  search: "search",
  friends: "users",
  requests: "request",
  blocks: "block",
  profile: "profile",
  settings: "settings",
};
function Avatar({ user }: { user: PublicProfile }) {
  return (
    <span className={`id-avatar ${user.avatar}`} aria-hidden="true">
      {Array.from(user.display_name)[0]?.toUpperCase()}
    </span>
  );
}
function Brand() {
  return <Wordmark />;
}
function Person({
  user,
  children,
  className = "",
  onOpen,
  disabled,
}: {
  user: PublicProfile;
  children?: ReactNode;
  className?: string;
  onOpen?: () => void;
  disabled?: boolean;
}) {
  return (
    <article className={`id-person ${className}`}>
      {onOpen && (
        <button
          className="friend-row-open"
          aria-label={`Открыть беседу с пользователем ${user.display_name}`}
          tabIndex={-1}
          disabled={disabled}
          onClick={onOpen}
        />
      )}
      <Avatar user={user} />
      <div className="id-person-name">
        <strong>{user.display_name}</strong>
        <small>@{user.login}</small>
      </div>
      <div className="id-actions">{children}</div>
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="id-empty">
      <EmptyArt kind="friends" />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function Login({ onLogin, notice }: { onLogin: (a: AuthSession) => void; notice: string }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const replay = useRef({ payload: "", key: "" });
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    document.title = register ? "Регистрация · Связь" : "Вход · Связь";
  }, [register]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const login = String(form.get("login")),
      password = String(form.get("password"));
    try {
      if (register) {
        const body = { login, password, display_name: String(form.get("display_name")) };
        const payload = JSON.stringify(body);
        if (replay.current.payload !== payload)
          replay.current = { payload, key: requestID() };
        await api("/auth/register", "POST", body, { "Idempotency-Key": replay.current.key });
      }
      onLogin(
        await api<AuthSession>("/auth/login", "POST", { login, password, device: "Веб-браузер" }),
      );
    } catch (e) {
      setError(e instanceof ApiError || e instanceof NetworkError
        ? e.message
        : register ? "Не удалось создать аккаунт. Обновите страницу и попробуйте снова."
          : "Не удалось войти. Обновите страницу и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="identity id-login">
      <section className="id-welcome">
        <Brand />
      </section>
      <main className="id-login-main">
        <div className="id-auth-card">
          <h2>{register ? "Создать аккаунт" : "С возвращением!"}</h2>
          <p>{register ? "Добро пожаловать в Связь." : "Рады видеть вас снова."}</p>
          {notice && !error && (
            <p className="id-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={submit} aria-busy={busy}>
            <fieldset disabled={busy}>
              {register && (
                <label>
                  Отображаемое имя
                  <input
                    ref={first}
                    name="display_name"
                    autoComplete="nickname"
                    maxLength={64}
                    required
                    placeholder="Как к вам обращаться"
                  />
                </label>
              )}
              <label>
                Логин
                <input
                  ref={register ? undefined : first}
                  name="login"
                  autoComplete="username"
                  minLength={3}
                  maxLength={128}
                  required
                  placeholder="your.name"
                />
              </label>
              <label>
                Пароль
                <input
                  name="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 12 : undefined}
                  maxLength={128}
                  required
                  placeholder={register ? "Не менее 12 символов" : "Ваш пароль"}
                />
              </label>
              <button className="id-primary id-wide" type="submit">
                {busy ? "Подождите…" : register ? "Создать аккаунт" : "Войти"}
              </button>
            </fieldset>
          </form>
          <div className="id-switch">
            {register ? "Уже есть аккаунт?" : "Ещё не с нами?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
              disabled={busy}
            >
              {register ? "Войти" : "Зарегистрироваться"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export function IdentityApp() {
  const [auth, setAuth] = useState<AuthSession | null>(null),
    [checking, setChecking] = useState(true),
    [notice, setNotice] = useState("");
  const sessionKnown = useRef(false);
  const sessionActive = useRef(false);
  const sessionGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    const check = () => {
      const generation = sessionGeneration.current;
      return session()
        .then((a) => {
          if (active && generation === sessionGeneration.current) {
            sessionKnown.current = true;
            sessionActive.current = true;
            setAuth(a);
            setNotice("");
          }
        })
        .catch((e) => {
          if (active && generation === sessionGeneration.current) {
            if (e instanceof ApiError && e.status === 401) {
              setAuth(null);
              sessionActive.current = false;
            }
            setNotice(
              !sessionKnown.current && e instanceof ApiError && e.status === 401 ? "" : e.message,
            );
          }
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    };
    void check();
    const ended = () => {
      setSessionIdentity(null);
      sessionGeneration.current++;
      setAuth(null);
      sessionActive.current = false;
      if (sessionKnown.current) setNotice("Сессия завершена. Войдите снова.");
    };
    window.addEventListener("svyaz-session-ended", ended);
    window.addEventListener("focus", check);
    const timer = setInterval(() => {
      if (sessionActive.current) void check();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("svyaz-session-ended", ended);
    };
  }, []);
  if (checking)
    return (
      <div className="identity id-loading" role="status">
        Подключаемся к Связи…
      </div>
    );
  if (!auth)
    return (
      <Login
        onLogin={(a) => {
          sessionGeneration.current++;
          sessionKnown.current = true;
          sessionActive.current = true;
          setAuth(a);
          setNotice("");
        }}
        notice={notice}
      />
    );
  return (
    <VoiceProvider key={auth.user.id}>
      <NotificationProvider userID={auth.user.id}>
        <CommunityProvider>
          <Account auth={auth} onChange={setAuth} />
        </CommunityProvider>
      </NotificationProvider>
    </VoiceProvider>
  );
}

function Account({ auth, onChange }: { auth: AuthSession; onChange: (a: AuthSession) => void }) {
  useEffect(() => () => clearChatDrafts(auth.user.id), [auth.user.id]);
  const route = useRoute();
  const tab = route.tab === "inbox" || route.tab === "favorites" ? "friends" : route.tab;
  const notifications = useNotifications();
  const community = useCommunity();
  const voice = useVoice();
  const { appearance, setAppearance } = useAppearance(auth.user.id);
  useMenuDismissal();
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(
    tab === "profile" ? "profile" : "account",
  );
  const [friendView, setFriendView] = useState<"all" | "add">("all");
  const [friendQuery, setFriendQuery] = useState("");
  const [friendLogin, setFriendLogin] = useState("");
  const [inboxView, setInboxView] = useState<InboxView | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    const open = () => {
      if (document.querySelector("dialog[open]")) return;
      setInboxView(null);
      setMenuOpen(false);
      setSwitcherOpen(true);
    };
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault();
        open();
      }
    };
    window.addEventListener(QUICK_SWITCHER_EVENT, open);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener(QUICK_SWITCHER_EVENT, open);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  const [profileName, setProfileName] = useState(auth.user.display_name);
  const [profileAvatar, setProfileAvatar] = useState(auth.user.avatar);
  const previousRoute = useRef<Route>({ tab: "friends" });
  useEffect(() => {
    if (!["profile", "settings", "inbox", "favorites"].includes(route.tab))
      previousRoute.current = route;
  }, [location.hash]);
  useEffect(() => {
    if (route.tab !== "inbox" && route.tab !== "favorites") return;
    setInboxView(route.tab === "favorites" ? "favorites" : "unread");
    navigate(previousRoute.current, true);
  }, [route.tab]);
  useEffect(() => {
    const show = (event: Event) => {
      const value = (event as CustomEvent).detail;
      setInboxView(["unread", "mentions", "all", "favorites"].includes(value) ? value : "unread");
      setMenuOpen(false);
    };
    window.addEventListener("svyaz:open-inbox", show);
    return () => window.removeEventListener("svyaz:open-inbox", show);
  }, []);
  useEffect(() => {
    if (tab === "profile") setSettingsPage("profile");
    else if (tab === "settings") setSettingsPage("account");
  }, [tab]);
  useEffect(() => {
    setProfileName(auth.user.display_name);
    setProfileAvatar(auth.user.avatar);
  }, [auth.user.display_name, auth.user.avatar, settingsPage]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<ProfilePage>({ items: [] }),
    [blocks, setBlocks] = useState<ProfilePage>({ items: [] }),
    [requests, setRequests] = useState<RequestPage>({ items: [] }),
    [sessions, setSessions] = useState<SessionPage>({ items: [] });
  const [settings, setSettings] = useState<PrivacySettings | null>(null),
    [found, setFound] = useState<PublicProfile | null>(null),
    [online, setOnline] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const loadVersion = useRef(0);
  async function load() {
    const version = ++loadVersion.current;
    const values = await Promise.all([
      api<ProfilePage>("/friends"),
      api<ProfilePage>("/blocks"),
      api<RequestPage>("/friends/requests"),
      api<SessionPage>("/users/me/sessions"),
      api<PrivacySettings>("/users/me/settings"),
    ]);
    if (version !== loadVersion.current) return;
    setFriends(values[0]);
    setBlocks(values[1]);
    setRequests(values[2]);
    setSessions(values[3]);
    setSettings(values[4]);
  }
  useEffect(() => {
    let active = true;
    void load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 15000);
    return () => {
      active = false;
      loadVersion.current++;
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    setMenuOpen(false);
    document.title = `${labels[tab]} · Связь`;
  }, [tab]);
  useEffect(() => {
    let active = true;
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heartbeat = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" }));
    }, 15000);
    const connect = async () => {
      try {
        await session();
        if (!active) return;
        ws = new WebSocket(
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/ws`,
        );
        ws.onmessage = (e) => {
          const kind = JSON.parse(e.data).kind;
          if (kind === "session.ready") {
            setOnline(true);
            communityChanged();
          }
          if (kind === "community.changed") communityChanged();
        };
        ws.onclose = () => {
          setOnline(false);
          if (active) timer = setTimeout(() => void connect(), 3000);
        };
        ws.onerror = () => ws?.close();
      } catch {
        setOnline(false);
        if (active) timer = setTimeout(() => void connect(), 10000);
      }
    };
    void connect();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      ws?.close();
    };
  }, [auth.user.id]);
  async function action(
    work: () => Promise<unknown>,
    message = "Изменения сохранены.",
    refresh = true,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (refresh) {
        try {
          await load();
        } catch {
          setNotice("Действие выполнено, но список не обновился. Нажмите «Обновить».");
          return;
        }
      }
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const login = friendLogin.trim();
    setFound(null);
    await action(
      async () => setFound(await api<PublicProfile>(`/users?login=${encodeURIComponent(login)}`)),
      "",
      false,
    );
  }
  async function logout(all = false) {
    setBusy(true);
    setError("");
    try {
      await signOut(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить сессию.");
    } finally {
      setBusy(false);
    }
  }
  async function more(kind: "friends" | "blocks" | "requests" | "sessions") {
    const map = {
      friends: { path: "/friends", value: friends, set: setFriends },
      blocks: { path: "/blocks", value: blocks, set: setBlocks },
    };
    if (kind === "friends" || kind === "blocks") {
      const x = map[kind];
      const next = await api<ProfilePage>(
        `${x.path}?after=${encodeURIComponent(x.value.next_cursor!)}`,
      );
      x.set({ ...next, items: [...x.value.items, ...next.items] });
    }
    if (kind === "requests") {
      const next = await api<RequestPage>(
        `/friends/requests?after=${encodeURIComponent(requests.next_cursor!)}`,
      );
      setRequests({ ...next, items: [...requests.items, ...next.items] });
    }
    if (kind === "sessions") {
      const next = await api<SessionPage>(
        `/users/me/sessions?after=${encodeURIComponent(sessions.next_cursor!)}`,
      );
      setSessions({ ...next, items: [...sessions.items, ...next.items] });
    }
  }
  const moreButton = (kind: "friends" | "blocks" | "requests" | "sessions", cursor?: string) =>
    cursor && (
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void more(kind)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Показать ещё
      </button>
    );
  const pending = requests.items.filter((r) => r.status === "PENDING"),
    incoming = pending.filter((r) => r.recipient.id === auth.user.id);
  const visibleFriends = friends.items.filter((user) =>
    `${user.display_name} ${user.login}`.toLowerCase().includes(friendQuery.trim().toLowerCase()),
  );
  const openFriendConversation = (user: PublicProfile) =>
    action(async () => {
      const conversation = await api<Conversation>("/conversations", "POST", {
        kind: "DM",
        name: user.display_name,
        member_ids: [user.id],
      });
      navigate({ tab: "messages", kind: "conversation", room: conversation.id });
    }, "", false);
  const changeTab = (value: Tab) => {
    if (value === "inbox" || value === "favorites") {
      setInboxView(value === "favorites" ? "favorites" : "unread");
      setMenuOpen(false);
      return;
    }
    setInboxView(null);
    navigate({ tab: value });
    setError("");
    setNotice("");
  };
  return (
    <div
      className={`identity id-account tab-${tab} ${menuOpen ? "menu-open" : ""} ${route.room ? "workspace-active" : ""}`}
    >
      <a
        className="id-skip"
        href="#id-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("id-content")?.focus();
        }}
      >
        К содержимому
      </a>
      <div className="app-topbar">
        <button
          className="mobile-account-menu"
          aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={menuOpen}
          aria-controls="mobile-account-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name={menuOpen ? "close" : "more"} size={20} />
        </button>
        <BrandMark size={18} />
        <span>{["friends", "requests", "blocks"].includes(tab) ? "Друзья" : "Связь"}</span>
        <button
          className="topbar-inbox"
          data-inbox-trigger
          aria-label="Входящие"
          aria-expanded={inboxView !== null}
          data-tooltip="Входящие"
          onClick={() => setInboxView((value) => (value === null ? "unread" : null))}
        >
          <Icon name="inbox" size={18} />
          {community.inbox.items.some((v) => !v.read) && <i />}
        </button>
      </div>
      {menuOpen && (
        <nav
          id="mobile-account-navigation"
          className="mobile-account-navigation"
          aria-label="Разделы приложения"
        >
          {(
            [
              "friends",
              "messages",
              "inbox",
              "favorites",
              "requests",
              "blocks",
              "search",
              "settings",
            ] as Tab[]
          ).map((value) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => changeTab(value)}
            >
              <Icon name={navIcons[value]} />
              {labels[value]}
            </button>
          ))}
        </nav>
      )}
      <ServerRail />
      {tab !== "guilds" && route.serverAction && (
        <ServerGateway
          initialStep={route.serverAction}
          onClose={() => navigate({ ...route, serverAction: undefined }, true)}
          onEnter={(guild) => navigate({ tab: "guilds", guild })}
        />
      )}
      <SidebarResize
        width={appearance.sidebar}
        onChange={(sidebar) => setAppearance((p) => ({ ...p, sidebar }))}
      />
      {tab !== "guilds" && tab !== "messages" && (
        <aside className="id-sidebar">
          <button className="sidebar-search" onClick={openQuickSwitcher}>
            Найти или начать беседу
          </button>
          <HomeSidebar userID={auth.user.id} />
        </aside>
      )}
      <div className="id-own">
        <Avatar user={auth.user} />
        <button
          className="own-profile"
          onClick={() => changeTab("profile")}
          aria-label="Мой профиль"
        >
          <strong>{auth.user.display_name}</strong>
          <small>
            <i className={online ? "online-dot" : "offline-dot"} />
            {online ? "В сети" : "Подключение…"}
          </small>
        </button>
        <button
          aria-label={voice.muted ? "Включить микрофон" : "Выключить микрофон"}
          data-tooltip={voice.muted ? "Включить микрофон" : "Выключить микрофон"}
          disabled={voice.busy}
          className={voice.muted ? "dock-muted" : ""}
          onClick={voice.toggleMic}
        >
          <span className={voice.muted ? "slashed" : ""}>
            <Icon name="mic" size={19} />
          </span>
        </button>
        <button
          aria-label={voice.deaf ? "Включить звук" : "Заглушить звук"}
          data-tooltip={voice.deaf ? "Включить звук" : "Заглушить звук"}
          className={voice.deaf ? "dock-muted" : ""}
          onClick={voice.toggleDeaf}
        >
          <span className={voice.deaf ? "slashed" : ""}>
            <Icon name="headphones" size={19} />
          </span>
        </button>
        <button
          aria-label="Настройки"
          data-tooltip="Настройки пользователя"
          onClick={() => changeTab("settings")}
        >
          <Icon name="settings" size={19} />
        </button>
      </div>
      <main id="id-content" className="id-content" tabIndex={-1}>
        <header className="id-header">
          <span>
            <Icon
              name={["friends", "requests", "blocks"].includes(tab) ? "users" : navIcons[tab]}
            />
            {["friends", "requests", "blocks"].includes(tab) ? "Друзья" : labels[tab]}
          </span>
          {["friends", "requests", "blocks"].includes(tab) && (
            <nav className="friends-tabs" aria-label="Друзья">
              <button
                aria-current={tab === "friends" && friendView === "all" ? "page" : undefined}
                onClick={() => {
                  setFriendView("all");
                  changeTab("friends");
                }}
              >
                Все
              </button>
              <button
                aria-current={tab === "requests" ? "page" : undefined}
                onClick={() => changeTab("requests")}
              >
                Ожидание {incoming.length > 0 && <b>{incoming.length}</b>}
              </button>
              <button
                aria-current={tab === "blocks" ? "page" : undefined}
                onClick={() => changeTab("blocks")}
              >
                Заблокированные
              </button>
              <button
                className="add-friend-tab"
                aria-current={tab === "friends" && friendView === "add" ? "page" : undefined}
                onClick={() => {
                  setFriendView("add");
                  changeTab("friends");
                }}
              >
                Добавить в друзья
              </button>
            </nav>
          )}
          {["friends", "requests", "blocks"].includes(tab) && (
            <button
              className="friends-new-message icon-button"
              aria-label="Создать сообщение"
              data-tooltip="Создать сообщение"
              onClick={() => navigate({ tab: "messages", compose: true })}
            >
              <Icon name="chat" size={24} />
              <Icon name="plus" size={12} />
            </button>
          )}
          <span className={`id-connection ${online ? "on" : ""}`} role="status">
            <i />
            {online ? "На связи" : "Связь потеряна · повторяем"}
          </span>
        </header>
        <div className="id-title">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {labels[tab]}
            </h1>
          </div>
          <button disabled={busy || loading} onClick={() => void action(load, "")}>
            Обновить
          </button>
        </div>
        {error && (
          <p className="id-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="id-notice" role="status">
            {notice}
          </p>
        )}
        {loading && <Skeleton rows={4} />}
        {tab === "guilds" && <GuildApp userID={auth.user.id} />}
        {tab === "messages" && <MessagesApp userID={auth.user.id} />}
        {tab === "search" && <SearchApp />}
        {tab === "friends" && (
          <>
            {friendView === "add" && (
              <section className="id-search-panel">
                <div>
                  <h2>Добавить в друзья</h2>
                  <p>Найдите пользователя по его логину.</p>
                </div>
                <form onSubmit={search}>
                  <label className="id-sr" htmlFor="search-login">
                    Логин пользователя
                  </label>
                  <input
                    id="search-login"
                    name="search"
                    placeholder="Введите логин пользователя"
                    value={friendLogin}
                    onChange={(event) => {
                      setFriendLogin(event.target.value);
                      setFound(null);
                    }}
                    required
                    minLength={3}
                    maxLength={128}
                  />
                  <button className="id-primary" disabled={busy}>
                    Найти
                  </button>
                </form>
              </section>
            )}
            {friendView === "add" && found && (
              <Person user={found}>
                {found.id !== auth.user.id ? (
                  <>
                    <button
                      className="id-primary"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => api("/friends/requests", "POST", { user_id: found.id }),
                          "Заявка отправлена.",
                        )
                      }
                    >
                      Добавить в друзья
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await api(`/blocks/${found.id}`, "POST");
                          setFound(null);
                        }, "Пользователь заблокирован.")
                      }
                    >
                      Блокировать
                    </button>
                  </>
                ) : (
                  <span>Это вы</span>
                )}
              </Person>
            )}
            {friendView === "all" && (
              <>
                <label className="friends-search">
                  <Icon name="search" size={20} />
                  <input
                    aria-label="Поиск друзей"
                    placeholder="Поиск"
                    value={friendQuery}
                    onChange={(e) => setFriendQuery(e.target.value)}
                  />
                  {friendQuery && (
                    <button
                      type="button"
                      className="friends-search-clear icon-button"
                      aria-label="Очистить поиск друзей"
                      onClick={(event) => {
                        setFriendQuery("");
                        event.currentTarget.parentElement?.querySelector("input")?.focus();
                      }}
                    >
                      <Icon name="close" size={20} />
                    </button>
                  )}
                </label>
                {(visibleFriends.length > 0 || !friendQuery.trim()) && (
                  <div className="id-section-heading">
                    <h2>
                      Всего друзей —{" "}
                      <span>
                        {visibleFriends.length}
                        {friends.next_cursor ? "+" : ""}
                      </span>
                    </h2>
                  </div>
                )}
                {!loading && !friends.items.length ? (
                  <Empty
                    title="Здесь пока никого нет"
                    text="Добавьте друзей, чтобы начать общение."
                  />
                ) : !loading && !visibleFriends.length ? (
                  <Empty
                    title="Ничего не найдено"
                    text="Не удалось найти пользователя с таким именем или логином."
                  />
                ) : (
                  visibleFriends.map((user) => (
                    <Person
                      key={user.id}
                      user={user}
                      className="friends-list-row"
                      disabled={busy}
                      onOpen={() => void openFriendConversation(user)}
                    >
                      <button
                        className="friend-message-button icon-button"
                        aria-label={`Написать ${user.display_name}`}
                        data-tooltip="Сообщение"
                        disabled={busy}
                        onClick={() => void openFriendConversation(user)}
                      >
                        <Icon name="chat" />
                      </button>
                      <details className="action-menu friend-menu">
                        <summary aria-label={`Действия ${user.display_name}`}>
                          <Icon name="more" />
                        </summary>
                        <div>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () => api(`/friends/${user.id}`, "DELETE"),
                                "Пользователь удалён из друзей.",
                              )
                            }
                          >
                            Удалить
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () => api(`/blocks/${user.id}`, "POST"),
                                "Пользователь заблокирован.",
                              )
                            }
                          >
                            Блокировать
                          </button>
                        </div>
                      </details>
                    </Person>
                  ))
                )}
                {moreButton("friends", friends.next_cursor)}
              </>
            )}
          </>
        )}
        {tab === "requests" && (
          <>
            {!loading && !pending.length && (
              <Empty
                title="Все заявки разобраны"
                text="Когда кто-то захочет добавить вас в друзья, заявка появится здесь."
              />
            )}
            {pending.map((req) => {
              const received = req.recipient.id === auth.user.id;
              return (
                <Person key={req.id} user={received ? req.sender : req.recipient}>
                  <span className="id-chip">{received ? "Входящая" : "Отправлена"}</span>
                  {received ? (
                    <>
                      <button
                        className="id-primary"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => api(`/friends/requests/${req.id}/accept`, "POST"),
                            "Теперь вы друзья.",
                          )
                        }
                      >
                        Принять
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => api(`/friends/requests/${req.id}/reject`, "POST"),
                            "Заявка отклонена.",
                          )
                        }
                      >
                        Отклонить
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => api(`/friends/requests/${req.id}`, "DELETE"),
                          "Заявка отменена.",
                        )
                      }
                    >
                      Отменить
                    </button>
                  )}
                </Person>
              );
            })}
            {moreButton("requests", requests.next_cursor)}
          </>
        )}
        {tab === "blocks" && (
          <>
            {!loading && !blocks.items.length && (
              <Empty
                title="Никто не заблокирован"
                text="Управляйте блокировками в поиске пользователей или в списке друзей."
              />
            )}
            {blocks.items.map((user) => (
              <Person key={user.id} user={user}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() => api(`/blocks/${user.id}`, "DELETE"), "Блокировка снята.")
                  }
                >
                  Разблокировать
                </button>
              </Person>
            ))}
            {moreButton("blocks", blocks.next_cursor)}
          </>
        )}
        {(tab === "profile" || tab === "settings") && (
          <SettingsDialog
            user={auth.user}
            page={settingsPage}
            onPage={setSettingsPage}
            onClose={() =>
              settingsPage === "profile" && tab === "settings"
                ? setSettingsPage("account")
                : navigate(previousRoute.current)
            }
            onLogout={() => void logout()}
          >
            {error && (
              <p className="id-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="id-notice" role="status">
                {notice}
              </p>
            )}
            {settingsPage === "account" && (
              <section className="account-overview">
                <h2>Информация об учётной записи</h2>
                <div className="account-field">
                  <span>
                    <strong>Отображаемое имя</strong>
                    <small>{auth.user.display_name}</small>
                  </span>
                  <button onClick={() => setSettingsPage("profile")}>Изменить</button>
                </div>
                <div className="account-field">
                  <span>
                    <strong>Имя пользователя</strong>
                    <small>@{auth.user.login}</small>
                  </span>
                </div>
                <div className="account-field">
                  <span>
                    <strong>В числе участников с</strong>
                    <small>
                      {new Date(auth.user.created_at).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </small>
                  </span>
                </div>
                <h2>Безопасность и конфиденциальность</h2>
                <button className="settings-link-row" onClick={() => setSettingsPage("devices")}>
                  <Icon name="screen" />
                  Активные сеансы <Icon name="arrow" />
                </button>
                <button className="settings-link-row" onClick={() => setSettingsPage("privacy")}>
                  <Icon name="lock" />
                  Разрешения для сообщений <Icon name="arrow" />
                </button>
              </section>
            )}
            {settingsPage === "appearance" && (
              <section className="appearance-settings">
                <h2>Внешний вид</h2>
                <div className="theme-preview">
                  <div />
                  <div />
                  <div />
                  <BrandMark size={48} />
                </div>
                <div className="selected-theme">
                  <span className="theme-dot" />
                  Тёмная тема <Icon name="check" size={18} />
                </div>
                <h2>Отображение сообщений</h2>
                <label className="switch-row">
                  <span>
                    <strong>Компактный режим</strong>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={appearance.compact}
                    onChange={(e) => setAppearance((p) => ({ ...p, compact: e.target.checked }))}
                  />
                </label>
                <h2>Анимации</h2>
                <label className="switch-row">
                  <span>
                    <strong>Уменьшить движение</strong>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={appearance.reducedMotion}
                    onChange={(e) =>
                      setAppearance((p) => ({ ...p, reducedMotion: e.target.checked }))
                    }
                  />
                </label>
              </section>
            )}
            {settingsPage === "profile" && (
              <section className="profile-editor">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void action(async () => {
                      const user = await api<PublicProfile>("/users/me", "PATCH", {
                        display_name: String(form.get("display_name")),
                        avatar: String(form.get("avatar")),
                      });
                      onChange({ ...auth, user });
                    });
                  }}
                >
                  <fieldset className="profile-editor-layout" disabled={busy}>
                    <aside className="profile-customization">
                      <h2>Основной профиль</h2>
                      <h3>Аватар</h3>
                      <div className="profile-avatar-tile">
                        <span className={`profile-avatar-preview ${profileAvatar}`}>
                          {Array.from(
                            profileName.trim() || auth.user.display_name,
                          )[0]?.toUpperCase()}
                        </span>
                      </div>
                      <ProfileAvatarField
                        value={profileAvatar}
                        onChange={setProfileAvatar}
                        disabled={busy}
                      />
                    </aside>
                    <div className="profile-preview-column">
                      <div className="id-profile-preview">
                        <div className={`profile-banner ${profileAvatar}`} />
                        <Avatar
                          user={{
                            ...auth.user,
                            display_name: profileName.trim() || auth.user.display_name,
                            avatar: profileAvatar,
                          }}
                        />
                        <div className="profile-preview-info">
                          <h2>{profileName.trim() || auth.user.display_name}</h2>
                          <p>{auth.user.login}</p>
                          <div className="profile-created-at">
                            <span>В числе участников с</span>
                            <time>
                              {new Date(auth.user.created_at).toLocaleDateString("ru-RU", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </time>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="profile-details-column">
                      <h2>Информация профиля</h2>
                      <label>
                        Отображаемое имя
                        <input
                          name="display_name"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          required
                          maxLength={64}
                        />
                      </label>
                      <label>
                        Логин
                        <input value={auth.user.login} readOnly />
                      </label>
                      <button className="id-primary">Сохранить профиль</button>
                    </div>
                  </fieldset>
                </form>
              </section>
            )}
            {settingsPage !== "profile" && (
              <>
                {settingsPage === "notifications" && (
                  <section className="id-panel">
                    <CommunityPreferences />
                    <h2>Непрочитанные сообщения</h2>
                    <label className="id-check">
                      <input
                        type="checkbox"
                        checked={notifications.enabled}
                        onChange={(e) => notifications.setEnabled(e.target.checked)}
                      />
                      Показывать счётчики и уведомлять в заголовке вкладки
                    </label>
                  </section>
                )}
                {settings && settingsPage === "privacy" && (
                  <section className="id-panel settings-privacy">
                    <h2>Приватность</h2>
                    <form
                      key={JSON.stringify(settings)}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void action(() =>
                          api("/users/me/settings", "PATCH", {
                            discoverable: form.has("discoverable"),
                            friend_requests: form.get("friend_requests"),
                            dm_policy: form.get("dm_policy"),
                          }),
                        );
                      }}
                    >
                      <fieldset disabled={busy}>
                        <label className="id-check">
                          <input
                            name="discoverable"
                            type="checkbox"
                            role="switch"
                            defaultChecked={settings.discoverable}
                          />
                          Меня можно найти по логину
                        </label>
                        <PrivacyPolicyFields settings={settings} disabled={busy} />
                        <button className="id-primary">Сохранить настройки</button>
                      </fieldset>
                    </form>
                  </section>
                )}
                {settingsPage === "devices" && (
                  <section className="id-panel">
                    <div className="id-section-heading">
                      <h2>Устройства и сессии</h2>
                      <div className="settings-session-actions">
                        <button disabled={busy} onClick={() => void logout()}>
                          Выйти
                        </button>
                        <button
                          className="id-danger"
                          disabled={busy}
                          onClick={() => void logout(true)}
                        >
                          Выйти везде
                        </button>
                      </div>
                    </div>
                    {sessions.items.map((item) => (
                      <article className="id-session" key={item.id}>
                        <div>
                          <strong>
                            {item.device}
                            {item.current ? " · Это устройство" : ""}
                          </strong>
                          <small>Вход: {new Date(item.issued_at).toLocaleString("ru-RU")}</small>
                          <small>Срок: {new Date(item.expires_at).toLocaleString("ru-RU")}</small>
                        </div>
                        {item.revoked_at ? (
                          <span className="id-chip">Завершена</span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await api(`/users/me/sessions/${item.id}`, "DELETE");
                                if (item.current) endSession();
                              }, "Сессия отозвана.")
                            }
                          >
                            Завершить
                          </button>
                        )}
                      </article>
                    ))}
                    {moreButton("sessions", sessions.next_cursor)}
                  </section>
                )}
              </>
            )}
          </SettingsDialog>
        )}
      </main>
      {inboxView !== null && (
        <InboxPopover view={inboxView} onView={setInboxView} onClose={() => setInboxView(null)} />
      )}
      {switcherOpen && (
        <QuickSwitcher userID={auth.user.id} onClose={() => setSwitcherOpen(false)} />
      )}
    </div>
  );
}
