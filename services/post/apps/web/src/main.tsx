import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { readStatus, type Snapshot } from "./api";
import "./style.css";
import { IdentityApp } from "./IdentityApp";

function Status() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      setSnapshot(await readStatus());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нет соединения");
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }
  useEffect(() => {
    document.title = "Состояние системы · Связь";
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, []);
  const healthy = !error && snapshot?.ready.status === "ok";
  return (
    <main className="identity system-status">
      <a href="/">← Вернуться в Связь</a>
      <header>
        <h1>Состояние системы</h1>
        <button disabled={loading} onClick={() => void refresh()}>
          Обновить
        </button>
      </header>
      <p className={healthy ? "id-notice" : "id-error"} role="status">
        {error ||
          (loading && !snapshot
            ? "Подключение…"
            : healthy
              ? "Все системы работают"
              : "Часть сервисов недоступна")}
      </p>
      <section className="status-components">
        <div>
          <strong>API</strong>
          <span>
            {!snapshot || error
              ? "Нет данных"
              : snapshot.live.status === "ok"
                ? "Доступен"
                : "Недоступен"}
          </span>
        </div>
        {snapshot?.ready.dependencies.map((d) => (
          <div key={d.name}>
            <strong>
              {d.name === "postgres" ? "База данных" : d.name === "redis" ? "Кеш" : d.name}
            </strong>
            <span>{error ? "Нет данных" : d.status === "up" ? "Доступен" : "Недоступен"}</span>
          </div>
        ))}
      </section>
      <dl>
        <dt>Версия</dt>
        <dd>{snapshot?.version.version ?? "—"}</dd>
        <dt>Схема</dt>
        <dd>{snapshot?.version.schema_version ?? "—"}</dd>
        <dt>Последнее обновление</dt>
        <dd>{snapshot?.checkedAt.toLocaleTimeString("ru-RU") ?? "—"}</dd>
      </dl>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{location.pathname === "/status" ? <Status /> : <IdentityApp />}</StrictMode>,
);
