import { useEffect, useId, useRef, useState } from "react";
import type {
  ConversationList,
  GuildList,
  GuildChannelList,
} from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";
import { Modal } from "./AppUI";
import { Icon } from "./Icons";
import { navigate } from "./navigation";
import { filterQuickTargets, quickSelectionIndex, type QuickTarget } from "./quick-switcher-state";
import "./quick-switcher.css";

export const QUICK_SWITCHER_EVENT = "svyaz:quick-switcher";
export function openQuickSwitcher() {
  window.dispatchEvent(new Event(QUICK_SWITCHER_EVENT));
}

export function QuickSwitcher({ userID, onClose }: { userID: string; onClose: () => void }) {
  const [items, setItems] = useState<QuickTarget[]>([]);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listID = useId();
  const matches = filterQuickTargets(items, query);
  const selected = Math.min(selection, Math.max(0, matches.length - 1));
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    let stopped = false;
    setItems([]);
    setSelection(0);
    setBusy(true);
    setError("");
    void (async () => {
      const [conversations, guilds] = await Promise.allSettled([
        api<ConversationList>("/conversations"),
        api<GuildList>("/guilds"),
      ]);
      if (stopped) return;
      const next: QuickTarget[] = [];
      let failed = conversations.status === "rejected" || guilds.status === "rejected";
      if (conversations.status === "fulfilled") {
        next.push(
          ...conversations.value.items.map((conversation) => {
            const others = conversation.members
              .filter((member) => member.id !== userID)
              .map((member) => member.name)
              .join(", ");
            return {
              id: `conversation:${conversation.id}`,
              kind: "conversation" as const,
              name:
                conversation.kind === "DM"
                  ? others || conversation.name
                  : conversation.name || others,
              context: conversation.kind === "DM" ? "Личные сообщения" : "Групповая беседа",
              keywords: others,
              room: conversation.id,
            };
          }),
        );
      }
      if (guilds.status === "fulfilled") {
        next.push(
          ...guilds.value.items.map((guild) => ({
            id: `guild:${guild.id}`,
            kind: "guild" as const,
            name: guild.name,
            context: "Сервер",
            keywords: "",
            guild: guild.id,
          })),
        );
        for (let start = 0; start < guilds.value.items.length; start += 6) {
          const batch = guilds.value.items.slice(start, start + 6);
          const channels = await Promise.allSettled(
            batch.map((guild) => api<GuildChannelList>(`/guilds/${guild.id}/channels`)),
          );
          if (stopped) return;
          channels.forEach((page, index) => {
            if (page.status === "rejected") {
              failed = true;
              return;
            }
            next.push(
              ...page.value.items
                .filter(
                  (channel) =>
                    channel.state === "ACTIVE" && channel.permissions.includes("VIEW_CHANNEL"),
                )
                .map((channel) => ({
                  id: `channel:${channel.id}`,
                  kind: channel.kind === "VOICE" ? ("voice" as const) : ("text" as const),
                  name: channel.name,
                  context: batch[index].name,
                  keywords: channel.kind === "FORUM" ? "форум" : "",
                  guild: batch[index].id,
                  room: channel.id,
                })),
            );
          });
        }
      }
      if (!stopped) {
        setItems(next);
        setSelection(0);
        setBusy(false);
        if (failed) setError("Не удалось загрузить часть бесед и каналов.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [userID, retry]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-quick-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, query]);
  function choose(target: QuickTarget) {
    onClose();
    if (target.kind === "conversation")
      navigate({ tab: "messages", kind: "conversation", room: target.room });
    else
      navigate({
        tab: "guilds",
        guild: target.guild,
        ...(target.room ? { kind: "channel" as const, room: target.room } : {}),
      });
    requestAnimationFrame(() =>
      document.getElementById("id-content")?.focus({ preventScroll: true }),
    );
  }
  const prefix = query.trim()[0];
  const heading =
    prefix === "@"
      ? "Поиск по беседам"
      : prefix === "#"
        ? "Поиск по текстовым каналам"
        : prefix === "!"
          ? "Поиск по голосовым каналам"
          : prefix === "*"
            ? "Поиск по серверам"
            : query.trim()
              ? "Результаты поиска"
              : "Беседы и каналы";
  return (
    <Modal title="Быстрый переход" className="quick-switcher-dialog" onClose={onClose}>
      <input
        ref={input}
        role="combobox"
        aria-label="Быстрый переход"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listID}
        aria-activedescendant={matches[selected] ? `${listID}-${selected}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Куда отправимся?"
        value={query}
        maxLength={256}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelection(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelection(
              quickSelectionIndex(selected, e.key === "ArrowDown" ? 1 : -1, matches.length),
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[selected]) choose(matches[selected]);
          }
        }}
      />
      <button
        type="button"
        className="quick-switcher-mobile-close"
        aria-label="Закрыть быстрый переход"
        onClick={onClose}
      >
        <Icon name="close" size={20} />
      </button>
      <div className="quick-switcher-results" ref={list} aria-busy={busy}>
        <h3>{heading}</h3>
        {busy && <p role="status">Загрузка…</p>}
        {error && (
          <p className="quick-switcher-error" role="alert">
            {error} <button onClick={() => setRetry((value) => value + 1)}>Повторить</button>
          </p>
        )}
        <div role="listbox" id={listID} aria-label="Результаты">
          {matches.map((target, index) => (
            <div
              role="option"
              aria-selected={index === selected}
              aria-label={`${target.name}, ${target.context}`}
              id={`${listID}-${index}`}
              data-quick-index={index}
              key={target.id}
              onMouseMove={() => {
                if (selected !== index) setSelection(index);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(target)}
            >
              <Icon
                name={
                  target.kind === "voice"
                    ? "speaker"
                    : target.kind === "text"
                      ? "hash"
                      : target.kind === "guild"
                        ? "users"
                        : "chat"
                }
                size={16}
              />
              <span className="quick-target-name">{target.name}</span>
              <small>
                {target.kind === "voice"
                  ? "Голосовой канал"
                  : target.kind === "text"
                    ? "Текстовый канал"
                    : target.kind === "guild"
                      ? "Сервер"
                      : "Беседа"}
              </small>
              <span className="quick-target-context">{target.context}</span>
            </div>
          ))}
        </div>
        {!busy && !error && !matches.length && (
          <p className="quick-switcher-empty id-sr" role="status">
            Ничего не найдено.
          </p>
        )}
      </div>
      <div className="quick-switcher-keys" aria-hidden="true">
        <kbd>@</kbd> Беседы <kbd>#</kbd> Текст <kbd>!</kbd> Голос <kbd>*</kbd> Серверы{" "}
        <span>
          <kbd>Enter</kbd> Перейти
        </span>
      </div>
    </Modal>
  );
}
