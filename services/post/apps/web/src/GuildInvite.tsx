import { useId, useState } from "react";
import { Modal } from "./AppUI";
import { Icon } from "./Icons";
import { SelectField } from "./SelectField";

const durationOptions = [
  { value: 1800, label: "30 минут" },
  { value: 3600, label: "1 час" },
  { value: 21600, label: "6 часов" },
  { value: 43200, label: "12 часов" },
  { value: 86400, label: "1 день" },
  { value: 604800, label: "7 дней" },
];
const useOptions = [1, 5, 10, 25, 50, 100].map((value) => ({
  value,
  label: `${value} раз`,
}));

export function InviteOptionField({
  name,
  label,
  value,
}: {
  name: "ttl_seconds" | "max_uses";
  label: string;
  value: number;
}) {
  const id = useId();
  const duration = name === "ttl_seconds";
  const options = duration ? durationOptions : useOptions;
  const [selected, setSelected] = useState(
    options.some((option) => option.value === value) ? String(value) : "custom",
  );
  const [custom, setCustom] = useState(String(value));
  const isCustom = selected === "custom";
  return (
    <div className="guild-invite-option">
      <label className="guild-dialog-field" htmlFor={id}>
        {label}
        <SelectField
          id={id}
          label={label}
          value={selected}
          onChange={setSelected}
          options={[
            ...options.map((option) => ({ ...option, value: String(option.value) })),
            { value: "custom", label: "Другое…" },
          ]}
        />
      </label>
      {isCustom && (
        <label className="guild-dialog-field guild-invite-custom" htmlFor={`${id}-custom`}>
          {duration ? "Срок действия, в секундах" : "Количество использований"}
          <input
            id={`${id}-custom`}
            type="number"
            required
            min={duration ? 60 : 1}
            max={duration ? 604800 : 1000}
            step={1}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
        </label>
      )}
      <input type="hidden" name={name} value={isCustom ? custom : selected} />
    </div>
  );
}

export type InviteResult = {
  link: string;
  guildName: string;
  channelName: string;
  voice: boolean;
  expiresAt: string;
  maxUses: number;
};

export function InviteResultDialog({
  result,
  onClose,
}: {
  result: InviteResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const expires = new Date(result.expiresAt).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      setError("Не удалось скопировать ссылку. Выделите её и скопируйте вручную.");
    }
  }
  return (
    <Modal
      className="guild-invite-result"
      title={`Пригласить друзей в ${result.guildName}`}
      onClose={onClose}
    >
      <p className="guild-invite-destination">
        Участники окажутся в <Icon name={result.voice ? "speaker" : "hash"} size={16} />
        <strong>{result.channelName}</strong>
      </p>
      <div className="guild-invite-share">
        <label htmlFor={id}>Отправьте другу ссылку-приглашение на сервер</label>
        <div className="guild-invite-link-field">
          <input id={id} readOnly value={result.link} onFocus={(event) => event.target.select()} />
          <button type="button" className="id-primary" onClick={() => void copy()}>
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
        <p className="guild-invite-expiry">
          Ваша ссылка-приглашение действует до {expires}. Максимум использований: {result.maxUses}.
        </p>
        {copied && (
          <span className="id-sr" role="status">
            Ссылка скопирована.
          </span>
        )}
        {error && (
          <p className="id-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
