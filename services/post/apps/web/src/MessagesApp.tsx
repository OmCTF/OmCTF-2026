import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  Conversation,
  ConversationList,
  PublicProfile,
  ProfilePage,
} from "../../../packages/contracts/generated/ts/models";
import { api, NetworkError } from "./identity-api";
import { ChatWindow } from "./ChatWindow";
import { SearchApp } from "./SearchApp";
import { openQuickSwitcher } from "./QuickSwitcher";
import { revisionHeaders } from "./guild-api";
import "./chat.css";
import { navigate, useRoute } from "./navigation";
import { Icon } from "./Icons";
import { HomeSidebar } from "./HomeSidebar";
import { EmptyArt } from "./Brand";
import { Modal, useSwipeSidebar } from "./AppUI";

export function MessagesApp({ userID }: { userID: string }) {
  const route = useRoute();
  const selected = route.room ?? "",
    kind = route.kind ?? "conversation";
  const [items, setItems] = useState<Conversation[]>([]);
  const [listOpen, setListOpen] = useState(!selected);
  const swipe = useSwipeSidebar(setListOpen);
  const [leaving, setLeaving] = useState<Conversation | null>(null);
  const [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false),
    [members, setMembers] = useState<PublicProfile[]>([]),
    [name, setName] = useState("");
  const [friends, setFriends] = useState<ProfilePage>({ items: [] });
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState("");
  const recipientInput = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<PublicProfile | null>(null),
    [login, setLogin] = useState("");
  const conv = items.find((v) => v.id === selected);
  const running = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const group = members.length > 1;
  const candidates = [...(found ? [found] : []), ...friends.items]
    .filter((u, i, list) => u.id !== userID && list.findIndex((p) => p.id === u.id) === i)
    .filter((u) =>
      `${u.display_name} ${u.login}`.toLowerCase().includes(login.replace(/^@/, "").toLowerCase()),
    );
  useEffect(() => {
    if (!creating) return;
    recipientInput.current?.focus();
    let stopped = false;
    setFriendsLoading(true);
    setFriendsError("");
    void api<ProfilePage>("/friends")
      .then((page) => {
        if (!stopped) setFriends(page);
      })
      .catch((e) => {
        if (!stopped)
          setFriendsError(e instanceof Error ? e.message : "Не удалось загрузить друзей.");
      })
      .finally(() => {
        if (!stopped) setFriendsLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [creating]);
  useEffect(() => {
    if (route.compose) {
      setCreating(true);
      navigate({ ...route, compose: undefined }, true);
    }
  }, [route.compose]);
  async function refresh() {
    const list = await api<ConversationList>("/conversations");
    setItems(list.items);
    return list.items;
  }
  useEffect(() => {
    let stopped = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const list = await api<ConversationList>("/conversations");
        if (stopped) return;
        setItems(list.items);
        setLoadError("");
      } catch (e) {
        if (!stopped)
          setLoadError(e instanceof Error ? e.message : "Не удалось получить переписки.");
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса.");
      if (e instanceof NetworkError && e.uncertain) {
        setUncertain(true);
        void refresh().catch(() => {});
      }
    } finally {
      setBusy(false);
      running.current = false;
    }
  }
  function search(e: FormEvent) {
    e.preventDefault();
    if (login.replace(/^@/, "").trim().length < 3) return;
    void action(async () =>
      setFound(
        await api<PublicProfile>(`/users?login=${encodeURIComponent(login.replace(/^@/, ""))}`),
      ),
    );
  }
  function create(e: FormEvent) {
    e.preventDefault();
    if (uncertain) return;
    void action(async () => {
      const c = await api<Conversation>("/conversations", "POST", {
        kind: group ? "GROUP" : "DM",
        name: group
          ? name.trim() ||
            members
              .map((m) => m.display_name)
              .join(", ")
              .slice(0, 80)
          : members[0]?.display_name,
        member_ids: members.map((m) => m.id),
      });
      setCreating(false);
      setMembers([]);
      setFound(null);
      setLogin("");
      setName("");
      navigate({ tab: "messages", room: c.id, kind: "conversation" });
      setListOpen(false);
      await refresh();
    });
  }
  return (
    <section className="dm-app" {...swipe}>
      <div className="dm-heading">
        <button className="sidebar-search" onClick={openQuickSwitcher}>
          Найти или начать беседу
        </button>
      </div>
      {(error || loadError) && (
        <p className="id-error" role="alert">
          {error || loadError}
        </p>
      )}
      {creating && (
        <Modal
          title="Новое сообщение"
          onClose={() => setCreating(false)}
          className="new-conversation-dialog"
          dismissible={!busy}
        >
          <p className="conversation-subtitle">
            В групповом чате может участвовать до 10 пользователей.
          </p>
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          <form className="conversation-recipient-search" onSubmit={search}>
            <span>Кому:</span>
            <div className="conversation-recipient-field">
              {members.map((m) => (
                <button
                  className="conversation-recipient-chip"
                  type="button"
                  key={m.id}
                  aria-label={`Убрать ${m.display_name}`}
                  onClick={() => setMembers((old) => old.filter((v) => v.id !== m.id))}
                >
                  {m.display_name}
                  <Icon name="close" size={14} />
                </button>
              ))}
              <input
                ref={recipientInput}
                aria-label="Найти участника по имени или логину"
                placeholder={members.length ? "Добавить ещё" : "Имя или логин"}
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value);
                  setFound(null);
                }}
                maxLength={128}
                autoFocus
              />
            </div>
            <button
              aria-label="Найти по логину"
              disabled={busy || login.replace(/^@/, "").length < 3}
            >
              <Icon name="search" size={18} />
            </button>
          </form>
          <div className="conversation-candidates" aria-label="Получатели">
            {friendsError && (
              <p className="id-error" role="alert">
                {friendsError}
              </p>
            )}
            {candidates.map((u) => {
              const selected = members.some((m) => m.id === u.id);
              return (
                <button
                  key={u.id}
                  role="checkbox"
                  aria-checked={selected}
                  disabled={busy || (!selected && members.length >= 9)}
                  className="conversation-candidate"
                  onClick={() =>
                    setMembers((old) => (selected ? old.filter((m) => m.id !== u.id) : [...old, u]))
                  }
                >
                  <span className={`id-avatar ${u.avatar}`}>
                    {Array.from(u.display_name)[0]?.toUpperCase()}
                  </span>
                  <span className="conversation-candidate-name">
                    <strong>{u.display_name}</strong>
                    <small>@{u.login}</small>
                  </span>
                  <span className={`conversation-selection ${selected ? "is-selected" : ""}`}>
                    {selected && <Icon name="check" size={16} />}
                  </span>
                </button>
              );
            })}
            {!candidates.length && (
              <div className="conversation-no-results" role="status">
                {friendsLoading
                  ? "Загрузка…"
                  : login
                    ? "Никого не найдено"
                    : "Здесь пока никого нет"}
              </div>
            )}
            {friends.next_cursor && (
              <button
                className="conversation-more"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const page = await api<ProfilePage>(
                      `/friends?after=${encodeURIComponent(friends.next_cursor!)}`,
                    );
                    setFriends((old) => ({
                      items: [...old.items, ...page.items],
                      next_cursor: page.next_cursor,
                    }));
                  })
                }
              >
                Показать ещё
              </button>
            )}
          </div>
          <form className="conversation-create" onSubmit={create}>
            {group && (
              <label className="conversation-group-name">
                Название группы
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={members.map((m) => m.display_name).join(", ")}
                  maxLength={80}
                />
              </label>
            )}
            {uncertain && (
              <p role="status">
                Не удалось подтвердить создание. Проверьте список переписок перед повтором.
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={() => setCreating(false)}>
                Отмена
              </button>
              <button className="id-primary" disabled={busy || uncertain || !members.length}>
                Создать сообщение
              </button>
            </footer>
          </form>
        </Modal>
      )}
      <button
        className="mobile-channels"
        aria-expanded={listOpen}
        aria-controls="dm-navigation"
        onClick={() => setListOpen(!listOpen)}
      >
        {listOpen ? "Скрыть переписки" : "Выбрать переписку"}
      </button>
      <div className={`dm-layout ${listOpen ? "list-open" : ""}`}>
        <aside className="dm-list" id="dm-navigation">
          <HomeSidebar
            userID={userID}
            items={items}
            onPick={() => setListOpen(false)}
            onCreate={() => {
              setCreating(true);
              setUncertain(false);
            }}
          />
        </aside>
        <div className="dm-space">
          {selected ? (
            <>
              {conv && (
                <details className="dm-settings">
                  <summary aria-label="Состав и настройки переписки" title="Настройки переписки">
                    <Icon name="settings" />
                  </summary>
                  <div className="dm-settings-popover">
                    <h4>Участники — {conv.members.length}</h4>
                    {conv.members.map((m) => (
                      <div className="dm-member-row" key={m.id}>
                        <span className="dm-member-avatar" aria-hidden="true">
                          {Array.from(m.name)[0]?.toUpperCase()}
                        </span>
                        <span className="dm-member-name">
                          {m.name}
                          {m.id === conv.owner_id && <small>Владелец группы</small>}
                        </span>
                        {conv.kind === "GROUP" && conv.owner_id === userID && m.id !== userID && (
                          <button
                            aria-label={`Исключить ${m.name}`}
                            data-tooltip="Исключить участника"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `/conversations/${conv.id}/members/${m.id}`,
                                  "DELETE",
                                  undefined,
                                  revisionHeaders(conv.revision),
                                );
                                await refresh();
                              })
                            }
                          >
                            <Icon name="close" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    {conv.kind === "GROUP" && conv.owner_id === userID && (
                      <form
                        className="dm-add-member"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const login = String(new FormData(e.currentTarget).get("login"));
                          void action(async () => {
                            const u = await api<PublicProfile>(
                              `/users?login=${encodeURIComponent(login)}`,
                            );
                            await api(
                              `/conversations/${conv.id}/members/${u.id}`,
                              "PUT",
                              undefined,
                              revisionHeaders(conv.revision),
                            );
                            await refresh();
                          });
                        }}
                      >
                        <label>
                          Добавить по логину
                          <input name="login" required />
                        </label>
                        <button disabled={busy}>Добавить участника</button>
                      </form>
                    )}
                    <button className="id-danger" disabled={busy} onClick={() => setLeaving(conv)}>
                      Выйти из переписки
                    </button>
                  </div>
                </details>
              )}
              <ChatWindow
                key={`${kind}:${selected}`}
                roomID={selected}
                roomKind={kind}
                userID={userID}
                title={
                  conv?.kind === "DM" ? conv.members.find((m) => m.id !== userID)?.name : conv?.name
                }
              />
            </>
          ) : (
            <div className="dm-empty">
              <EmptyArt />
              <h3>Личные сообщения</h3>
              <button
                className="id-primary"
                onClick={() => {
                  setCreating(true);
                  setUncertain(false);
                }}
              >
                Начать беседу
              </button>
            </div>
          )}
        </div>
        {route.search && <SearchApp key={selected} embedded />}
      </div>
      {leaving && (
        <Modal
          title="Выйти из переписки?"
          className="confirmation-dialog"
          onClose={() => setLeaving(null)}
        >
          <p>Вы больше не сможете читать и отправлять сообщения в этой переписке.</p>
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button onClick={() => setLeaving(null)}>Отмена</button>
            <button
              className="id-danger"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api(
                    `/conversations/${leaving.id}/leave`,
                    "POST",
                    undefined,
                    revisionHeaders(leaving.revision),
                  );
                  setLeaving(null);
                  navigate({ tab: "messages" });
                  await refresh();
                })
              }
            >
              Выйти из переписки
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
