import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MessageFile, UploadStatus } from "../../../packages/contracts/generated/ts/models";
import { api, ApiError, session } from "./identity-api";
import { requestID } from "./request-id";
import "./media-search.css";
import { Icon } from "./Icons";
import { Modal } from "./AppUI";

export type DraftFile = {
  key: string;
  file: File;
  upload?: UploadStatus;
  progress: number;
  error?: string;
};
const explain = (e: unknown) => (e instanceof Error ? e.message : "Не удалось загрузить файл.");
export const fileSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.ceil(n / 1024))} КБ`;
export function UploadPicker({
  context,
  disabled,
  files,
  setFiles,
}: {
  context: string;
  disabled: boolean;
  files: DraftFile[];
  setFiles: Dispatch<SetStateAction<DraftFile[]>>;
}) {
  const live = useRef(true),
    jobs = useRef(new Map<string, XMLHttpRequest>()),
    timers = useRef(new Set<ReturnType<typeof setTimeout>>()),
    generations = useRef(new Map<string, number>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const xhr of jobs.current.values()) xhr.abort();
      for (const t of timers.current) clearTimeout(t);
    };
  }, []);
  useEffect(() => {
    const retained = new Set(files.map((item) => item.key));
    for (const [key, xhr] of jobs.current) {
      if (!retained.has(key)) {
        generations.current.delete(key);
        xhr.abort();
        jobs.current.delete(key);
      }
    }
    for (const key of generations.current.keys())
      if (!retained.has(key)) generations.current.delete(key);
  }, [files]);
  const update = (key: string, generation: number, change: Partial<DraftFile>) => {
    if (live.current && generations.current.get(key) === generation)
      setFiles((old) => old.map((v) => (v.key === key ? { ...v, ...change } : v)));
  };
  async function run(item: DraftFile) {
    const generation = (generations.current.get(item.key) ?? 0) + 1;
    generations.current.set(item.key, generation);
    jobs.current.get(item.key)?.abort();
    const active = () => live.current && generations.current.get(item.key) === generation;
    update(item.key, generation, { error: undefined, progress: 0, upload: undefined });
    try {
      if (item.file.size < 1 || item.file.size > 8 * 1048576)
        throw Error("Размер файла: от 1 байта до 8 МБ.");
      await session();
      if (!active()) return;
      const upload = await api<UploadStatus>(`/uploads?${context}`, "POST", {
        client_id: requestID(),
        filename: item.file.name,
        size_bytes: item.file.size,
      });
      if (!active()) return;
      update(item.key, generation, { upload });
      await new Promise<void>((resolve, reject) => {
        if (!active()) return resolve();
        const xhr = new XMLHttpRequest();
        jobs.current.set(item.key, xhr);
        xhr.open("PUT", `/api/v1/uploads/${upload.id}/content?${context}`);
        xhr.setRequestHeader("X-Svyaz-CSRF", "1");
        xhr.timeout = 25000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            update(item.key, generation, { progress: Math.round((100 * e.loaded) / e.total) });
        };
        xhr.onload = () => {
          if (jobs.current.get(item.key) === xhr) jobs.current.delete(item.key);
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let code = "media_unavailable";
            try {
              code = JSON.parse(xhr.responseText).code ?? code;
            } catch {
            }
            reject(new ApiError(xhr.status, code));
          }
        };
        xhr.onerror = () => reject(Error("Передача прервана. Повторите загрузку."));
        xhr.ontimeout = () => reject(Error("Время загрузки истекло."));
        xhr.onabort = () => reject(Error("Загрузка отменена."));
        xhr.send(item.file);
      });
      if (!active()) return;
      let current = await api<UploadStatus>(`/uploads/${upload.id}/complete?${context}`, "POST");
      if (!active()) return;
      update(item.key, generation, { upload: current, progress: 100 });
      const deadline = Date.now() + 120000;
      while (active() && !["READY", "FAILED", "EXPIRED"].includes(current.state)) {
        if (Date.now() > deadline) throw Error("Обработка задержалась. Повторите позже.");
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            timers.current.delete(t);
            resolve();
          }, 1000);
          timers.current.add(t);
        });
        if (!active()) return;
        current = await api<UploadStatus>(`/uploads/${upload.id}?${context}`);
        if (!active()) return;
        update(item.key, generation, { upload: current });
      }
      if (!active()) return;
      if (current.state !== "READY") throw new ApiError(422, current.error ?? "unsupported_file");
    } catch (e) {
      update(item.key, generation, { error: explain(e) });
    } finally {
      if (active()) jobs.current.delete(item.key);
    }
  }
  return (
    <div className="upload-area">
      <label className="file-picker">
        <Icon name="plus" size={23} />
        <input
          type="file"
          aria-label="Прикрепить файл"
          disabled={disabled || files.length >= 4}
          accept="image/png,image/jpeg,.txt,.pdf,.wav,.mp3,.ogg,.mp4"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || files.length >= 4) return;
            const item = { key: requestID(), file, progress: 0 };
            setFiles((old) => [...old, item]);
            void run(item);
          }}
        />
      </label>
      {files.map((item) => (
        <div className={`upload-item ${item.error ? "has-error" : ""}`} key={item.key}>
          <span className="attachment-icon">
            <Icon name="file" size={30} />
          </span>
          <div className="upload-item-info">
            <strong>{item.file.name}</strong>
            <small>
              {fileSize(item.file.size)} ·{" "}
              {item.error
                ? "Ошибка"
                : item.upload?.state === "READY"
                  ? "Готов к отправке"
                  : item.progress === 100
                    ? "Обработка…"
                    : `Загрузка ${item.progress}%`}
            </small>
          </div>
          {!item.error && item.upload?.state !== "READY" && (
            <progress value={item.progress} max={100} aria-label={`Загрузка ${item.file.name}`} />
          )}
          {item.error && (
            <>
              <span role="alert">{item.error}</span>
              <button
                type="button"
                className="upload-retry"
                aria-label={`Повторить загрузку ${item.file.name}`}
                disabled={disabled}
                onClick={() => void run(item)}
              >
                <Icon name="refresh" size={18} />
              </button>
            </>
          )}
          <button
            type="button"
            className="upload-remove"
            aria-label={`Убрать ${item.file.name}`}
            onClick={() => {
              generations.current.delete(item.key);
              jobs.current.get(item.key)?.abort();
              jobs.current.delete(item.key);
              setFiles((old) => old.filter((v) => v.key !== item.key));
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function MessageFiles({ files, context }: { files: MessageFile[]; context: string }) {
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<MessageFile | null>(null);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const previewURL = (file: MessageFile) => `/api/v1/attachments/${file.id}/preview?${context}`;
  const contentURL = (file: MessageFile) => `/api/v1/attachments/${file.id}/content?${context}`;
  const previewError = (file: MessageFile) => {
    setFailedPreviews((old) => new Set([...old, file.id]));
    setError("Превью недоступно. Проверьте соединение и доступ к переписке.");
  };
  useEffect(() => {
    setPreview(null);
    setError("");
    setFailedPreviews(new Set());
  }, [context]);
  async function download(file: MessageFile) {
    if (downloading) return;
    setError("");
    setDownloading(file.id);
    try {
      await session();
      const response = await fetch(`/api/v1/attachments/${file.id}/content?${context}`, {
        credentials: "same-origin",
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, body.code ?? "media_unavailable");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(explain(e));
    } finally {
      setDownloading(null);
    }
  }
  return (
    <div className="message-files">
      {files.map((file) => (
        <div
          className={`message-file ${file.has_preview && !failedPreviews.has(file.id) ? "has-preview" : ""}`}
          key={file.id}
        >
          {file.content_type === "video/mp4" ? (
            <div className="attachment-video-card">
              <video
                controls
                playsInline
                preload="metadata"
                src={contentURL(file)}
                aria-label={`Видео ${file.filename}`}
                onError={() => setError("Видео недоступно. Проверьте соединение и доступ к переписке.")}
              />
              <span>{file.filename} · {fileSize(file.size_bytes)}</span>
            </div>
          ) : file.has_preview && !failedPreviews.has(file.id) ? (
            <button
              className="attachment-preview"
              type="button"
              aria-label={`Открыть изображение ${file.filename}`}
              onClick={() => setPreview(file)}
            >
              <img
                loading="lazy"
                src={previewURL(file)}
                alt={file.filename}
                onError={() => previewError(file)}
              />
            </button>
          ) : (
            <div className="attachment-file-card">
              <span className="attachment-icon">
                <Icon name="file" size={30} />
              </span>
              <div className="attachment-file-info">
                <button
                  className="attachment-filename"
                  type="button"
                  disabled={downloading !== null}
                  onClick={() => void download(file)}
                >
                  {file.filename}
                </button>
                <small>{fileSize(file.size_bytes)}</small>
              </div>
            </div>
          )}
          <button
            type="button"
            className="attachment-download"
            aria-label={`Скачать ${file.filename}`}
            disabled={downloading !== null}
            aria-busy={downloading === file.id}
            onClick={() => void download(file)}
          >
            <Icon name={downloading === file.id ? "refresh" : "download"} size={20} />
          </button>
        </div>
      ))}
      {error && (
        <p className="id-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <Modal
          title={preview.filename}
          className="attachment-lightbox"
          onClose={() => setPreview(null)}
        >
          <div className="attachment-lightbox-image">
            {failedPreviews.has(preview.id) ? (
              <p className="id-error" role="alert">
                Изображение недоступно.
              </p>
            ) : (
              <img
                src={previewURL(preview)}
                alt={preview.filename}
                onError={() => previewError(preview)}
              />
            )}
          </div>
          <footer className="attachment-lightbox-footer">
            <span>{fileSize(preview.size_bytes)}</span>
            <button
              type="button"
              disabled={downloading !== null}
              onClick={() => void download(preview)}
            >
              <Icon name="download" size={18} /> Скачать оригинал
            </button>
          </footer>
          {error && (
            <p className="id-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
