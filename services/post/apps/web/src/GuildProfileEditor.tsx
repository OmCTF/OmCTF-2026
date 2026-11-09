import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GuildInfo, GuildPatch } from "../../../packages/contracts/generated/ts/models";
import { ApiError, NetworkError } from "./identity-api";
import { Icon } from "./Icons";

const iconColors: Record<GuildInfo["icon"], string> = {
  violet: "Лавандовый",
  mint: "Мятный",
  amber: "Янтарный",
  rose: "Розовый",
  sky: "Голубой",
};

export function GuildProfileEditor({
  guild,
  memberCount,
  onSave,
  onReload,
}: {
  guild: GuildInfo;
  memberCount?: number;
  onSave: (body: GuildPatch, revision: number) => Promise<void>;
  onReload: () => Promise<GuildInfo>;
}) {
  const [base, setBase] = useState(guild);
  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description);
  const [icon, setIcon] = useState(guild.icon);
  const [invitesEnabled, setInvitesEnabled] = useState(guild.invites_enabled);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const running = useRef(false);
  const dirty =
    name !== base.name ||
    description !== base.description ||
    icon !== base.icon ||
    invitesEnabled !== base.invites_enabled;

  function apply(value: GuildInfo) {
    setBase(value);
    setName(value.name);
    setDescription(value.description);
    setIcon(value.icon);
    setInvitesEnabled(value.invites_enabled);
  }

  useEffect(() => {
    if (guild.id !== base.id || (!dirty && !busy && !blocked && guild.revision > base.revision)) {
      apply(guild);
      setError("");
      setBlocked(false);
      setSaved(false);
    }
  }, [guild.id, guild.revision, base.id, base.revision, dirty, busy, blocked]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current || blocked || !dirty || !name.trim()) return;
    running.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    const next = { name: name.trim(), description, icon, invites_enabled: invitesEnabled };
    try {
      await onSave(next, base.revision);
      apply({ ...base, ...next });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить изменения.");
      if ((e instanceof NetworkError && e.uncertain) || (e instanceof ApiError && e.status === 409))
        setBlocked(true);
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  async function reload() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      apply(await onReload());
      setBlocked(false);
      setError("");
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить настройки.");
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  const memberLabel =
    memberCount === undefined
      ? ""
      : `${memberCount} ${{ one: "участник", few: "участника", many: "участников", other: "участника", zero: "участников", two: "участника" }[new Intl.PluralRules("ru-RU").select(memberCount)]}`;
  return (
    <section className="guild-profile-editor">
      <div className="guild-profile-columns">
        <form onSubmit={(event) => void submit(event)}>
          <h2>Профиль сервера</h2>
          <p className="guild-profile-intro">
            Выберите имя и значок, по которым участники узнают ваш сервер. Добавьте описание, чтобы
            рассказать о сообществе и его интересах.
          </p>
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          {blocked && (
            <div className="guild-profile-reload" role="status">
              <p>
                Данные могли измениться. Загрузите актуальную версию перед повторным сохранением.
              </p>
              <button type="button" disabled={busy} onClick={() => void reload()}>
                Загрузить актуальную версию
              </button>
            </div>
          )}
          <fieldset disabled={busy || blocked}>
            <div className="guild-profile-section">
              <label htmlFor="guild-profile-name">Имя</label>
              <input
                id="guild-profile-name"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                maxLength={100}
                required
              />
            </div>
            <div className="guild-profile-section">
              <h3>Значок</h3>
              <div className="guild-profile-icon-row">
                <span className={`guild-profile-icon ${icon}`}>
                  {Array.from(name.trim() || guild.name)[0]?.toUpperCase()}
                </span>
                <div className="guild-profile-colors" role="group" aria-label="Цвет значка сервера">
                  {(Object.entries(iconColors) as [GuildInfo["icon"], string][]).map(
                    ([color, label]) => (
                      <button
                        type="button"
                        key={color}
                        className={color}
                        aria-label={label}
                        aria-pressed={icon === color}
                        onClick={() => {
                          setIcon(color);
                          setSaved(false);
                        }}
                      >
                        {icon === color && <Icon name="check" size={18} />}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="guild-profile-section">
              <label htmlFor="guild-profile-description">Описание</label>
              <textarea
                id="guild-profile-description"
                name="description"
                rows={4}
                maxLength={1024}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaved(false);
                }}
              />
            </div>
            <div className="guild-profile-section">
              <label className="guild-profile-toggle">
                <span>Приглашения на сервер</span>
                <input
                  type="checkbox"
                  role="switch"
                  name="invites_enabled"
                  checked={invitesEnabled}
                  onChange={(event) => {
                    setInvitesEnabled(event.target.checked);
                    setSaved(false);
                  }}
                />
              </label>
            </div>
            {dirty && (
              <div className="guild-profile-save">
                <span>Есть несохранённые изменения</span>
                <button
                  type="button"
                  onClick={() => {
                    apply(base);
                    setError("");
                  }}
                >
                  Сбросить
                </button>
                <button className="id-primary" disabled={!name.trim()}>
                  Сохранить изменения
                </button>
              </div>
            )}
            {saved && (
              <p className="guild-profile-saved" role="status">
                Изменения сохранены
              </p>
            )}
          </fieldset>
        </form>
        <aside className="guild-profile-card" aria-label="Предпросмотр профиля сервера">
          <div className={`guild-profile-banner ${icon}`} />
          <span className={`guild-profile-icon ${icon}`}>
            {Array.from(name.trim() || guild.name)[0]?.toUpperCase()}
          </span>
          <div className="guild-profile-card-info">
            <h3>{name.trim() || guild.name}</h3>
            {memberLabel && <span>{memberLabel}</span>}
            <span>
              Дата основания:{" "}
              {new Date(guild.created_at).toLocaleDateString("ru-RU", {
                month: "short",
                year: "numeric",
              })}
            </span>
            {description && <p>{description}</p>}
          </div>
        </aside>
      </div>
    </section>
  );
}
