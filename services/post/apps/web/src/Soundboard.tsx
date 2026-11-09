import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import "./soundboard.css";

export type SoundClip = {
  id: string;
  name: string;
  emoji: string;
  channel_id: string;
  channel_name: string;
  builtin?: boolean;
};

export function Soundboard({
  clips,
  channelID,
  open,
  loading,
  busy,
  canUpload,
  volume,
  onVolume,
  onClose,
  onPlay,
  onUpload,
}: {
  clips: SoundClip[];
  channelID: string;
  open: boolean;
  loading: boolean;
  busy: boolean;
  canUpload: boolean;
  volume: number;
  onVolume: (value: number) => void;
  onClose: () => void;
  onPlay: (clip: SoundClip) => void;
  onUpload: (file: File, name: string, emoji: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔊");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) {
      setSearch("");
      setUploading(false);
      setFile(null);
      setError("");
      return;
    }
    input.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (event.target instanceof Element && event.target.closest(".voice-soundboard-trigger"))
        return;
      if (!panel.current?.contains(event.target)) close.current();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  if (!open) return null;
  const matches = clips.filter((clip) =>
    `${clip.name} ${clip.channel_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const groups = new Map<string, SoundClip[]>();
  for (const clip of matches) {
    const key = clip.builtin ? "Готовые звуки" : clip.channel_id === channelID ? "Этот канал" : clip.channel_name;
    groups.set(key, [...(groups.get(key) ?? []), clip]);
  }
  return (
    <div
      ref={panel}
      className="soundboard-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Звуковая панель"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="soundboard-top">
        <label className="soundboard-search">
          <Icon name="search" size={18} />
          <input
            ref={input}
            type="search"
            placeholder="Найдите идеальный звук"
            aria-label="Поиск звука"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="soundboard-volume" title={`Громкость ${volume}%`}>
          <Icon name="volume" size={20} />
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            aria-label="Громкость звуковой панели"
            onChange={(event) => onVolume(Number(event.target.value))}
          />
        </label>
      </div>
      {uploading ? (
        <form
          className="soundboard-upload"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file || !name.trim() || busy) return;
            setError("");
            void onUpload(file, name.trim(), emoji.trim() || "🔊")
              .then(() => {
                setUploading(false);
                setName("");
                setFile(null);
              })
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : "Не удалось загрузить звук."),
              );
          }}
        >
          <div className="soundboard-upload-title">
            <strong>Добавить звук</strong>
            <button type="button" aria-label="Назад к звукам" onClick={() => setUploading(false)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <label>
            Аудиофайл
            <input
              type="file"
              accept="audio/wav,audio/x-wav,audio/ogg,.wav,.ogg"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="soundboard-upload-fields">
            <label>
              Значок
              <input
                value={emoji}
                maxLength={8}
                onChange={(event) => setEmoji(event.target.value)}
              />
            </label>
            <label>
              Название
              <input
                value={name}
                maxLength={40}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <p className="soundboard-hint">WAV или OGG, до 10 секунд и 2 МиБ.</p>
          {error && (
            <p className="soundboard-error" role="alert">
              {error}
            </p>
          )}
          <button className="soundboard-submit" disabled={busy || !file || !name.trim()}>
            {busy ? "Загрузка…" : "Добавить звук"}
          </button>
        </form>
      ) : (
        <div className="soundboard-scroll">
          {loading && <p className="soundboard-empty">Загружаем звуки…</p>}
          {!loading && !matches.length && (
            <p className="soundboard-empty">
              {search ? "Звуки не найдены" : "В этом канале пока нет звуков"}
            </p>
          )}
          {[...groups].map(([group, sounds]) => (
            <section className="soundboard-group" key={group}>
              <h3>{group}</h3>
              <div className="soundboard-grid">
                {sounds.map((clip) => (
                  <button
                    className="soundboard-tile"
                    key={clip.id}
                    type="button"
                    title={clip.name}
                    aria-label={`Воспроизвести: ${clip.name}`}
                    disabled={busy}
                    onClick={() => onPlay(clip)}
                  >
                    <span aria-hidden="true">{clip.emoji}</span>
                    <span>{clip.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!search && (
            <>
              <button
                className="soundboard-add"
                type="button"
                disabled={!canUpload}
                title={canUpload ? "Добавить звук" : "Нет права загружать звуки в этот канал"}
                onClick={() => setUploading(true)}
              >
                <Icon name="plus" size={18} />
                Добавить звук
              </button>
              {!canUpload && (
                <p className="soundboard-hint">Нет права загружать звуки в этот канал.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
