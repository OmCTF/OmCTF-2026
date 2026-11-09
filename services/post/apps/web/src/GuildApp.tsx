import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type {
  GuildInfo,
  GuildChannel,
  GuildCategory,
  GuildRole,
  GuildMember,
  GuildInvite,
  GuildOverwrite,
  GuildConfirmation,
  CreatedInvite,
  Permission,
  GuildWSEvent,
} from "../../../packages/contracts/generated/ts/models";
import { api, NetworkError } from "./identity-api";
import { revisionHeaders } from "./guild-api";
import "./guild.css";
import { ChatWindow } from "./ChatWindow";
import { useVoice } from "./VoicePanel";
import { VoiceRoom } from "./VoiceStage";
import { SearchApp } from "./SearchApp";
import { navigate, useRoute } from "./navigation";
import { useNotifications, useUnread } from "./unread";
import { FavoriteButton, NotificationRuleEditor } from "./Community";
import { CommunityGuild } from "./CommunityGuild";
import { Icon } from "./Icons";
import { Modal as AppModal, useSwipeSidebar } from "./AppUI";
import { ServerGateway, ServerHome, type ServerStep } from "./ServerGateway";
import {
  initialChoice,
  validChoice,
  permissionMode,
  setPermissionMode,
  type PermissionMode,
} from "./guild-dialog-state";
import { GuildSettingsFrame } from "./GuildSettingsFrame";
import { GuildProfileEditor } from "./GuildProfileEditor";
import { InviteOptionField, InviteResultDialog, type InviteResult } from "./GuildInvite";
import { SelectField } from "./SelectField";
import {
  appendResourcePosition,
  canApplyResourceOrder,
  planResourceMove,
  sortResources,
  type ChannelOrder,
  type OrderItem,
  type OrderTarget,
} from "./channel-order";
import { useChannelDrag } from "./use-channel-drag";

export const permissionNames: Record<Permission, string> = {
  VIEW_CHANNEL: "Просмотр канала",
  SEND_MESSAGES: "Отправка сообщений",
  READ_HISTORY: "История",
  ATTACH_FILES: "Вложения",
  CREATE_THREAD: "Создание веток",
  MANAGE_MESSAGES: "Модерация сообщений",
  CONNECT_VOICE: "Подключение к голосу",
  SPEAK: "Микрофон",
  STREAM_VIDEO: "Трансляция видео",
  VIEW_STREAM: "Просмотр трансляций",
  CREATE_INVITE: "Приглашения",
  MANAGE_CHANNEL: "Управление каналами",
  MANAGE_ROLES: "Управление ролями",
  KICK_MEMBER: "Исключение участников",
  MANAGE_GUILD: "Настройки сервера",
};
const permissionDescriptions: Record<Permission, string> = {
  VIEW_CHANNEL: "Позволяет участникам просматривать этот канал.",
  SEND_MESSAGES: "Позволяет участникам отправлять сообщения в текстовых каналах.",
  READ_HISTORY: "Позволяет участникам читать ранее отправленные сообщения.",
  ATTACH_FILES: "Позволяет участникам прикреплять изображения и файлы к сообщениям.",
  CREATE_THREAD: "Позволяет участникам создавать ветки для обсуждений.",
  MANAGE_MESSAGES: "Позволяет участникам управлять сообщениями других участников.",
  CONNECT_VOICE: "Позволяет участникам подключаться к голосовым каналам.",
  SPEAK: "Позволяет участникам говорить в голосовых каналах.",
  STREAM_VIDEO: "Позволяет участникам включать камеру и демонстрировать экран.",
  VIEW_STREAM: "Позволяет участникам смотреть видео и демонстрации экрана.",
  CREATE_INVITE: "Позволяет участникам создавать приглашения на сервер.",
  MANAGE_CHANNEL: "Позволяет участникам создавать каналы и изменять их настройки.",
  MANAGE_ROLES: "Позволяет участникам управлять доступными им ролями и правами.",
  KICK_MEMBER: "Позволяет участникам исключать других участников с сервера.",
  MANAGE_GUILD: "Позволяет участникам изменять настройки сервера.",
};
type Page<T> = { items: T[]; revision: number };
type VoicePresence = {
  id: string;
  user_id: string;
  display_name: string;
  audio_active: boolean;
  speaking: boolean;
};
type Snapshot = {
  guild: GuildInfo;
  channels: GuildChannel[];
  categories: GuildCategory[];
  roles: GuildRole[];
  members: GuildMember[];
};
type Field = {
  name: string;
  label: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
};
type Modal = {
  title: string;
  text?: string;
  fields?: Field[];
  permissions?: Permission[];
  overwrites?: { allow: Permission[]; deny: Permission[] };
  submit?: string;
  danger?: boolean;
  variant?: "channel-create" | "category-create" | "resource-edit" | "role-edit" | "invite-create";
  context?: string;
  initialRolePage?: "display" | "permissions";
  resourceSettings?: {
    key: string;
    name: string;
    kind: "channel" | "category";
    page: "overview" | "permissions";
    permissionsEnabled: boolean;
    onPage: (page: "overview" | "permissions") => void;
    subjects?: { value: string; label: string }[];
    selectedSubject?: string;
    onSubject?: (subject: string) => void;
  };
  run: (data: FormData) => Promise<void>;
};
type CloseGuard = { current: ((after: () => void) => void) | null };
function ModalForm({
  modal,
  onClose,
  inline = false,
  closeGuard,
}: {
  modal: Modal;
  onClose: () => void;
  inline?: boolean;
  closeGuard?: CloseGuard;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const guarded = inline || !!modal.resourceSettings;
  const [dirty, setDirty] = useState(false);
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);
  const [rolePage, setRolePage] = useState(modal.initialRolePage ?? "display");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [selectValues, setSelectValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (modal.fields ?? [])
        .filter((field) => field.options)
        .map((field) => [
          field.name,
          initialChoice({ options: field.options!, value: field.value }),
        ]),
    ),
  );
  const requestClose = useCallback(
    (after: () => void) => {
      if (running.current) return;
      if (dirty) setPendingClose(() => after);
      else after();
    },
    [dirty],
  );
  useEffect(() => {
    if (!closeGuard) return;
    closeGuard.current = requestClose;
    return () => {
      closeGuard.current = null;
    };
  }, [closeGuard, requestClose]);
  const resourceCreate = modal.variant === "channel-create" || modal.variant === "category-create";
  useEffect(() => {
    if (inline && modal.initialRolePage === "permissions") {
      formRef.current?.parentElement
        ?.querySelector<HTMLInputElement>(".guild-permission-search input")
        ?.focus();
    } else if (inline || resourceCreate || modal.resourceSettings?.page === "overview") {
      formRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    }
  }, [inline, resourceCreate, modal.resourceSettings?.page, modal.initialRolePage]);
  const [resourceName, setResourceName] = useState(
    String(modal.fields?.find((f) => f.name === "name")?.value ?? ""),
  );
  const [resourceKind, setResourceKind] = useState(
    String(modal.fields?.find((f) => f.name === "kind")?.value ?? "TEXT"),
  );
  const [overrides, setOverrides] = useState(modal.overwrites ?? { allow: [], deny: [] });
  const channelTypes = [
    {
      value: "TEXT",
      label: "Текст",
      icon: "hash" as const,
      description: "Отправляйте сообщения, изображения, GIF, эмодзи и файлы",
    },
    {
      value: "VOICE",
      label: "Голос",
      icon: "speaker" as const,
      description: "Общайтесь голосом или в видеочате и пользуйтесь функцией показа экрана",
    },
    {
      value: "FORUM",
      label: "Форум",
      icon: "chat" as const,
      description: "Создайте площадку для обсуждений",
    },
  ];
  function field(f: Field) {
    if (modal.variant === "invite-create" && (f.name === "ttl_seconds" || f.name === "max_uses"))
      return (
        <InviteOptionField key={f.name} name={f.name} label={f.label} value={Number(f.value)} />
      );
    return (
      <label className="guild-dialog-field" key={f.name}>
        {f.label}
        {f.options ? (
          <SelectField
            name={f.name}
            label={f.label}
            value={selectValues[f.name] ?? ""}
            options={f.options}
            required={f.required}
            onChange={(value) => {
              setSelectValues((old) => ({ ...old, [f.name]: value }));
              if (guarded) setDirty(true);
            }}
          />
        ) : (
          <input
            name={f.name}
            type={f.type ?? "text"}
            defaultValue={f.value}
            autoFocus={inline && f.name === "name"}
            required={f.required}
            min={f.min}
            max={f.max}
            maxLength={f.name === "description" ? 1024 : 100}
          />
        )}
      </label>
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running.current || uncertain) return;
    if (inline && !e.currentTarget.checkValidity()) {
      setRolePage("display");
      setError("Проверьте название роли.");
      return;
    }
    const data = new FormData(e.currentTarget);
    const invalidSelection = modal.fields?.find((field) => {
      if (!field.options) return false;
      const value = String(data.get(field.name) ?? "");
      return !validChoice({ options: field.options, required: field.required }, value);
    });
    if (invalidSelection) {
      setError(`Выберите значение: ${invalidSelection.label}.`);
      Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="combobox"]'))
        .find((control) => control.getAttribute("aria-label") === invalidSelection.label)
        ?.focus();
      return;
    }
    if (
      modal.fields?.some((f) => f.name === "name" && f.required) &&
      !String(data.get("name") ?? "").trim()
    ) {
      setError("Введите название.");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await modal.run(data);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка запроса");
      if (e instanceof NetworkError && e.uncertain) setUncertain(true);
    } finally {
      setBusy(false);
      running.current = false;
    }
  }
  const form = (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate={inline}
      onChangeCapture={() => {
        if (guarded) setDirty(true);
      }}
    >
      <fieldset disabled={busy}>
        <div className="guild-dialog-body">
          {modal.context && !modal.resourceSettings?.subjects && (
            <p className="guild-dialog-context">{modal.context}</p>
          )}
          {modal.text && <p>{modal.text}</p>}
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <p role="status">Ответ не получен. Обновите список перед повторной попыткой.</p>
          )}
          {modal.variant === "channel-create" && (
            <div className="guild-channel-types" role="radiogroup" aria-label="Тип канала">
              <span>Тип канала</span>
              {channelTypes.map((type) => (
                <label key={type.value}>
                  <input
                    type="radio"
                    name="kind"
                    value={type.value}
                    checked={resourceKind === type.value}
                    onChange={() => setResourceKind(type.value)}
                  />
                  <span>
                    <strong>
                      <Icon name={type.icon} size={20} />
                      {type.label}
                    </strong>
                    <small>{type.description}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          {resourceCreate ? (
            <>
              <label className="guild-dialog-field">
                {modal.variant === "channel-create" ? "Название канала" : "Название категории"}
                <span className="guild-name-control">
                  {modal.variant === "channel-create" && (
                    <Icon
                      name={
                        resourceKind === "VOICE"
                          ? "speaker"
                          : resourceKind === "FORUM"
                            ? "chat"
                            : "hash"
                      }
                      size={20}
                    />
                  )}
                  <input
                    name="name"
                    value={resourceName}
                    onChange={(e) => setResourceName(e.target.value)}
                    required
                    maxLength={100}
                    autoFocus
                    placeholder={
                      modal.variant === "channel-create" ? "новый-канал" : "Новая категория"
                    }
                  />
                </span>
              </label>
              {!!modal.fields?.some((f) => f.name !== "name" && f.name !== "kind") && (
                <details className="guild-resource-advanced">
                  <summary>Дополнительные настройки</summary>
                  {modal.fields?.filter((f) => f.name !== "name" && f.name !== "kind").map(field)}
                </details>
              )}
            </>
          ) : (
            <div className="guild-dialog-fields" hidden={inline && rolePage !== "display"}>
              {modal.fields?.map(field)}
            </div>
          )}
          {modal.permissions && (
            <div hidden={inline && rolePage !== "permissions"}>
              <Permissions
                name="permissions"
                selected={modal.permissions}
                query={permissionQuery}
              />
            </div>
          )}
          {modal.overwrites && (
            <div className="guild-permission-overwrites">
              {Object.entries(permissionNames).map(([key, label]) => {
                const permission = key as Permission;
                const current = permissionMode(overrides, permission);
                return (
                  <div className="guild-permission-row" key={permission}>
                    <span>
                      {label}
                      <small>{permissionDescriptions[permission]}</small>
                    </span>
                    {current !== "inherit" && (
                      <input type="hidden" name={current} value={permission} />
                    )}
                    <div className="guild-permission-tristate" role="radiogroup" aria-label={label}>
                      {(["deny", "inherit", "allow"] as PermissionMode[]).map((mode) => (
                        <label key={mode} className={mode}>
                          <input
                            type="radio"
                            name={`permission-${permission}`}
                            value={mode}
                            checked={current === mode}
                            aria-label={`${label}, ${mode === "deny" ? "Запретить" : mode === "allow" ? "Разрешить" : "Унаследовать"}`}
                            onChange={() =>
                              setOverrides((value) => setPermissionMode(value, permission, mode))
                            }
                          />
                          <span aria-hidden="true">
                            {mode === "inherit" ? (
                              "/"
                            ) : (
                              <Icon name={mode === "allow" ? "check" : "close"} size={18} />
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <footer hidden={guarded && !dirty && modal.submit !== "Открыть"}>
          <button type="button" onClick={() => (guarded ? requestClose(onClose) : onClose())}>
            Отмена
          </button>
          <button
            disabled={uncertain || (resourceCreate && !resourceName.trim())}
            className={modal.danger ? "id-danger" : "id-primary"}
            type="submit"
          >
            {busy ? "Подождите…" : (modal.submit ?? "Сохранить")}
          </button>
        </footer>
      </fieldset>
    </form>
  );
  const discardConfirmation = pendingClose && (
    <AppModal
      title="Несохранённые изменения"
      className="confirmation-dialog"
      onClose={() => setPendingClose(null)}
    >
      <p>Выйти без сохранения изменений?</p>
      <footer>
        <button onClick={() => setPendingClose(null)}>Отмена</button>
        <button
          className="id-danger"
          onClick={() => {
            const close = pendingClose;
            setPendingClose(null);
            close();
          }}
        >
          Не сохранять
        </button>
      </footer>
    </AppModal>
  );
  if (modal.resourceSettings) {
    const settings = modal.resourceSettings;
    return (
      <>
        <AppModal
          title={modal.title}
          className="guild-resource-settings"
          onClose={() => requestClose(onClose)}
          dismissible={!busy}
          animateClose={false}
        >
          <aside className="guild-resource-sidebar">
            <nav
              aria-label={settings.kind === "channel" ? "Настройки канала" : "Настройки категории"}
            >
              <h2>
                {settings.kind === "channel" ? "# " : ""}
                {settings.name}
              </h2>
              <button
                type="button"
                aria-current={settings.page === "overview" ? "page" : undefined}
                disabled={busy}
                onClick={() => {
                  if (settings.page !== "overview") requestClose(() => settings.onPage("overview"));
                }}
              >
                Обзор
              </button>
              {settings.permissionsEnabled && (
                <button
                  type="button"
                  aria-current={settings.page === "permissions" ? "page" : undefined}
                  disabled={busy}
                  onClick={() => {
                    if (settings.page !== "permissions" || modal.overwrites)
                      requestClose(() => settings.onPage("permissions"));
                  }}
                >
                  Права доступа
                </button>
              )}
            </nav>
          </aside>
          <div className="guild-resource-scroll">
            <div className="guild-resource-content">
              <h3>
                {settings.page === "overview"
                  ? "Обзор"
                  : settings.kind === "channel"
                    ? "Права канала"
                    : "Права категории"}
              </h3>
              {settings.subjects ? (
                <div className="guild-resource-permission-layout">
                  <aside aria-label="Роли и участники">
                    <h4>Роли / Участники</h4>
                    {settings.subjects.map((subject) => (
                      <button
                        key={subject.value}
                        type="button"
                        aria-current={
                          settings.selectedSubject === subject.value ? "true" : undefined
                        }
                        disabled={busy}
                        onClick={() => {
                          if (settings.selectedSubject !== subject.value)
                            requestClose(() => settings.onSubject?.(subject.value));
                        }}
                      >
                        {subject.label.replace(/^Роль: /, "@").replace(/^Участник: /, "")}
                      </button>
                    ))}
                  </aside>
                  <div>
                    <h4>Основные права {settings.kind === "channel" ? "канала" : "категории"}</h4>
                    {form}
                  </div>
                </div>
              ) : (
                form
              )}
            </div>
          </div>
        </AppModal>
        {discardConfirmation}
      </>
    );
  }
  if (!inline)
    return (
      <AppModal
        className={`guild-modal${modal.danger && !modal.fields?.length ? " guild-confirmation" : ""}${modal.variant ? ` guild-${modal.variant}` : ""}${modal.overwrites ? " guild-overwrite-dialog" : ""}`}
        title={modal.title}
        onClose={onClose}
        dismissible={!busy}
      >
        {form}
      </AppModal>
    );
  const roleName = String(modal.fields?.find((f) => f.name === "name")?.value ?? "Новая роль");
  return (
    <section className="guild-inline-role">
      <aside>
        <button
          type="button"
          className="guild-role-back"
          onClick={() => requestClose(onClose)}
          disabled={busy}
        >
          <Icon name="arrow" size={18} />
          Назад
        </button>
        <div className="guild-role-selected">{roleName || "Новая роль"}</div>
      </aside>
      <div className="guild-inline-role-main">
        <h3>{roleName || "Новая роль"}</h3>
        <div className="guild-role-tabs" role="tablist" aria-label="Настройки роли">
          <button
            type="button"
            role="tab"
            aria-selected={rolePage === "display"}
            onClick={() => setRolePage("display")}
          >
            Отображение
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rolePage === "permissions"}
            onClick={() => setRolePage("permissions")}
          >
            Права доступа
          </button>
        </div>
        {rolePage === "permissions" && (
          <label className="guild-permission-search">
            <Icon name="search" size={20} />
            <input
              aria-label="Поиск разрешений"
              placeholder="Поиск разрешений"
              value={permissionQuery}
              onChange={(e) => setPermissionQuery(e.target.value)}
            />
          </label>
        )}
        {form}
      </div>
      {discardConfirmation}
    </section>
  );
}
function Permissions({
  name,
  selected,
  title = "Разрешения",
  query = "",
}: {
  name: string;
  selected: Permission[];
  title?: string;
  query?: string;
}) {
  return (
    <section className="guild-permission-editor" aria-label={title}>
      <h3>{title}</h3>
      {Object.entries(permissionNames).map(([op, label]) => (
        <label
          key={op}
          hidden={!label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
        >
          <input
            type="checkbox"
            role="switch"
            name={name}
            value={op}
            defaultChecked={selected.includes(op as Permission)}
          />
          <span>
            {label}
            <small>{permissionDescriptions[op as Permission]}</small>
          </span>
        </label>
      ))}
    </section>
  );
}
const text = (f: FormData, key: string) => String(f.get(key) ?? "");
const number = (f: FormData, key: string) => Number(f.get(key));
const nameField = (value = ""): Field => ({
  name: "name",
  label: "Название",
  value,
  required: true,
});
const can = (permissions: Permission[], op: Permission) => permissions.includes(op);

export function GuildApp({ userID }: { userID: string }) {
  const route = useRoute();
  const selected = route.guild ?? "",
    channelID = route.room ?? "",
    tab = route.view ?? "channels";
  const guildMenuToggle = useRef<HTMLButtonElement>(null);
  const setTab = (view: string) => {
    const change = () => {
      navigate({ ...route, view });
      setManagementOpen(false);
      if (modal?.variant === "role-edit") setModal(null);
      if (view === "channels") {
        requestAnimationFrame(() => {
          if (selectedRef.current !== selected || document.querySelector("dialog[open]")) return;
          const button = guildMenuToggle.current;
          if (!button?.isConnected) return;
          const rect = button?.getBoundingClientRect();
          const visible = rect && rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
          (visible ? button : document.getElementById("id-content"))?.focus({
            preventScroll: true,
          });
        });
      }
    };
    if (roleCloseGuard.current) roleCloseGuard.current(change);
    else change();
  };
  const roleCloseGuard = useRef<CloseGuard["current"]>(null);
  const [guilds, setGuilds] = useState<GuildInfo[]>([]),
    [data, setSnapshot] = useState<Snapshot | null>(null);
  const snapshot = data?.guild.id === selected ? data : null;
  useEffect(() => {
    if (!snapshot || channelID || tab !== "channels") return;
    const first =
      snapshot.channels.find((c) => c.kind !== "VOICE" && can(c.permissions, "READ_HISTORY")) ??
      snapshot.channels.find((c) => can(c.permissions, "VIEW_CHANNEL"));
    if (first) navigate({ ...route, room: first.id, kind: "channel" }, true);
  }, [snapshot, channelID, tab]);
  const [treeOpen, setTreeOpen] = useState(!channelID);
  const swipe = useSwipeSidebar(setTreeOpen);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [managementOpen, setManagementOpen] = useState(false);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document
        .querySelectorAll<HTMLDetailsElement>(".guild-app .channel-row-actions[open], .guild-app .category-tools[open]")
        .forEach((menu) => {
          if (!menu.contains(target)) menu.open = false;
        });
    };
    const escapeMenus = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = document.querySelectorAll<HTMLDetailsElement>(
        ".guild-app .channel-row-actions[open], .guild-app .category-tools[open]",
      );
      if (!open.length) return;
      open.forEach((menu) => { menu.open = false; });
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", closeMenus, true);
    document.addEventListener("keydown", escapeMenus, true);
    return () => {
      document.removeEventListener("pointerdown", closeMenus, true);
      document.removeEventListener("keydown", escapeMenus, true);
    };
  }, []);
  const [membersOpen, setMembersOpen] = useState(true);
  const [memberQuery, setMemberQuery] = useState("");
  const unread = useUnread(
    "channel",
    snapshot?.channels
      .filter((c) => c.kind !== "VOICE" && can(c.permissions, "READ_HISTORY"))
      .map((c) => c.id) ?? [],
  );
  const notifications = useNotifications();
  const [modal, setModal] = useState<Modal | null>(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  const [draggedRole, setDraggedRole] = useState<string | null>(null);
  const [roleDrop, setRoleDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [roleOrderBusy, setRoleOrderBusy] = useState(false);
  const [roleOrderStatus, setRoleOrderStatus] = useState("");
  const roleOrderBusyRef = useRef(false);
  const touchRole = useRef<{
    pointer: number;
    source: string;
    guild: string;
    startX: number;
    startY: number;
    active: boolean;
    target: { id: string; after: boolean } | null;
  } | null>(null);
  const [invites, setInvites] = useState<GuildInvite[]>([]),
    [inviteResult, setInviteResult] = useState<InviteResult | null>(null),
    [connection, setConnection] = useState("Не подключено");
  const [gateway, setGateway] = useState<ServerStep | null>(null);
  useEffect(() => {
    if (notice !== "Изменения сохранены.") return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const call = useVoice();
  const [voicePresence, setVoicePresence] = useState<Record<string, VoicePresence[]>>({});
  useEffect(() => {
    if (!selected) {
      setVoicePresence({});
      return;
    }
    let active = true;
    let loading = false;
    setVoicePresence({});
    const refreshPresence = async () => {
      if (!active || loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const response = await api<{ items: Record<string, VoicePresence[]> }>(
          `/voice/presence?guild_id=${encodeURIComponent(selected)}`,
        );
        if (active) setVoicePresence(response.items);
      } catch {
      } finally {
        loading = false;
      }
    };
    void refreshPresence();
    const timer = setInterval(() => void refreshPresence(), 1500);
    document.addEventListener("visibilitychange", refreshPresence);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshPresence);
    };
  }, [selected]);
  useEffect(() => {
    setGateway(route.invite ? "join" : (route.serverAction ?? null));
  }, [route.invite, route.serverAction]);
  const generation = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const report = (e: unknown) => setError(e instanceof Error ? e.message : "Ошибка запроса");
  const loadReport = (e: unknown) =>
    setLoadError(e instanceof Error ? e.message : "Не удалось обновить сервер");
  const refresh = useCallback(async (id = selectedRef.current) => {
    const request = ++generation.current;
    const list = await api<{ items: GuildInfo[] }>("/guilds");
    if (request !== generation.current) return;
    setLoadError("");
    setGuilds(list.items);
    if (!id) return;
    if (!list.items.some((g) => g.id === id)) {
      setSnapshot(null);
      setNotice("Сервер больше недоступен.");
      return;
    }
    for (let retry = 0; retry < 3; retry++) {
      const g = await api<GuildInfo>(`/guilds/${id}`);
      const [channels, categories, roles, members] = await Promise.all([
        api<Page<GuildChannel>>(`/guilds/${id}/channels`),
        api<Page<GuildCategory>>(`/guilds/${id}/categories`),
        api<Page<GuildRole>>(`/guilds/${id}/roles`),
        api<Page<GuildMember>>(`/guilds/${id}/members`),
      ]);
      if (request !== generation.current || selectedRef.current !== id) return;
      if ([channels, categories, roles, members].every((p) => p.revision === g.revision)) {
        setSnapshot({
          guild: g,
          channels: channels.items,
          categories: categories.items,
          roles: roles.items,
          members: members.items,
        });
        return;
      }
    }
    throw Error("Права меняются. Обновите сервер через секунду.");
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");
    setModal(null);
    void refresh(selected)
      .catch((e) => {
        if (active) loadReport(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [selected, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh().catch(loadReport);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const guild = snapshot?.guild;
  const selectedChannel = snapshot?.channels.find((c) => c.id === channelID);
  const [ordering, setOrdering] = useState(false);
  const orderingRef = useRef(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [orderFailed, setOrderFailed] = useState(false);
  useEffect(() => {
    setOrderMessage("");
    setRoleOrderStatus("");
    setDraggedRole(null);
    setRoleDrop(null);
    touchRole.current = null;
  }, [selected]);
  useEffect(() => {
    if (!orderMessage || orderFailed || ordering) return;
    const timer = setTimeout(() => setOrderMessage(""), 2200);
    return () => clearTimeout(timer);
  }, [orderMessage, orderFailed, ordering]);
  async function moveResource(item: OrderItem, target: OrderTarget, revision: number) {
    if (!snapshot || orderingRef.current) return;
    const id = snapshot.guild.id;
    if (snapshot.guild.revision !== revision) {
      setOrderFailed(true);
      setOrderMessage("Список каналов изменился. Повторите перемещение.");
      return;
    }
    const plan = planResourceMove(snapshot.categories, snapshot.channels, item, target);
    if (!plan) return;
    if (
      !canApplyResourceOrder(
        snapshot.guild.permissions,
        snapshot.categories,
        snapshot.channels,
        plan,
      )
    ) {
      setOrderFailed(true);
      setOrderMessage("Недостаточно прав для изменения порядка в этом разделе.");
      return;
    }
    orderingRef.current = true;
    setOrdering(true);
    setOrderFailed(false);
    setOrderMessage("Сохраняем порядок…");
    try {
      await api<GuildInfo>(`/guilds/${id}/channel-order`, "PUT", plan, revisionHeaders(revision));
      if (selectedRef.current === id) {
        await refresh(id);
        if (selectedRef.current === id) setOrderMessage("Порядок обновлён.");
      }
    } catch (error) {
      if (selectedRef.current === id) {
        setOrderFailed(true);
        setOrderMessage(
          error instanceof NetworkError && error.uncertain
            ? "Не удалось подтвердить перемещение. Проверяем актуальный порядок."
            : error instanceof Error
              ? error.message
              : "Не удалось переместить канал.",
        );
        await refresh(id).catch(loadReport);
      }
    } finally {
      orderingRef.current = false;
      setOrdering(false);
    }
  }
  const treeDrag = useChannelDrag({
    scope: selected,
    revision: guild?.revision ?? 0,
    channels: snapshot?.channels ?? [],
    categories: snapshot?.categories ?? [],
    permissions: guild?.permissions ?? [],
    disabled: ordering || tab !== "channels" || !!modal,
    onMove: (item, target, revision) => void moveResource(item, target, revision),
    onExpand: (id) =>
      setCollapsedCategories((old) => {
        if (!old.has(id)) return old;
        const next = new Set(old);
        next.delete(id);
        return next;
      }),
  });
  useEffect(() => {
    if (!selectedChannel) return;
    let active = true;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout>;
    const heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
    }, 15000);
    const connect = async () => {
      try {
        await api("/auth/session");
        if (!active) return;
        const path = "/api/v1/ws";
        socket = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}?channel_id=${selectedChannel.id}`,
        );
        socket.onmessage = (e) => {
          const event = JSON.parse(e.data) as GuildWSEvent;
          if (event.kind === "channel.authorized") setConnection("Доступ к каналу подтверждён");
          if (event.kind === "acl.changed" || event.kind === "access.revoked") {
            if (event.kind === "access.revoked") setConnection("Доступ отозван");
            void refresh().catch(loadReport);
          }
        };
        socket.onclose = () => {
          if (active) {
            setConnection("Проверяем доступ…");
            void refresh().catch(loadReport);
            reconnect = setTimeout(() => void connect(), 3000);
          }
        };
      } catch (e) {
        if (active) {
          report(e);
          reconnect = setTimeout(() => void connect(), 3000);
        }
      }
    };
    void connect();
    return () => {
      active = false;
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      socket?.close();
    };
  }, [selectedChannel?.id, refresh]);
  useEffect(() => {
    if (!guild || !can(guild.permissions, "MANAGE_GUILD")) {
      setInvites([]);
      if (guild && (tab === "invites" || tab === "settings")) setTab("channels");
      return;
    }
    let active = true;
    if (tab === "invites")
      void api<Page<GuildInvite>>(`/guilds/${guild.id}/invites`)
        .then((p) => {
          if (active) setInvites(p.items);
        })
        .catch(report);
    return () => {
      active = false;
    };
  }, [guild?.id, guild?.revision, tab]);
  function choose(id: string) {
    setGateway(null);
    generation.current++;
    navigate({ tab: "guilds", guild: id });
    setSnapshot(null);
    setTreeOpen(true);
    setError("");
    setNotice("");
    setInviteResult(null);
    if (id === selected) void refresh(id).catch(report);
  }
  function mutation(path: string, method: string, body?: unknown, revision = guild?.revision) {
    return api(path, method, body, revisionHeaders(revision ?? 0));
  }
  function edit(
    title: string,
    path: string,
    method: string,
    fields: Field[],
    body: (data: FormData) => unknown,
    extra: Partial<Modal> = {},
  ) {
    const revision = guild?.revision;
    setModal({
      title,
      fields,
      ...extra,
      run: async (f) => {
        await mutation(path, method, body(f), revision);
        await refresh();
        setNotice("Изменения сохранены.");
      },
    });
  }
  function confirm(
    title: string,
    message: string,
    path: string,
    method = "DELETE",
    body?: unknown,
  ) {
    edit(title, path, method, [], () => body, {
      text: message,
      danger: true,
      submit: "Подтвердить",
    });
  }
  function createGuild() {
    setGateway("create");
  }
  function roleEditor(role?: GuildRole) {
    if (!guild || !snapshot) return;
    const nextPosition = guild.owner_id === userID
      ? Math.max(0, ...snapshot.roles.map((item) => item.position)) + 1
      : 1;
    edit(
      role ? `Роль: ${role.name}` : "Новая роль",
      `/guilds/${guild.id}/roles${role ? `/${role.id}` : ""}`,
      role ? "PATCH" : "POST",
      [nameField(role?.name)],
      (f) => ({
        name: text(f, "name"),
        ...(!role ? { position: nextPosition } : {}),
        permissions: f.getAll("permissions"),
      }),
      {
        permissions: role?.permissions ?? [],
        variant: "role-edit",
        initialRolePage: role?.is_default ? "permissions" : "display",
      },
    );
  }
  async function moveRole(sourceID: string, targetID: string, after: boolean) {
    if (!guild || !snapshot || roleOrderBusyRef.current || sourceID === targetID) return;
    const roles = snapshot.roles
      .filter((role) => !role.is_default)
      .sort((a, b) => b.position - a.position);
    if (!roles.find((role) => role.id === sourceID && role.can_edit)) return;
    const visibleIDs = roles.map((role) => role.id);
    const original = visibleIDs.join(",");
    visibleIDs.splice(visibleIDs.indexOf(sourceID), 1);
    const target = visibleIDs.indexOf(targetID);
    if (target < 0) return;
    visibleIDs.splice(target + (after ? 1 : 0), 0, sourceID);
    if (visibleIDs.join(",") === original) return;
    const ids = [...visibleIDs].reverse();
    const id = guild.id;
    roleOrderBusyRef.current = true;
    setRoleOrderBusy(true);
    setRoleOrderStatus("");
    setSnapshot((current) => current?.guild.id === guild.id
      ? { ...current, roles: current.roles.map((role) => {
          const position = ids.indexOf(role.id);
          return position < 0 ? role : { ...role, position: position + 1 };
        }) }
      : current);
    try {
      await mutation(`/guilds/${id}/role-order`, "PUT", { role_ids: ids }, guild.revision);
      if (selectedRef.current === id) {
        await refresh(id);
        if (selectedRef.current === id) setRoleOrderStatus("Порядок ролей сохранён.");
      }
    } catch (e) {
      if (selectedRef.current === id) {
        await refresh(id).catch(() => {});
        if (selectedRef.current === id)
          setRoleOrderStatus(e instanceof Error ? e.message : "Не удалось изменить порядок ролей.");
      }
    } finally {
      roleOrderBusyRef.current = false;
      setRoleOrderBusy(false);
    }
  }
  function moveTouchRole(event: ReactPointerEvent<HTMLElement>) {
    const drag = touchRole.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6)
      return;
    if (!drag.active) {
      drag.active = true;
      setDraggedRole(drag.source);
      setRoleOrderStatus("");
    }
    event.preventDefault();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const row = hit?.closest<HTMLElement>(".guild-role-row[data-role-id]");
    if (!row || row.dataset.roleId === drag.source || !row.closest(".guild-settings-roles")) {
      drag.target = null;
      setRoleDrop(null);
      return;
    }
    const rect = row.getBoundingClientRect();
    const target = { id: row.dataset.roleId!, after: event.clientY > rect.top + rect.height / 2 };
    if (drag.target?.id !== target.id || drag.target.after !== target.after) {
      drag.target = target;
      setRoleDrop(target);
    }
  }
  function endTouchRole(event: ReactPointerEvent<HTMLElement>) {
    const drag = touchRole.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    touchRole.current = null;
    setDraggedRole(null);
    setRoleDrop(null);
    if (drag.active && drag.target && drag.guild === selectedRef.current)
      void moveRole(drag.source, drag.target.id, drag.target.after);
  }
  function cancelTouchRole(event: ReactPointerEvent<HTMLElement>) {
    if (touchRole.current?.pointer !== event.pointerId) return;
    touchRole.current = null;
    setDraggedRole(null);
    setRoleDrop(null);
  }
  function resourceEditor(kind: "category" | "channel", resource?: GuildCategory | GuildChannel) {
    if (!guild || !snapshot) return;
    const isChannel = kind === "channel";
    const categoryID =
      resource && "category_id" in resource
        ? (resource.category_id ?? "")
        : (selectedChannel?.category_id ?? "");
    const fields = [
      { ...nameField(resource?.name), label: isChannel ? "Название канала" : "Название категории" },
    ];
    if (isChannel) {
      fields.push({
        name: "category_id",
        label: "Категория",
        value: categoryID,
        options: [
          { value: "", label: "Без категории" },
          ...snapshot.categories.map((c) => ({ value: c.id, label: c.name })),
        ],
      });
      if (!resource)
        fields.push({
          name: "kind",
          label: "Тип канала",
          value: "TEXT",
          options: [
            { value: "TEXT", label: "Текстовый" },
            { value: "VOICE", label: "Голосовой" },
            { value: "FORUM", label: "Форум" },
          ],
        });
    }
    let editorRevision = guild.revision;
    let editorChannels = snapshot.channels;
    let editorCategories = snapshot.categories;
    setModal({
      title: resource
        ? `Настройки: ${resource.name}`
        : isChannel
          ? "Создать канал"
          : "Создать категорию",
      fields,
      run: async (f) => {
        const parent = text(f, "category_id");
        const body: Record<string, unknown> = { name: text(f, "name") };
        if (isChannel && (!resource || parent !== categoryID)) body.category_id = parent;
        if (!resource) {
          const group = isChannel
            ? editorChannels.filter((channel) => (channel.category_id ?? "") === parent)
            : editorCategories;
          const append = appendResourcePosition(group);
          if (append.compact.length) {
            const order: ChannelOrder = {
              categories: isChannel ? [] : append.compact,
              channels: isChannel ? append.compact : [],
            };
            if (!canApplyResourceOrder(guild.permissions, editorCategories, editorChannels, order))
              throw Error("Недостаточно прав для упорядочивания каналов в этом разделе.");
            const updated = await api<GuildInfo>(
              `/guilds/${guild.id}/channel-order`,
              "PUT",
              order,
              revisionHeaders(editorRevision),
            );
            editorRevision = updated.revision;
            editorChannels = editorChannels.map((channel) => ({
              ...channel,
              ...order.channels.find((item) => item.id === channel.id),
            }));
            editorCategories = editorCategories.map((category) => ({
              ...category,
              ...order.categories.find((item) => item.id === category.id),
            }));
          }
          body.position = append.position;
          if (isChannel) body.kind = text(f, "kind");
        }
        await mutation(
          resource
            ? `/${isChannel ? "channels" : "categories"}/${resource.id}`
            : `/guilds/${guild.id}/${isChannel ? "channels" : "categories"}`,
          resource ? "PATCH" : "POST",
          body,
          editorRevision,
        );
        await refresh().catch(loadReport);
        setNotice("Изменения сохранены.");
      },
      variant: resource ? "resource-edit" : isChannel ? "channel-create" : "category-create",
      ...(resource ? { resourceSettings: resourceSettings(resource, kind, "overview") } : {}),
      submit: resource ? "Сохранить" : isChannel ? "Создать канал" : "Создать категорию",
      ...(!resource && isChannel
        ? {
            context: `в ${snapshot.categories.find((c) => c.id === categoryID)?.name ?? guild.name}`,
          }
        : {}),
    });
  }
  function resourceSettings(
    resource: GuildChannel | GuildCategory,
    kind: "channel" | "category",
    page: "overview" | "permissions",
    subject = "",
  ): NonNullable<Modal["resourceSettings"]> {
    return {
      key: `${resource.id}:${page}:${subject}`,
      name: resource.name,
      kind,
      page,
      permissionsEnabled: !!guild && can(guild.permissions, "MANAGE_ROLES"),
      onPage: (next) => {
        if (next === "overview") resourceEditor(kind, resource);
        else void overwrites(resource, kind === "channel" ? "channels" : "categories");
      },
    };
  }
  async function overwrites(
    resource: GuildChannel | GuildCategory,
    kind: "channels" | "categories",
  ) {
    if (!snapshot) return;
    try {
      const page = await api<Page<GuildOverwrite>>(`/${kind}/${resource.id}/overwrites`);
      const subjects = [
        ...snapshot.roles.map((r) => ({ value: `role:${r.id}`, label: `Роль: ${r.name}` })),
        ...snapshot.members.map((m) => ({
          value: `user:${m.user.id}`,
          label: `Участник: ${m.user.display_name}`,
        })),
      ];
      const openSubject = (subject: string) => {
        const existing = page.items.find((o) => `${o.subject_kind}:${o.subject_id}` === subject);
        setModal({
          title: `Права: ${subjects.find((s) => s.value === subject)?.label}`,
          resourceSettings: {
            ...resourceSettings(
              resource,
              kind === "channels" ? "channel" : "category",
              "permissions",
              subject,
            ),
            subjects,
            selectedSubject: subject,
            onSubject: openSubject,
          },
          fields: [
            {
              name: "action",
              label: "Настройка разрешений",
              value: "save",
              options: [
                { value: "save", label: "Изменить права" },
                { value: "delete", label: "Сбросить переопределения" },
              ],
            },
          ],
          overwrites: { allow: existing?.allow ?? [], deny: existing?.deny ?? [] },
          run: async (d) => {
            await mutation(
              `/${kind}/${resource.id}/overwrites/${subject}`,
              text(d, "action") === "delete" ? "DELETE" : "PUT",
              text(d, "action") === "delete"
                ? undefined
                : { allow: d.getAll("allow"), deny: d.getAll("deny") },
              page.revision,
            );
            await refresh();
          },
        });
      };
      if (subjects[0]) openSubject(subjects[0].value);
    } catch (e) {
      report(e);
    }
  }
  function createInvite(channel: GuildChannel) {
    if (!guild) return;
    const revision = guild.revision;
    setModal({
      title: "Параметры ссылки-приглашения",
      variant: "invite-create",
      fields: [
        {
          name: "ttl_seconds",
          label: "Устареет через",
          type: "number",
          value: 86400,
          min: 60,
          max: 604800,
          required: true,
        },
        {
          name: "max_uses",
          label: "Максимальное кол-во использований",
          type: "number",
          value: 10,
          min: 1,
          max: 1000,
          required: true,
        },
      ],
      submit: "Сгенерировать ссылку",
      run: async (f) => {
        const invite = await api<CreatedInvite>(
          `/guilds/${guild.id}/invites`,
          "POST",
          {
            channel_id: channel.id,
            max_uses: number(f, "max_uses"),
            ttl_seconds: number(f, "ttl_seconds"),
          },
          { "If-Match": `"${revision}"` },
        );
        await refresh().catch(loadReport);
        if (selectedRef.current === guild.id)
          setInviteResult({
            link: `${location.origin}/#invite=${invite.code}`,
            guildName: guild.name,
            channelName: channel.name,
            voice: channel.kind === "VOICE",
            expiresAt: invite.invite.expires_at,
            maxUses: invite.invite.max_uses,
          });
      },
    });
  }
  function assign(member: GuildMember) {
    if (!snapshot || !guild) return;
    const choices = snapshot.roles.filter((r) => r.can_assign && !r.is_default);
    const revision = guild.revision;
    setModal({
      title: `Роли: ${member.user.display_name}`,
      text: `Назначены: ${snapshot.roles
        .filter((r) => member.role_ids.includes(r.id) || r.is_default)
        .map((r) => r.name)
        .join(", ")}`,
      fields: [
        {
          name: "role",
          label: "Роль",
          options: choices.map((r) => ({ value: r.id, label: r.name })),
          required: true,
        },
        {
          name: "action",
          label: "Действие",
          options: [
            { value: "PUT", label: "Назначить" },
            { value: "DELETE", label: "Снять" },
          ],
        },
      ],
      run: async (f) => {
        await mutation(
          `/guilds/${guild.id}/members/${member.user.id}/roles/${text(f, "role")}`,
          text(f, "action"),
          undefined,
          revision,
        );
        await refresh();
      },
    });
  }
  function dangerous(action: "TRANSFER_OWNER" | "DELETE_GUILD") {
    if (!guild || !snapshot) return;
    const revision = guild.revision;
    const fields: Field[] =
      action === "TRANSFER_OWNER"
        ? [
            {
              name: "target_user_id",
              label: "Новый владелец",
              required: true,
              options: snapshot.members
                .filter((m) => m.user.id !== userID)
                .map((m) => ({ value: m.user.id, label: m.user.display_name })),
            },
          ]
        : [];
    setModal({
      title: action === "DELETE_GUILD" ? "Удаление сервера" : "Передача владения",
      text: "Это первый шаг. Потребуется отдельное подтверждение, действующее 60 секунд.",
      fields,
      submit: "Продолжить",
      danger: true,
      run: async (f) => {
        const proof = await api<GuildConfirmation>(
          `/guilds/${guild.id}/confirmations`,
          "POST",
          {
            action,
            ...(action === "TRANSFER_OWNER" ? { target_user_id: text(f, "target_user_id") } : {}),
          },
          { "If-Match": `"${revision}"` },
        );
        setTimeout(
          () =>
            setModal({
              title: "Подтвердите действие владельца",
              text:
                action === "DELETE_GUILD"
                  ? `Сервер «${guild.name}» станет недоступен всем участникам. Каналы будут архивированы, приглашения отозваны. История и аудит сохранятся.`
                  : "Вы потеряете особые права владельца. Вернуть их сможет только новый владелец.",
              submit: "Подтвердить окончательно",
              danger: true,
              run: async () => {
                await mutation(
                  `/guilds/${guild.id}${action === "TRANSFER_OWNER" ? "/ownership" : ""}`,
                  action === "TRANSFER_OWNER" ? "POST" : "DELETE",
                  { confirmation_id: proof.id, confirmation_token: proof.token },
                  proof.revision,
                );
                await refresh();
              },
            }),
          0,
        );
      },
    });
  }
  const manageGuild = guild && can(guild.permissions, "MANAGE_GUILD");
  const manageRoles = guild && can(guild.permissions, "MANAGE_ROLES");
  const sections = [
    ["channels", "Каналы"],
    ...(manageGuild ? [["settings", "Профиль сервера"]] : []),
    ["members", "Участники"],
    ["roles", "Роли"],
    ...(guild && can(guild.permissions, "KICK_MEMBER") ? [["moderation", "Модерация"]] : []),
    ...(snapshot?.channels.some((c) => can(c.permissions, "MANAGE_CHANNEL"))
      ? [["webhooks", "Интеграции"]]
      : []),
    ...(manageGuild
      ? [
          ["invites", "Приглашения"],
          ["audit", "Журнал аудита"],
        ]
      : []),
  ];
  function resourceTools(
    resource: GuildChannel | GuildCategory,
    kind: "channels" | "categories",
  ): ReactNode {
    return (
      can(resource.permissions, "MANAGE_CHANNEL") && (
        <span className="guild-resource-tools">
          <button
            onClick={() => resourceEditor(kind === "channels" ? "channel" : "category", resource)}
            aria-label={`Настроить ${resource.name}`}
          >
            Настроить
          </button>
          {manageRoles && (
            <button
              onClick={() => void overwrites(resource, kind)}
              aria-label={`Права ${resource.name}`}
            >
              Права
            </button>
          )}
          <button
            className="id-danger"
            onClick={() =>
              confirm(
                "Архивирование",
                kind === "categories"
                  ? "Категория будет архивирована. Все её каналы перейдут в корень и получат его права."
                  : "Канал станет недоступен. История сохранится, приглашения будут отозваны.",
                `/${kind}/${resource.id}`,
                "DELETE",
                kind === "categories" ? { detach_children: true } : undefined,
              )
            }
          >
            Архивировать
          </button>
        </span>
      )
    );
  }
  function channelActions(channel: GuildChannel) {
    return (
      <details
        className="channel-row-actions"
        onToggle={(e) => {
          const menu = e.currentTarget.querySelector<HTMLElement>(".channel-row-menu");
          if (!e.currentTarget.open || !menu) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const menuWidth = Math.min(248, Math.max(0, window.innerWidth - 16));
          menu.style.maxWidth = `${menuWidth}px`;
          const preferredLeft = rect.right + 8 + menuWidth <= window.innerWidth - 8
            ? rect.right + 8
            : rect.left - menuWidth - 8;
          menu.style.left = `${Math.max(8, Math.min(preferredLeft, window.innerWidth - menuWidth - 8))}px`;
          menu.style.top = `${Math.max(48, Math.min(rect.top, window.innerHeight - Math.min(menu.scrollHeight, 520) - 16))}px`;
        }}
      >
        <summary aria-label={`Действия канала ${channel.name}`} title="Действия канала">
          <Icon name="settings" size={16} />
        </summary>
        <div
          className="channel-row-menu"
          onClickCapture={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest("button") && !target.closest(".notification-rule, .channel-favorite-action"))
              event.currentTarget.closest<HTMLDetailsElement>("details.channel-row-actions")!.open = false;
          }}
        >
          {resourceTools(channel, "channels")}
          {can(channel.permissions, "CREATE_INVITE") && (
            <button onClick={() => createInvite(channel)}>Пригласить</button>
          )}
          <div className="channel-favorite-action">
            <FavoriteButton channelID={channel.id} />
            <span>Избранное</span>
          </div>
          <details className="channel-personal">
            <summary>Уведомления канала</summary>
            <NotificationRuleEditor
              key={channel.id}
              scope="channel"
              id={channel.id}
              label="Режим канала"
            />
          </details>
          <details className="channel-permission-details">
            <summary>Ваши разрешения</summary>
            <div className="guild-badges">
              {channel.permissions.map((p) => (
                <span key={p}>{permissionNames[p]}</span>
              ))}
            </div>
          </details>
        </div>
      </details>
    );
  }
  function channelPeople(id: string): VoicePresence[] {
    const present = voicePresence[id];
    if (present?.length) return present;
    if (call.state?.channelID !== id || !call.state.room) return [];
    return call.state.room.participants.map((person) => ({
      id: person.id,
      user_id: person.user_id,
      display_name: person.display_name,
      audio_active: call.state!.room!.publications.some(
        (publication) =>
          publication.participant_id === person.id &&
          publication.kind === "audio" &&
          publication.active,
      ),
      speaking: false,
    }));
  }
  return (
    <section
      className={`guild-app ${selected ? "has-guild" : "guild-lobby"}`}
      aria-label="Серверы и каналы"
      {...swipe}
    >
      {treeDrag.layer}
      {gateway && (
        <ServerGateway
          key={`${gateway}:${route.invite ?? ""}`}
          initialStep={gateway}
          invite={route.invite}
          onEnter={choose}
          onClose={() => {
            setGateway(null);
            if (route.serverAction || route.invite)
              navigate({ ...route, serverAction: undefined, invite: undefined }, true);
          }}
        />
      )}
      {inviteResult && (
        <InviteResultDialog result={inviteResult} onClose={() => setInviteResult(null)} />
      )}
      {(error || loadError) && (
        <p className="id-error" role="alert">
          {error || loadError}{" "}
          <button
            onClick={() =>
              void refresh()
                .then(() => setError(""))
                .catch(report)
            }
          >
            Повторить загрузку
          </button>
        </p>
      )}
      {notice && !error && !loadError && (
        <p className="id-notice" role="status">
          {notice} <button onClick={() => setNotice("")}>Скрыть</button>
        </p>
      )}
      {!selected && (
        <ServerHome
          guilds={guilds}
          loading={loading}
          onSelect={choose}
          onCreate={createGuild}
          onJoin={() => setGateway("join")}
        />
      )}
      <div className="guild-layout" hidden={!selected}>
        <div
          className={`guild-space view-${tab} ${membersOpen && selectedChannel?.kind !== "VOICE" ? "members-open" : ""} ${managementOpen ? "management-open" : ""}`}
        >
          {!snapshot ? (
            <div className="guild-empty">
              <span>#</span>
              <h2>
                {loading ? "Загружаем серверы…" : selected ? "Сервер недоступен" : "Ваши серверы"}
              </h2>
              <p>
                {loading
                  ? ""
                  : selected
                    ? "Проверьте приглашение или выберите другой сервер. Доступ мог быть отозван."
                    : ""}
              </p>
            </div>
          ) : (
            <>
              <header className="guild-heading">
                <button
                  className="guild-menu-toggle"
                  ref={guildMenuToggle}
                  aria-expanded={managementOpen}
                  aria-controls="guild-navigation"
                  onClick={() => setManagementOpen(!managementOpen)}
                >
                  <h2>{guild!.name}</h2>
                  <Icon name={managementOpen ? "close" : "down"} size={18} />
                </button>
              </header>
              <nav id="guild-navigation" className="guild-tabs" aria-label="Разделы сервера">
                {sections.map(([id, label]) => (
                  <button
                    key={id}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
                <details className="guild-notification-settings">
                  <summary>Уведомления сервера</summary>
                  <NotificationRuleEditor
                    key={guild!.id}
                    scope="guild"
                    id={guild!.id}
                    label="Режим сервера"
                  />
                </details>
              </nav>
              <GuildSettingsFrame
                active={tab !== "channels"}
                name={guild!.name}
                page={tab}
                sections={sections}
                onPage={setTab}
                onClose={() => setTab("channels")}
              >
                {["moderation", "webhooks", "audit"].includes(tab) &&
                  ((tab === "moderation" && can(guild!.permissions, "KICK_MEMBER")) ||
                  (tab === "webhooks" &&
                    snapshot.channels.some((c) => can(c.permissions, "MANAGE_CHANNEL"))) ||
                  (tab === "audit" && manageGuild) ? (
                    <CommunityGuild
                      key={`${guild!.id}:${tab}`}
                      guild={guild!}
                      members={snapshot.members}
                      channels={snapshot.channels}
                      panel={tab as "moderation" | "webhooks" | "audit"}
                      onChange={() => refresh()}
                    />
                  ) : (
                    <p role="alert" className="id-error">
                      Нет прав на этот раздел сервера.
                    </p>
                  ))}
                {tab === "channels" && (
                  <>
                    <button
                      className="mobile-channels"
                      aria-expanded={treeOpen}
                      aria-controls="channel-tree"
                      onClick={() => setTreeOpen(!treeOpen)}
                    >
                      {treeOpen ? "Скрыть каналы" : "Выбрать канал"}
                    </button>
                    <div className={`guild-channels ${treeOpen ? "tree-open" : ""}`}>
                      <aside
                        id="channel-tree"
                        aria-label="Дерево каналов"
                        aria-busy={ordering}
                        onClickCapture={(event) => {
                          if (treeDrag.suppressClick()) {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        }}
                        onDragStart={(event) => event.preventDefault()}
                      >
                        {can(guild!.permissions, "MANAGE_CHANNEL") && (
                          <div className="channel-create-tools">
                            <button onClick={() => resourceEditor("channel")}>
                              <Icon name="plus" size={16} />
                              Канал
                            </button>
                            <button onClick={() => resourceEditor("category")}>Категория</button>
                          </div>
                        )}
                        {[{ id: "", name: "КАНАЛЫ" }, ...sortResources(snapshot.categories)]
                          .filter(
                            (category) =>
                              category.id ||
                              snapshot.channels.some((c) => !c.category_id) ||
                              treeDrag.active?.kind === "channel",
                          )
                          .map((category) => (
                            <section
                              key={category.id}
                              className={`guild-category ${collapsedCategories.has(category.id) ? "is-collapsed" : ""} ${!category.id && !snapshot.channels.some((channel) => !channel.category_id) ? "is-empty-root-drop" : ""}`}
                              data-category-id={category.id}
                              data-dragging={
                                treeDrag.active?.kind === "category" &&
                                treeDrag.active.id === category.id
                                  ? "true"
                                  : undefined
                              }
                            >
                              <header>
                                <button
                                  className="category-toggle"
                                  data-order-kind="category"
                                  data-order-id={category.id}
                                  aria-keyshortcuts={
                                    treeDrag.enabled({ kind: "category", id: category.id })
                                      ? "Alt+ArrowUp Alt+ArrowDown"
                                      : undefined
                                  }
                                  onPointerDown={(event) =>
                                    treeDrag.start(event, { kind: "category", id: category.id })
                                  }
                                  onKeyDown={(event) =>
                                    treeDrag.keyboard(event, { kind: "category", id: category.id })
                                  }
                                  aria-expanded={!collapsedCategories.has(category.id)}
                                  onClick={() =>
                                    setCollapsedCategories((old) => {
                                      const next = new Set(old);
                                      if (next.has(category.id)) next.delete(category.id);
                                      else next.add(category.id);
                                      return next;
                                    })
                                  }
                                >
                                  <strong>
                                    {!category.id &&
                                    !snapshot.channels.some((channel) => !channel.category_id)
                                      ? "Без категории"
                                      : category.name}
                                  </strong>
                                  <Icon name="down" size={12} />
                                </button>
                                {treeDrag.enabled({ kind: "category", id: category.id }) && (
                                  <button
                                    className="tree-touch-drag"
                                    aria-label={`Переместить категорию ${category.name}`}
                                    onPointerDown={(event) =>
                                      treeDrag.start(
                                        event,
                                        { kind: "category", id: category.id },
                                        true,
                                      )
                                    }
                                    onKeyDown={(event) =>
                                      treeDrag.keyboard(event, {
                                        kind: "category",
                                        id: category.id,
                                      })
                                    }
                                  >
                                    <Icon name="more" size={16} />
                                  </button>
                                )}
                                {"permissions" in category &&
                                  can(category.permissions, "MANAGE_CHANNEL") && (
                                    <details className="category-tools">
                                      <summary aria-label={`Действия категории ${category.name}`}>
                                        <Icon name="more" size={16} />
                                      </summary>
                                      {resourceTools(category, "categories")}
                                    </details>
                                  )}
                              </header>
                              <div className="category-channel-list">
                                <div>
                                  {sortResources(snapshot.channels)
                                    .filter((c) => (c.category_id ?? "") === category.id)
                                    .map((c) => (
                                      <div
                                        className="channel-entry"
                                        key={c.id}
                                        data-dragging={
                                          treeDrag.active?.kind === "channel" &&
                                          treeDrag.active.id === c.id
                                            ? "true"
                                            : undefined
                                        }
                                      >
                                        <button
                                          className="guild-channel"
                                          data-order-kind="channel"
                                          data-order-id={c.id}
                                          aria-keyshortcuts={
                                            treeDrag.enabled({ kind: "channel", id: c.id })
                                              ? "Alt+ArrowUp Alt+ArrowDown"
                                              : undefined
                                          }
                                          onPointerDown={(event) =>
                                            treeDrag.start(event, { kind: "channel", id: c.id })
                                          }
                                          onKeyDown={(event) =>
                                            treeDrag.keyboard(event, { kind: "channel", id: c.id })
                                          }
                                          key={c.id}
                                          aria-current={channelID === c.id ? "page" : undefined}
                                          onClick={() => {
                                            navigate({
                                              tab: "guilds",
                                              guild: selected,
                                              room: c.id,
                                              kind: "channel",
                                            });
                                            setTreeOpen(false);
                                            setConnection("Подключение…");
                                          }}
                                        >
                                          <Icon
                                            name={
                                              c.kind === "VOICE"
                                                ? "speaker"
                                                : c.kind === "FORUM"
                                                  ? "thread"
                                                  : "hash"
                                            }
                                            size={20}
                                          />
                                          <span className="channel-name">{c.name}</span>
                                          {notifications.enabled && unread[c.id] > 0 && (
                                            <b
                                              className="unread-badge"
                                              aria-label={`${unread[c.id]} непрочитанных`}
                                            >
                                              {unread[c.id]}
                                            </b>
                                          )}
                                        </button>
                                        {treeDrag.enabled({ kind: "channel", id: c.id }) && (
                                          <button
                                            className="tree-touch-drag"
                                            aria-label={`Переместить канал ${c.name}`}
                                            onPointerDown={(event) =>
                                              treeDrag.start(
                                                event,
                                                { kind: "channel", id: c.id },
                                                true,
                                              )
                                            }
                                            onKeyDown={(event) =>
                                              treeDrag.keyboard(event, {
                                                kind: "channel",
                                                id: c.id,
                                              })
                                            }
                                          >
                                            <Icon name="more" size={16} />
                                          </button>
                                        )}
                                        {channelActions(c)}
                                        {c.kind === "VOICE" && channelPeople(c.id).length > 0 && (
                                          <div className="voice-channel-people">
                                            {channelPeople(c.id).map((p) => (
                                              <div
                                                key={p.id}
                                                className={p.speaking ? "is-speaking" : undefined}
                                                aria-label={`${p.display_name}${p.speaking ? ", говорит" : ""}`}
                                              >
                                                <span>{Array.from(p.display_name)[0]}</span>
                                                <strong>{p.display_name}</strong>
                                                {!p.audio_active && (
                                                  <span className="slashed">
                                                    <Icon name="mic" size={13} />
                                                  </span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </section>
                          ))}
                        {orderMessage && (
                          <div
                            className="tree-order-status"
                            role={orderFailed ? "alert" : "status"}
                          >
                            <span>{orderMessage}</span>
                            {orderFailed && (
                              <button
                                aria-label="Закрыть уведомление"
                                onClick={() => setOrderMessage("")}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </aside>
                      <article
                        className={`guild-channel-detail ${selectedChannel?.kind === "VOICE" ? "is-voice-room" : ""}`}
                      >
                        {selectedChannel ? (
                          <>
                            {connection === "Доступ отозван" && (
                              <p className="id-error" role="alert">
                                {connection}
                              </p>
                            )}
                            <div className="channel-top-actions">
                              <button
                                aria-label="Участники канала"
                                title="Участники канала"
                                aria-pressed={membersOpen}
                                onClick={() => {
                                  if (route.search)
                                    navigate({ ...route, search: undefined, q: undefined });
                                  setMembersOpen(route.search || !membersOpen);
                                }}
                              >
                                <Icon name="users" size={24} />
                              </button>
                            </div>
                            {selectedChannel.kind === "VOICE" ? (
                              <VoiceRoom
                                id={selectedChannel.id}
                                name={selectedChannel.name}
                                canJoin={can(selectedChannel.permissions, "CONNECT_VOICE")}
                                canRead={can(selectedChannel.permissions, "READ_HISTORY")}
                                onInvite={
                                  can(selectedChannel.permissions, "CREATE_INVITE")
                                    ? () => createInvite(selectedChannel)
                                    : undefined
                                }
                                userID={userID}
                                avatars={Object.fromEntries(
                                  snapshot.members.map((m) => [m.user.id, m.user.avatar]),
                                )}
                              />
                            ) : (
                              <ChatWindow
                                key={selectedChannel.id}
                                roomID={selectedChannel.id}
                                roomKind="channel"
                                userID={userID}
                                title={selectedChannel.name}
                                avatars={Object.fromEntries(
                                  snapshot.members.map((m) => [m.user.id, m.user.avatar]),
                                )}
                              />
                            )}
                          </>
                        ) : (
                          <div className="guild-empty">
                            <span>#</span>
                            <h3>{channelID ? "Канал недоступен" : "Выберите канал"}</h3>
                          </div>
                        )}
                      </article>
                      {route.search && selectedChannel?.kind !== "VOICE" && (
                        <SearchApp key={guild!.id} embedded />
                      )}
                      {!route.search && membersOpen && selectedChannel?.kind !== "VOICE" && (
                        <aside className="member-list" aria-label="Участники сервера">
                          <h3>Участники — {snapshot.members.length}</h3>
                          {snapshot.members.map((member) => (
                            <div className="member-row" key={member.user.id}>
                              <span className={`id-avatar ${member.user.avatar}`}>
                                {Array.from(member.user.display_name)[0]?.toUpperCase()}
                              </span>
                              <div>
                                <strong>{member.user.display_name}</strong>
                                <small>
                                  {member.user.id === guild!.owner_id
                                    ? "Владелец"
                                    : `@${member.user.login}`}
                                </small>
                              </div>
                            </div>
                          ))}
                        </aside>
                      )}
                    </div>
                  </>
                )}
                {tab === "members" && (
                  <div className="guild-rows">
                    <h3>Участники</h3>
                    <label className="community-member-search">
                      Найти участника сервера
                      <input
                        value={memberQuery}
                        maxLength={80}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        placeholder="Имя или логин"
                      />
                    </label>
                    {snapshot.members
                      .filter((m) =>
                        `${m.user.display_name} ${m.user.login}`
                          .toLowerCase()
                          .includes(memberQuery.toLowerCase()),
                      )
                      .map((m) => (
                        <article key={m.user.id}>
                          <div>
                            <strong>{m.user.display_name}</strong>
                            <small>
                              @{m.user.login}
                              {m.user.id === guild!.owner_id ? " · Владелец" : ""}
                            </small>
                            <small>
                              {snapshot.roles
                                .filter((r) => r.is_default || m.role_ids.includes(r.id))
                                .map((r) => r.name)
                                .join(" · ")}
                            </small>
                          </div>
                          <div className="guild-toolbar">
                            {m.can_manage && manageRoles && (
                              <button onClick={() => assign(m)}>Назначить / снять роль</button>
                            )}
                            {m.can_manage && can(guild!.permissions, "KICK_MEMBER") && (
                              <button className="id-danger" onClick={() => setTab("moderation")}>
                                Модерировать
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                )}
                {tab === "roles" && modal?.variant === "role-edit" && (
                  <ModalForm
                    modal={modal}
                    inline
                    closeGuard={roleCloseGuard}
                    onClose={() => setModal(null)}
                  />
                )}
                {tab === "roles" && modal?.variant !== "role-edit" && (
                  <>
                    <div className="guild-toolbar">
                      {manageRoles && snapshot.roles.some((r) => !r.is_default) && (
                        <button onClick={() => roleEditor()}>+ Роль</button>
                      )}
                    </div>
                    <div className="guild-rows guild-role-list">
                      <h3>Роли</h3>
                      {manageRoles && snapshot.roles.some((r) => !r.is_default) && (
                        <p className="guild-role-order-hint">Перетащите роль за ручку, чтобы изменить порядок.</p>
                      )}
                      {roleOrderStatus && <p className="guild-role-order-status" role="status">{roleOrderStatus}</p>}
                      {!snapshot.roles.some((r) => !r.is_default) && (
                        <div className="guild-roles-empty">
                          <div className="role-art" aria-hidden="true">
                            <div>
                              <span>Д</span>
                              <b>Друзья</b>
                              <small>Участник</small>
                              <small>На связи</small>
                            </div>
                            <div>
                              <span>М</span>
                              <b>Команда</b>
                              <small>Модератор</small>
                              <small>Организатор</small>
                            </div>
                          </div>
                          <h4>Организуйте своих участников</h4>
                          <p>
                            Используйте роли для создания групп с участниками сервера и настройки их
                            прав.
                          </p>
                          {manageRoles && (
                            <button className="id-primary" onClick={() => roleEditor()}>
                              Создание роли
                            </button>
                          )}
                        </div>
                      )}
                      {[...snapshot.roles].sort((a, b) =>
                        a.is_default ? 1 : b.is_default ? -1 : b.position - a.position,
                      ).map((r) =>
                        r.is_default ? (
                          <button
                            key={r.id}
                            className="guild-default-role"
                            disabled={!r.can_edit}
                            onClick={() => roleEditor(r)}
                          >
                            <Icon name="users" size={22} />
                            <span>
                              <strong>Права по умолчанию</strong>
                              <small>@everyone · распространяется на всех участников сервера</small>
                            </span>
                            <Icon name="arrow" size={18} />
                          </button>
                        ) : (
                          <article
                            key={r.id}
                            className="guild-role-row"
                            data-role-id={r.id}
                            data-drop={roleDrop?.id === r.id ? (roleDrop.after ? "after" : "before") : undefined}
                            data-dragging={draggedRole === r.id || undefined}
                            onDragOver={(event) => {
                              if (!draggedRole || roleOrderBusy || draggedRole === r.id) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              const rect = event.currentTarget.getBoundingClientRect();
                              setRoleDrop({ id: r.id, after: event.clientY > rect.top + rect.height / 2 });
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRoleDrop(null);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const source = draggedRole;
                              const rect = event.currentTarget.getBoundingClientRect();
                              setDraggedRole(null);
                              setRoleDrop(null);
                              if (source) void moveRole(source, r.id, event.clientY > rect.top + rect.height / 2);
                            }}
                          >
                            {manageRoles && r.can_edit && (
                              <span
                                className="guild-role-grip"
                                role="button"
                                tabIndex={0}
                                draggable={!roleOrderBusy}
                                aria-label={`Изменить порядок роли ${r.name}`}
                                title="Перетащить роль"
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", r.id);
                                  setDraggedRole(r.id);
                                  setRoleOrderStatus("");
                                }}
                                onDragEnd={() => { setDraggedRole(null); setRoleDrop(null); }}
                                onPointerDown={(event) => {
                                  if (event.pointerType !== "touch" || roleOrderBusyRef.current) return;
                                  event.currentTarget.setPointerCapture(event.pointerId);
                                  touchRole.current = {
                                    pointer: event.pointerId,
                                    source: r.id,
                                    guild: selected,
                                    startX: event.clientX,
                                    startY: event.clientY,
                                    active: false,
                                    target: null,
                                  };
                                }}
                                onPointerMove={moveTouchRole}
                                onPointerUp={endTouchRole}
                                onPointerCancel={cancelTouchRole}
                                onLostPointerCapture={cancelTouchRole}
                                onKeyDown={(event) => {
                                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                                  event.preventDefault();
                                  const roles = [...snapshot.roles]
                                    .filter((role) => !role.is_default)
                                    .sort((a, b) => b.position - a.position);
                                  const index = roles.findIndex((role) => role.id === r.id);
                                  const neighbor = roles[index + (event.key === "ArrowUp" ? -1 : 1)];
                                  if (neighbor) void moveRole(r.id, neighbor.id, event.key === "ArrowDown");
                                }}
                              >
                                <Icon name="grip" size={20} />
                              </span>
                            )}
                            <div>
                              <strong>{r.name}</strong>
                              <small>
                                Участников:{" "}
                                {snapshot.members.filter((m) => m.role_ids.includes(r.id)).length}
                              </small>
                            </div>
                            {r.can_edit && (
                              <div className="guild-toolbar">
                                <button onClick={() => roleEditor(r)}>Изменить роль</button>
                                {!r.is_default && (
                                  <button
                                    className="id-danger"
                                    onClick={() =>
                                      confirm(
                                        "Удалить роль",
                                        `Роль «${r.name}» и её назначения / переопределения будут удалены. Права пересчитаются.`,
                                        `/guilds/${guild!.id}/roles/${r.id}`,
                                      )
                                    }
                                  >
                                    Удалить
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        ),
                      )}
                    </div>
                  </>
                )}
                {tab === "invites" && manageGuild && (
                  <div className="guild-rows">
                    <h3>Приглашения</h3>
                    {invites.length === 0 && <p>Активных приглашений нет</p>}
                    {invites.map((i) => (
                      <article key={i.id}>
                        <div>
                          <strong>
                            {snapshot.channels.find((c) => c.id === i.channel_id)?.name ??
                              "Канал недоступен"}
                          </strong>
                          <small>
                            {i.uses} / {i.max_uses} использований · до{" "}
                            {new Date(i.expires_at).toLocaleString("ru-RU")}
                          </small>
                          <small>{i.revoked ? "Отозвано" : "Создано"}</small>
                        </div>
                        {!i.revoked && (
                          <button
                            className="id-danger"
                            onClick={() =>
                              confirm(
                                "Отозвать приглашение",
                                "Новые участники не смогут войти по этой ссылке.",
                                `/invites/${i.id}`,
                              )
                            }
                          >
                            Отозвать
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {tab === "settings" && manageGuild && (
                  <div className="guild-settings">
                    <GuildProfileEditor
                      key={guild!.id}
                      guild={guild!}
                      memberCount={snapshot.members.length}
                      onSave={async (body, revision) => {
                        await mutation(`/guilds/${guild!.id}`, "PATCH", body, revision);
                        await refresh();
                        window.dispatchEvent(new Event("svyaz:guilds-changed"));
                      }}
                      onReload={async () => {
                        const fresh = await api<GuildInfo>(`/guilds/${guild!.id}`);
                        await refresh();
                        return fresh;
                      }}
                    />
                    {guild!.owner_id === userID && (
                      <div className="guild-danger-zone">
                        <h3>Действия владельца</h3>
                        <div className="guild-toolbar">
                          <button
                            disabled={snapshot.members.length < 2}
                            onClick={() => dangerous("TRANSFER_OWNER")}
                          >
                            Передать владение
                          </button>
                          <button className="id-danger" onClick={() => dangerous("DELETE_GUILD")}>
                            Удалить сервер
                          </button>
                        </div>
                      </div>
                    )}
                    <button onClick={() => setTab("audit")}>Открыть журнал действий</button>
                  </div>
                )}
                {guild!.owner_id !== userID && (
                  <footer className="guild-leave">
                    <button
                      className="id-danger"
                      onClick={() =>
                        confirm(
                          "Покинуть сервер",
                          `Выйти из «${guild!.name}»? Назначенные роли будут сняты.`,
                          `/guilds/${guild!.id}/members/${userID}`,
                        )
                      }
                    >
                      Покинуть сервер
                    </button>
                  </footer>
                )}
              </GuildSettingsFrame>
            </>
          )}
        </div>
      </div>
      {modal && modal.variant !== "role-edit" && (
        <ModalForm
          key={modal.resourceSettings?.key ?? modal.title}
          modal={modal}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}
