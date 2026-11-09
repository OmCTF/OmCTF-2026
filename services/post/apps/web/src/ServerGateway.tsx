import { useRef, useState, type FormEvent } from "react";
import type {
  GuildInfo,
  InviteAccepted,
  InvitePreview,
} from "../../../packages/contracts/generated/ts/models";
import { api, NetworkError } from "./identity-api";
import { requestID } from "./request-id";
import { inviteCodeFromInput } from "./guild-api";
import { Modal } from "./AppUI";
import { BrandMark, EmptyArt } from "./Brand";
import { Icon } from "./Icons";

export type ServerStep = "choose" | "create" | "join";
const colors = {
  violet: "Лавандовый",
  mint: "Мятный",
  amber: "Янтарный",
  rose: "Розовый",
  sky: "Голубой",
};
export function ServerGateway({
  initialStep,
  invite = "",
  onClose,
  onEnter,
}: {
  initialStep: ServerStep;
  invite?: string;
  onClose: () => void;
  onEnter: (id: string) => void;
}) {
  const [step, setStep] = useState(initialStep),
    [name, setName] = useState(""),
    [icon, setIcon] = useState("violet"),
    [code, setCode] = useState(invite);
  const [preview, setPreview] = useState<InvitePreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const running = useRef(false),
    attempt = useRef({ code: "", key: "" });
  const change = (next: ServerStep) => {
    setStep(next);
    setError("");
    setPreview(null);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || uncertain) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (step === "create") {
        const guild = await api<GuildInfo>("/guilds", "POST", {
          name: name.trim(),
          description: "",
          icon,
        });
        window.dispatchEvent(new Event("svyaz:guilds-changed"));
        onEnter(guild.id);
      } else {
        const normalized = inviteCodeFromInput(code);
        if (!preview) {
          setPreview(await api<InvitePreview>(`/invite-preview/${encodeURIComponent(normalized)}`));
          setCode(normalized);
        } else {
          if (attempt.current.code !== normalized)
            attempt.current = { code: normalized, key: requestID() };
          const joined = await api<InviteAccepted>(
            `/invites/${encodeURIComponent(normalized)}/accept`,
            "POST",
            undefined,
            { "Idempotency-Key": attempt.current.key },
          );
          window.dispatchEvent(new Event("svyaz:guilds-changed"));
          onEnter(joined.guild_id);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие.");
      if (step === "create" && e instanceof NetworkError && e.uncertain) setUncertain(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        step === "choose"
          ? "Создайте свой сервер"
          : step === "create"
            ? "Персонализируйте свой сервер"
            : "Присоединиться к серверу"
      }
      onClose={onClose}
      dismissible={!busy}
      className={`server-gateway gateway-${step}${preview ? " gateway-preview" : ""}`}
    >
      {!preview && (
        <p className="gateway-description">
          {step === "choose"
            ? "Ваш сервер — это место, где вы можете общаться со своими друзьями. Создайте сервер и начните общаться."
            : step === "create"
              ? "Персонализируйте свой новый сервер, выбрав ему название и значок. Их можно будет изменить в любой момент."
              : "Введите приглашение, чтобы присоединиться к существующему серверу."}
        </p>
      )}
      {step === "choose" ? (
        <>
          <button className="gateway-choice" onClick={() => change("create")}>
            <span className="gateway-choice-icon">
              <BrandMark size={30} />
            </span>
            <strong>Свой сервер</strong>
            <Icon name="arrow" />
          </button>
          <div className="gateway-join-footer">
            <h3>У вас уже есть приглашение?</h3>
            <button onClick={() => change("join")}>Присоединиться к серверу</button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          {step === "create" ? (
            <>
              <details
                className={`gateway-palette ${icon}`}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && e.currentTarget.open) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.open = false;
                    e.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label="Изменить цвет значка сервера">
                  <span className="gateway-icon-preview">
                    <BrandMark size={24} />
                  </span>
                  <small>Значок</small>
                  <span className="gateway-icon-plus">
                    <Icon name="plus" size={16} />
                  </span>
                </summary>
                <div className="gateway-colors" role="group" aria-label="Цвет сервера">
                  {Object.entries(colors).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={value}
                      aria-label={label}
                      aria-pressed={icon === value}
                      disabled={busy}
                      onClick={(e) => {
                        setIcon(value);
                        const palette = e.currentTarget.closest("details");
                        if (palette) palette.open = false;
                      }}
                    >
                      {icon === value && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              </details>
              <label>
                Название сервера{" "}
                <span className="gateway-required" aria-hidden="true">
                  *
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  disabled={busy}
                  placeholder="Сервер друзей"
                />
              </label>
              <p className="gateway-caption">
                Название и значок можно изменить в настройках сервера.
              </p>
            </>
          ) : preview ? (
            <div className="gateway-invite-preview">
              <span className={`gateway-server-icon ${preview.icon}`}>
                {Array.from(preview.name)[0]?.toUpperCase()}
              </span>
              <h3>{preview.name}</h3>
            </div>
          ) : (
            <>
              <label>
                Ссылка-приглашение{" "}
                <span className="gateway-required" aria-hidden="true">
                  *
                </span>
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setPreview(null);
                  }}
                  maxLength={500}
                  required
                  disabled={busy}
                  placeholder="Ссылка или код приглашения"
                />
              </label>
              <div className="gateway-invite-formats">
                <p>Приглашения должны выглядеть так:</p>
                <div>
                  <code>AbCd123</code>
                  <code>/#invite=AbCd123</code>
                  <code>{location.origin}/#invite=AbCd123</code>
                </div>
              </div>
              <button
                className="gateway-create-instead"
                type="button"
                onClick={() => change("create")}
                disabled={busy}
              >
                <span>
                  <BrandMark size={24} />
                </span>
                <span>
                  <strong>Нет приглашения?</strong>
                  <small>Создайте свой сервер и пригласите друзей.</small>
                </span>
                <Icon name="arrow" size={20} />
              </button>
            </>
          )}
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <p className="id-error" role="status">
              Ответ не получен. Проверьте список серверов перед повторной попыткой.
            </p>
          )}
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => (preview ? setPreview(null) : change("choose"))}
            >
              Назад
            </button>
            <button
              className="id-primary"
              disabled={
                busy ||
                uncertain ||
                (step === "create" && !name.trim()) ||
                (step === "join" && !code.trim())
              }
            >
              {busy
                ? "Подождите…"
                : step === "create"
                  ? "Создать"
                  : preview
                    ? "Присоединиться"
                    : "Продолжить"}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

export function ServerHome({
  guilds,
  loading,
  onSelect,
  onCreate,
  onJoin,
}: {
  guilds: GuildInfo[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="server-home">
      <header className="server-home-heading">
        <Icon name="users" />
        <h1>Серверы</h1>
      </header>
      <div className="server-home-content">
        <div className="server-home-intro">
          <span className="server-home-mark">
            <BrandMark size={44} />
          </span>
          <div>
            <h2>Ваши серверы</h2>
            <p>Одно место для всех ваших сообществ.</p>
          </div>
        </div>
        {guilds.length > 0 && (
          <nav className="server-home-list" aria-label="Список серверов">
            {guilds.map((g) => (
              <button key={g.id} onClick={() => onSelect(g.id)}>
                <span className={`server-home-avatar ${g.icon}`}>
                  {Array.from(g.name)[0]?.toUpperCase()}
                </span>
                <span>
                  <strong>{g.name}</strong>
                  {g.description && <small>{g.description}</small>}
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </nav>
        )}
        {loading && (
          <p className="server-home-loading" role="status">
            Загрузка серверов…
          </p>
        )}
        {!loading && !guilds.length && (
          <div className="server-home-empty">
            <EmptyArt kind="friends" />
          </div>
        )}
        <div className="server-home-actions">
          <button onClick={onCreate}>
            <span className="home-action-icon">
              <Icon name="plus" size={26} />
            </span>
            <strong>Создать сервер</strong>
            <small>Для друзей или сообщества</small>
            <Icon name="arrow" />
          </button>
          <button onClick={onJoin}>
            <span className="home-action-icon join">
              <Icon name="users" size={26} />
            </span>
            <strong>Присоединиться</strong>
            <small>По ссылке-приглашению</small>
            <Icon name="arrow" />
          </button>
        </div>
      </div>
    </div>
  );
}
