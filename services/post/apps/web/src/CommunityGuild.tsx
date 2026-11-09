import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  GuildInfo,
  GuildMember,
  GuildChannel,
  ModerationList,
  ModerationRecord,
  WebhookList,
  WebhookInfo,
  WebhookSecret,
  GuildAuditList,
  GuildAudit,
  ChatMessage,
} from "../../../packages/contracts/generated/ts/models";
import { api, NetworkError } from "./identity-api";
import { requestID } from "./request-id";
import { revisionHeaders } from "./guild-api";
import { communityChanged } from "./Community";
import { Modal } from "./AppUI";
import { Icon } from "./Icons";
import { SelectField } from "./SelectField";
import { initialChoice } from "./guild-dialog-state";
import {
  moderationKinds,
  moderationDurations,
  moderationSelectionError,
  webhookAvatars,
  webhookSelectionError,
  refreshAfterCommunityWrite,
} from "./community-form-state";

const sanctionNames = {
  KICK: "Исключение",
  BAN: "Бан",
  MUTE_TEXT: "Запрет текста",
  MUTE_VOICE: "Запрет микрофона и трансляций",
};
type Panel = "moderation" | "webhooks" | "audit";
function auditLabel(action: string) {
  const entities: Record<string, string> = {
    guild: "Сервер",
    channel: "Канал",
    channels: "Канал",
    text: "Текстовый канал",
    voice: "Голосовой канал",
    forum: "Форум",
    category: "Категория",
    categories: "Категории",
    role: "Роль",
    roles: "Роли",
    overwrite: "Разрешения",
    member: "Участник",
    invite: "Приглашение",
    webhook: "Webhook",
    moderation: "Модерация",
  };
  const verbs: Record<string, string> = {
    created: "создание",
    updated: "изменение",
    deleted: "удаление",
    joined: "вступление",
    left: "выход",
    kicked: "исключение",
    roles_updated: "изменение ролей",
    revoked: "отмена",
    rotated: "обновление токена",
    archived: "архивация",
    restored: "восстановление",
    reordered: "изменение порядка",
    ban: "бан",
    mute_text: "ограничение сообщений",
    mute_voice: "ограничение голоса",
    kick: "исключение",
  };
  if (action === "TRANSFER_OWNER") return "Передача владения сервером";
  if (action === "DELETE_GUILD") return "Удаление сервера";
  const [entity, verb] = action.split(".");
  return entities[entity] && verbs[verb] ? `${entities[entity]}: ${verbs[verb]}` : action;
}
export function CommunityGuild({
  guild,
  members,
  channels,
  panel,
  onChange,
}: {
  guild: GuildInfo;
  members: GuildMember[];
  channels: GuildChannel[];
  panel: Panel;
  onChange: () => Promise<void>;
}) {
  const [sanctions, setSanctions] = useState<ModerationRecord[]>([]),
    [hooks, setHooks] = useState<WebhookInfo[]>([]),
    [audit, setAudit] = useState<GuildAudit[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(),
    [filters, setFilters] = useState({ action: "", actor_id: "", target_id: "" });
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState<WebhookSecret | null>(null),
    [tested, setTested] = useState(false);
  const testID = useRef(requestID());
  const running = useRef(false),
    version = useRef(0);
  const [kind, setKind] = useState("MUTE_TEXT");
  const [target, setTarget] = useState("");
  const [duration, setDuration] = useState("900");
  const [hookChannel, setHookChannel] = useState("");
  const [hookAvatar, setHookAvatar] = useState("violet");
  const [revokeReason, setRevokeReason] = useState("");
  const [creating, setCreating] = useState(false);
  const targetName = (id: string) =>
    members.find((m) => m.user.id === id)?.user.display_name ?? "Неизвестный участник";
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  async function load(more = false) {
    const current = ++version.current;
    setLoading(true);
    try {
      if (panel === "moderation") {
        const v = await api<ModerationList>(`/guilds/${guild.id}/moderation`);
        if (current === version.current) setSanctions(v.items);
      }
      if (panel === "webhooks") {
        const v = await api<WebhookList>(`/guilds/${guild.id}/webhooks`);
        if (current === version.current) setHooks(v.items);
      }
      if (panel === "audit") {
        if (more && cursor) query.set("before", cursor);
        const v = await api<GuildAuditList>(`/guilds/${guild.id}/audit?${query}`);
        if (current === version.current) {
          setAudit((old) => (more ? [...old, ...v.items] : v.items));
          setCursor(v.next_cursor);
        }
      }
      return current === version.current;
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
      return false;
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (panel === "moderation" && document.visibilityState === "visible" && !running.current)
        void load();
    }, 15000);
    return () => {
      clearInterval(timer);
      version.current++;
    };
  }, [guild.id, guild.revision, panel, filters]);
  async function run(fn: () => Promise<void>) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const refreshError = await refreshAfterCommunityWrite(fn, async () => {
        await onChange();
        if (!(await load())) throw new Error("Не удалось обновить список.");
      });
      if (refreshError) setError("Действие выполнено, но список не обновлён. Обновите страницу.");
      communityChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof NetworkError && e.uncertain) setUncertain(true);
      return false;
    } finally {
      setBusy(false);
      running.current = false;
    }
  }
  const write = <T,>(path: string, method: string, body?: unknown) =>
    api<T>(path, method, body, revisionHeaders(guild.revision));
  async function sanction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running.current || uncertain) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const selectionError = moderationSelectionError(
      String(data.get("target") ?? ""),
      kind,
      String(data.get("duration") ?? ""),
      eligible.map((member) => member.user.id),
    );
    if (selectionError) {
      setError(selectionError);
      return;
    }
    const applied = await run(async () => {
      await write(`/guilds/${guild.id}/moderation`, "POST", {
        user_id: data.get("target"),
        kind,
        reason: data.get("reason"),
        duration_seconds: kind === "KICK" ? 0 : Number(data.get("duration")),
      });
      form.reset();
      setNotice("Санкция применена. История и файлы не удалены.");
    });
    if (applied) setCreating(false);
  }
  async function createHook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running.current || uncertain) return;
    const data = new FormData(e.currentTarget);
    const selectionError = webhookSelectionError(
      String(data.get("channel") ?? ""),
      String(data.get("avatar") ?? ""),
      manageable.map((channel) => channel.id),
    );
    if (selectionError) {
      setError(selectionError);
      return;
    }
    const created = await run(async () => {
      const value = await write<WebhookSecret>(`/guilds/${guild.id}/webhooks`, "POST", {
        channel_id: data.get("channel"),
        name: data.get("name"),
        avatar: data.get("avatar"),
      });
      setSecret(value);
      setTested(false);
      testID.current = requestID();
    });
    if (created) setCreating(false);
  }
  async function testHook() {
    if (!secret) return;
    await run(async () => {
      await api<ChatMessage>(
        `/hooks/${secret.webhook.id}`,
        "POST",
        { client_id: testID.current, content: "Webhook: проверка подключения." },
        { Authorization: `Webhook ${secret.secret}` },
      );
      setTested(true);
      setNotice("Тестовое сообщение отправлено от отдельной webhook-идентичности.");
    });
  }
  const manageable = channels.filter(
    (c) =>
      c.permissions.includes("MANAGE_CHANNEL") &&
      c.permissions.includes("SEND_MESSAGES") &&
      c.permissions.includes("READ_HISTORY") &&
      (c.kind === "TEXT" || c.kind === "FORUM"),
  );
  const eligible = members.filter(
    (member) => member.can_manage && member.user.id !== guild.owner_id,
  );
  const targetOptions = eligible.map((member) => ({
    value: member.user.id,
    label: `${member.user.display_name} (@${member.user.login})`,
  }));
  const channelOptions = manageable.map((channel) => ({ value: channel.id, label: channel.name }));
  return (
    <section className={`community-card community-guild community-${panel}`}>
      <header className="community-page-heading">
        <h3>{{ moderation: "Модерация", webhooks: "Вебхуки", audit: "Журнал аудита" }[panel]}</h3>
        {panel !== "audit" && (
          <button
            className="id-primary"
            disabled={busy || uncertain}
            onClick={() => {
              setError("");
              setTarget(targetOptions[0]?.value ?? "");
              setDuration("900");
              setHookChannel(channelOptions[0]?.value ?? "");
              setHookAvatar("violet");
              setCreating(true);
            }}
          >
            <Icon name="plus" size={16} />
            {panel === "moderation" ? "Добавить ограничение" : "Создать вебхук"}
          </button>
        )}
      </header>
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
      {loading && <p role="status">Загружаем…</p>}
      {uncertain && (
        <p role="alert">
          Ответ потерян: действие могло выполниться. Проверьте список перед новой попыткой.{" "}
          <button
            disabled={busy}
            onClick={() =>
              void load().then((ok) => {
                if (ok) setUncertain(false);
              })
            }
          >
            Обновить список и разблокировать форму
          </button>
        </p>
      )}
      {panel === "moderation" && (
        <>
          {creating && (
            <Modal
              title="Ограничить участника"
              className="community-action-dialog"
              dismissible={!busy}
              onClose={() => setCreating(false)}
            >
              <form className="community-form" onSubmit={(e) => void sanction(e)}>
                <label>
                  Участник
                  <SelectField
                    label="Участник"
                    name="target"
                    required
                    value={initialChoice({ options: targetOptions, value: target })}
                    options={targetOptions}
                    onChange={setTarget}
                    disabled={busy || uncertain}
                  />
                </label>
                <label>
                  Ограничение
                  <SelectField
                    label="Ограничение"
                    value={kind}
                    options={moderationKinds}
                    onChange={(value) => {
                      setKind(value);
                      if (value === "KICK") setDuration("900");
                    }}
                    disabled={busy || uncertain}
                  />
                </label>
                {kind !== "KICK" && (
                  <label>
                    Длительность
                    <SelectField
                      label="Длительность"
                      name="duration"
                      value={duration}
                      options={moderationDurations}
                      onChange={setDuration}
                      disabled={busy || uncertain}
                    />
                  </label>
                )}
                <label className="wide">
                  Причина
                  <textarea
                    name="reason"
                    required
                    maxLength={500}
                    rows={3}
                    disabled={busy || uncertain}
                  />
                </label>
                {error && (
                  <p className="id-error" role="alert">
                    {error}
                  </p>
                )}
                {uncertain && (
                  <p className="id-error" role="status">
                    Ответ не получен. Проверьте список ограничений перед повторной попыткой.
                  </p>
                )}
                <footer>
                  <button type="button" disabled={busy} onClick={() => setCreating(false)}>
                    Отмена
                  </button>
                  <button disabled={busy || uncertain || !eligible.length} className="id-danger">
                    Применить
                  </button>
                </footer>
              </form>
            </Modal>
          )}
          {sanctions.some((s) => s.can_revoke) && (
            <label className="community-member-search">
              Причина отмены
              <input
                value={revokeReason}
                maxLength={500}
                onChange={(e) => setRevokeReason(e.target.value)}
              />
            </label>
          )}
          <div className="community-list">
            {sanctions.map((s) => (
              <article key={s.id}>
                <div>
                  <strong>
                    {sanctionNames[s.kind]} · {targetName(s.user_id)}
                  </strong>
                  <p>{s.reason}</p>
                  <small>
                    Модератор: {targetName(s.actor_id)} · {new Date(s.created_at).toLocaleString("ru-RU")}
                  </small>
                  <small>
                    {s.active ? "Действует" : s.kind === "KICK" ? "Участник исключён" : "Завершена"}{" "}
                    · {s.expires_at ? `до ${new Date(s.expires_at).toLocaleString("ru-RU")}` : "без срока"}
                  </small>
                  {s.revocation_reason && <small>Отмена: {s.revocation_reason}</small>}
                </div>
                {s.can_revoke && (
                  <button
                    disabled={busy || !revokeReason.trim()}
                    onClick={() =>
                      void run(async () => {
                        await write(`/guilds/${guild.id}/moderation/${s.id}/revoke`, "POST", {
                          reason: revokeReason,
                        });
                        setNotice("Санкция отменена.");
                      })
                    }
                  >
                    Снять ограничение
                  </button>
                )}
              </article>
            ))}
          </div>
          {!loading && !sanctions.length && (
            <div className="community-empty">
              <Icon name="lock" size={44} />
              <h4>Нет ограничений</h4>
            </div>
          )}
        </>
      )}
      {panel === "webhooks" && (
        <>
          {creating && (
            <Modal
              title="Создать вебхук"
              className="community-action-dialog"
              dismissible={!busy}
              onClose={() => setCreating(false)}
            >
              <form className="community-form" onSubmit={(e) => void createHook(e)}>
                <label>
                  Канал
                  <SelectField
                    label="Канал"
                    name="channel"
                    required
                    value={initialChoice({ options: channelOptions, value: hookChannel })}
                    options={channelOptions}
                    onChange={setHookChannel}
                    disabled={busy || uncertain}
                  />
                </label>
                <label>
                  Имя
                  <input name="name" maxLength={80} required disabled={busy || uncertain} />
                </label>
                <label>
                  Цвет аватара
                  <SelectField
                    label="Цвет аватара"
                    name="avatar"
                    value={hookAvatar}
                    options={webhookAvatars}
                    onChange={setHookAvatar}
                    disabled={busy || uncertain}
                  />
                </label>
                {error && (
                  <p className="id-error" role="alert">
                    {error}
                  </p>
                )}
                {uncertain && (
                  <p className="id-error" role="status">
                    Ответ не получен. Проверьте список вебхуков перед повторной попыткой.
                  </p>
                )}
                <footer>
                  <button type="button" disabled={busy} onClick={() => setCreating(false)}>
                    Отмена
                  </button>
                  <button className="id-primary" disabled={busy || uncertain || !manageable.length}>
                    Создать вебхук
                  </button>
                </footer>
              </form>
            </Modal>
          )}
          {secret && (
            <div className="community-secret">
              <h4>Секрет показывается только сейчас</h4>
              <p>
                POST {location.origin}/api/v1/hooks/{secret.webhook.id}
              </p>
              <label>
                Секрет webhook
                <textarea readOnly value={secret.secret} />
              </label>
              <div className="community-toolbar">
                <button disabled={busy || tested} onClick={() => void testHook()}>
                  {tested ? "Тест отправлен" : "Отправить тестовое сообщение"}
                </button>
                <button onClick={() => setSecret(null)}>Скрыть секрет</button>
              </div>
            </div>
          )}
          <div className="community-list">
            {hooks.map((h) => (
              <article key={h.id}>
                <div>
                  <strong>
                    {h.name} <span className="webhook-badge">WEBHOOK</span>
                  </strong>
                  <p>{channels.find((c) => c.id === h.channel_id)?.name ?? "Канал недоступен"}</p>
                  <small>
                    {h.revoked_at ? "Секрет отозван" : "Активен"} · создатель:{" "}
                    {targetName(h.creator_id)}
                  </small>
                  <details className="community-technical">
                    <summary>Подробности</summary>
                    <small>ID: {h.id}</small>
                  </details>
                </div>
                <div className="community-toolbar">
                  <button
                    disabled={busy || uncertain}
                    onClick={() =>
                      void run(async () => {
                        const value = await write<WebhookSecret>(
                          `/guilds/${guild.id}/webhooks/${h.id}/rotate`,
                          "POST",
                        );
                        setSecret(value);
                        setTested(false);
                        testID.current = requestID();
                      })
                    }
                  >
                    Регенерировать секрет
                  </button>
                  {!h.revoked_at && (
                    <button
                      className="id-danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await write(`/guilds/${guild.id}/webhooks/${h.id}`, "DELETE");
                          setSecret(null);
                          setNotice("Секрет отозван.");
                        })
                      }
                    >
                      Отозвать вебхук
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!hooks.length && !loading && (
            <div className="community-empty">
              <Icon name="link" size={44} />
              <h4>Здесь пока нет вебхуков</h4>
            </div>
          )}
        </>
      )}
      {panel === "audit" && (
        <>
          <form
            className="community-form community-audit-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              setFilters({
                action: String(d.get("action_override") || d.get("action") || ""),
                actor_id: String(d.get("actor_override") || d.get("actor") || ""),
                target_id: String(d.get("target") ?? ""),
              });
            }}
          >
            <label className="community-audit-action">
              Фильтр по действиям
              <SelectField
                label="Фильтр по действиям"
                name="action"
                value={filters.action}
                onChange={(action) => setFilters({ ...filters, action })}
                options={[
                  { value: "", label: "Все действия" },
                  ...Array.from(
                    new Set([
                      "guild.created",
                      "guild.updated",
                      "text.created",
                      "voice.created",
                      "forum.created",
                      "channels.updated",
                      "channels.reordered",
                      "channels.archived",
                      "category.created",
                      "categories.updated",
                      "categories.archived",
                      "role.created",
                      "role.updated",
                      "role.deleted",
                      "roles.reordered",
                      "overwrite.updated",
                      "overwrite.deleted",
                      "member.joined",
                      "member.left",
                      "member.kicked",
                      "member.roles_updated",
                      "invite.created",
                      "invite.revoked",
                      "webhook.created",
                      "webhook.revoked",
                      "webhook.rotated",
                      "moderation.ban",
                      "moderation.kick",
                      "moderation.mute_text",
                      "moderation.mute_voice",
                      "moderation.revoked",
                      "TRANSFER_OWNER",
                      "DELETE_GUILD",
                      ...audit.map((event) => event.action),
                      ...(filters.action ? [filters.action] : []),
                    ]),
                  ).map((action) => ({ value: action, label: auditLabel(action) })),
                ]}
              />
            </label>
            <label className="community-audit-actor">
              Фильтр по пользователям
              <SelectField
                label="Фильтр по пользователям"
                name="actor"
                value={filters.actor_id}
                onChange={(actor_id) => setFilters({ ...filters, actor_id })}
                options={[
                  { value: "", label: "Все участники" },
                  ...members.map((member) => ({
                    value: member.user.id,
                    label: member.user.display_name,
                  })),
                  ...(filters.actor_id &&
                  !members.some((member) => member.user.id === filters.actor_id)
                    ? [{ value: filters.actor_id, label: "Другой участник" }]
                    : []),
                ]}
              />
            </label>
            <details className="community-audit-advanced wide" key={JSON.stringify(filters)}>
              <summary>Дополнительные фильтры</summary>
              <label>
                Код действия
                <input name="action_override" />
              </label>
              <label>
                Идентификатор участника
                <input name="actor_override" />
              </label>
              <label>
                Идентификатор цели
                <input name="target" defaultValue={filters.target_id} />
              </label>
              <div className="community-filter-actions">
                <button disabled={loading}>Применить фильтры</button>
                {Object.values(filters).some(Boolean) && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setFilters({ action: "", actor_id: "", target_id: "" })}
                  >
                    Сбросить
                  </button>
                )}
              </div>
            </details>
          </form>
          <div className="community-list">
            {audit.map((a) => (
              <article key={a.id}>
                <div>
                  <strong>{auditLabel(a.action)}</strong>
                  <p>{targetName(a.actor_id)}</p>
                  <small>
                    {channels.find((c) => c.id === a.target_id)?.name ??
                      (a.target_id === guild.id
                        ? guild.name
                        : members.find((m) => m.user.id === a.target_id)?.user.display_name)}
                  </small>
                  <small>{new Date(a.created_at).toLocaleString("ru-RU")}</small>
                  <details>
                    <summary>Подробности</summary>
                    <small>
                      {a.action} · {a.target_id} · {a.actor_id} · Версия {a.revision}
                    </small>
                  </details>
                  {a.reason && <p>{a.reason}</p>}
                </div>
              </article>
            ))}
          </div>
          {cursor && (
            <button disabled={loading} onClick={() => void load(true)}>
              Более ранние события
            </button>
          )}
          {!loading && !audit.length && (
            <div className="community-empty community-audit-empty">
              <h4>Записей пока нет</h4>
              {Object.values(filters).some(Boolean) && <p>Нет событий по выбранным фильтрам.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
