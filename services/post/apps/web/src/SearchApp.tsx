import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  GuildList,
  GuildChannelList,
  SearchPage,
  PublicProfile,
} from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";
import { navigate, useRoute } from "./navigation";
import { EmptyArt } from "./Brand";
import { Modal } from "./AppUI";
import { Icon } from "./Icons";
import { searchCount, searchParams, type SearchFilters } from "./search-state";
import { mentionPreview } from "./chat-mentions";
import { SelectField } from "./SelectField";
import { SearchSort } from "./SearchSort";
import "./media-search.css";

export function SearchBox() {
  const route = useRoute();
  const [query, setQuery] = useState(route.q ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(route.q ?? ""), [route.q]);
  return (
    <form
      className={`channel-search-box${route.search ? " is-open" : ""}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) navigate({ ...route, q: query.trim(), search: true, thread: undefined });
      }}
    >
      <input
        ref={input}
        aria-label="Поиск сообщений"
        placeholder="Поиск"
        value={query}
        maxLength={256}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            navigate({ ...route, search: undefined, q: undefined });
          }
        }}
      />
      {route.search ? (
        <button
          type="button"
          aria-label="Закрыть поиск"
          onClick={() => {
            setQuery("");
            navigate({ ...route, search: undefined, q: undefined });
          }}
        >
          <Icon name="close" size={14} />
        </button>
      ) : (
        <button
          aria-label="Искать"
          onClick={(e) => {
            if (!query.trim()) {
              e.preventDefault();
              input.current?.focus();
            }
          }}
        >
          <Icon name="search" size={14} />
        </button>
      )}
    </form>
  );
}

export function SearchApp({ embedded = false }: { embedded?: boolean }) {
  const route = useRoute();
  const committedQuery = route.q?.trim() ?? "";
  const conversation = embedded && route.kind === "conversation" ? route.room : undefined;
  const [query, setQuery] = useState(committedQuery);
  const defaults: SearchFilters = {
    scope: route.guild ? "channels" : route.tab === "messages" ? "dm" : "all",
    guild: route.guild ?? "",
    channel: "",
    author: "",
    from: "",
    to: "",
  };
  const [filters, setFilters] = useState<SearchFilters>(defaults);
  const [draft, setDraft] = useState<SearchFilters>(defaults);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState("newest");
  const [guilds, setGuilds] = useState<GuildList>({ items: [] });
  const [channels, setChannels] = useState<GuildChannelList>({ items: [], revision: 0 });
  const [page, setPage] = useState<SearchPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const lastQuery = useRef("");

  useEffect(() => {
    setQuery(committedQuery);
  }, [committedQuery]);
  useEffect(() => {
    if (!filterOpen) return;
    let active = true;
    api<GuildList>("/guilds")
      .then((v) => {
        if (active) setGuilds(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [filterOpen]);
  useEffect(() => {
    let active = true;
    setChannels({ items: [], revision: 0 });
    if (filterOpen && draft.guild && draft.scope !== "dm") {
      api<GuildChannelList>(`/guilds/${draft.guild}/channels`)
        .then((v) => {
          if (active) setChannels(v);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [filterOpen, draft.guild, draft.scope]);
  useEffect(() => {
    const generation = ++request.current;
    setPage(null);
    setError("");
    if (!committedQuery) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        let authorID: string | undefined;
        if (filters.author.trim()) {
          const value = filters.author.trim().replace(/^@/, "");
          authorID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
            ? value
            : (await api<PublicProfile>(`/users?login=${encodeURIComponent(value)}`)).id;
        }
        const params = searchParams(committedQuery, filters, sort, authorID, conversation);
        if (request.current !== generation) return;
        lastQuery.current = params.toString();
        const data = await api<SearchPage>(`/search?${params}`);
        if (request.current === generation) setPage(data);
      } catch (e) {
        if (request.current === generation)
          setError(e instanceof Error ? e.message : "Поиск недоступен.");
      } finally {
        if (request.current === generation) setBusy(false);
      }
    })();
    return () => {
      if (request.current === generation) request.current++;
    };
  }, [committedQuery, filters, sort, retry, conversation]);

  async function more() {
    if (!page?.cursor || busy) return;
    const generation = request.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(lastQuery.current);
      params.set("cursor", page.cursor);
      const data = await api<SearchPage>(`/search?${params}`);
      if (request.current === generation)
        setPage((old) =>
          old
            ? {
                ...data,
                items: [
                  ...old.items,
                  ...data.items.filter(
                    (v) => !old.items.some((m) => m.message_id === v.message_id),
                  ),
                ],
              }
            : data,
        );
    } catch (e) {
      if (request.current === generation)
        setError(e instanceof Error ? e.message : "Поиск недоступен.");
    } finally {
      if (request.current === generation) setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (query.trim() === committedQuery) setRetry((v) => v + 1);
    else
      navigate(
        embedded ? { ...route, q: query.trim(), search: true } : { tab: "search", q: query.trim() },
        true,
      );
  }
  const change = (key: keyof SearchFilters, value: string) =>
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(["guild", "scope"].includes(key) ? { channel: "" } : {}),
    }));
  const activeFilters = [filters.channel, filters.author, filters.from, filters.to].filter(
    Boolean,
  ).length;
  return (
    <section
      className={`search-app${embedded ? " embedded-search" : " standalone-search"}`}
      aria-label="Результаты поиска"
    >
      {!embedded && (
        <form className="standalone-search-query" onSubmit={submit}>
          <Icon name="search" />
          <input
            aria-label="Поиск сообщений"
            placeholder="Поиск сообщений"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={256}
            required
          />
          <button className="id-primary" disabled={busy}>
            Найти
          </button>
        </form>
      )}
      <header className="search-results-header">
        <strong aria-live="polite">
          {busy && !page ? "Ищем…" : searchCount(page?.items.length ?? 0, !!page?.cursor)}
        </strong>
        <button
          onClick={() => {
            setDraft(filters);
            setFilterOpen(true);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3 5h3m7 0h8M3 12h8m7 0h3M3 19h3m7 0h8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="10.5" cy="5" r="2.5" />
            <circle cx="15.5" cy="12" r="2.5" />
            <circle cx="10.5" cy="19" r="2.5" />
          </svg>
          Фильтры{activeFilters > 0 && <b>{activeFilters}</b>}
        </button>
        <SearchSort value={sort} onChange={setSort} />
      </header>
      <div className="search-results-body" aria-busy={busy}>
        {error && (
          <p className="id-error" role="alert">
            {error} <button onClick={() => setRetry((v) => v + 1)}>Повторить</button>
          </p>
        )}
        {!error && !busy && !page?.items.length && (
          <div className="search-empty">
            <EmptyArt kind="search" />
            <p>
              {committedQuery
                ? "Мы искали вдоль и поперёк. К сожалению, ничего не нашлось."
                : "Найдите нужное сообщение."}
            </p>
          </div>
        )}
        {page?.items.map((hit) => (
          <article className="search-hit" key={hit.message_id}>
            <h3>
              <Icon name={hit.room.kind === "channel" ? "hash" : "chat"} size={18} />
              {hit.room.name}
            </h3>
            <div className="search-hit-content">
              <time dateTime={hit.created_at}>
                {new Date(hit.created_at).toLocaleString("ru-RU")}
                {hit.thread_id ? " · Ветка" : ""}
              </time>
              <p>{mentionPreview(hit.snippet)}</p>
              <button
                onClick={() =>
                  navigate({
                    tab: hit.room.guild_id ? "guilds" : "messages",
                    guild: hit.room.guild_id,
                    kind: hit.room.kind,
                    room: hit.room.id,
                    message: hit.message_id,
                    thread: hit.thread_id,
                  })
                }
              >
                Перейти
              </button>
            </div>
          </article>
        ))}
        {page?.cursor && (
          <button className="search-more" disabled={busy} onClick={() => void more()}>
            {busy ? "Загрузка…" : "Следующие результаты"}
          </button>
        )}
      </div>
      {filterOpen && (
        <Modal
          title="Фильтры"
          className="search-filters-dialog"
          onClose={() => setFilterOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFilters(draft);
              setFilterOpen(false);
            }}
          >
            <div className="search-filter-fields">
              <label>
                От
                <input
                  value={draft.author}
                  onChange={(e) => change("author", e.target.value)}
                  placeholder="Логин пользователя"
                />
              </label>
              <label>
                Область поиска
                <SelectField
                  label="Область поиска"
                  value={draft.scope}
                  onChange={(value) => change("scope", value)}
                  options={[
                    { value: "all", label: "Все переписки" },
                    { value: "channels", label: "Серверы" },
                    { value: "dm", label: "Личные и групповые беседы" },
                  ]}
                />
              </label>
              <label>
                Сервер
                <SelectField
                  label="Сервер"
                  value={draft.guild}
                  disabled={draft.scope === "dm"}
                  onChange={(value) => change("guild", value)}
                  options={[
                    { value: "", label: "Все серверы" },
                    ...guilds.items.map((v) => ({ value: v.id, label: v.name })),
                  ]}
                />
              </label>
              <label>
                В
                <SelectField
                  label="В"
                  value={draft.channel}
                  disabled={!draft.guild || draft.scope === "dm"}
                  onChange={(value) => change("channel", value)}
                  options={[
                    { value: "", label: "Все каналы" },
                    ...channels.items.map((v) => ({ value: v.id, label: v.name })),
                  ]}
                />
              </label>
              <div className="search-date-fields">
                <label>
                  После даты (UTC)
                  <input
                    type="date"
                    value={draft.from}
                    max={draft.to || undefined}
                    onChange={(e) => change("from", e.target.value)}
                  />
                </label>
                <label>
                  До даты (UTC)
                  <input
                    type="date"
                    value={draft.to}
                    min={draft.from || undefined}
                    onChange={(e) => change("to", e.target.value)}
                  />
                </label>
              </div>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="search-clear-filters"
                onClick={() => setDraft(defaults)}
              >
                Очистить фильтры
              </button>
              <button type="button" onClick={() => setFilterOpen(false)}>
                Отмена
              </button>
              <button className="id-primary">Применить</button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
