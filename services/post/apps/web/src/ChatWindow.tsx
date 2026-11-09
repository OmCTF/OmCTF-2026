import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type {
  ChatMessage,
  ChatPage,
  ChatRoom,
  ChatRead,
  ChatEvents,
  ChatFrame,
  ChatSend,
  ChatThread,
  ChatThreadList,
  ChatMention,
} from "../../../packages/contracts/generated/ts/models";
import { api, ApiError, session } from "./identity-api";
import { requestID } from "./request-id";
import {
  mergeMessages,
  replay,
  reactionNames,
  reactionSymbols,
  historyWindow,
  mergeRead,
} from "./chat-state";
import "./chat.css";
import { MessageFiles, UploadPicker, type DraftFile } from "./MediaFiles";
import { navigate, routeHash, useRoute } from "./navigation";
import { announceRead, useNotifications } from "./unread";
import { Icon } from "./Icons";
import { ChatRoomIcon, chatPresentation } from "./ChatPresentation";
import { SearchBox } from "./SearchApp";
import { NotificationRuleEditor } from "./Community";
import { MentionComposer } from "./MentionComposer";
import { MentionText } from "./MentionText";
import { contentMentions, mentionTargets, withLegacyMentions } from "./chat-mentions";
import { Modal, Skeleton } from "./AppUI";
import { dateLabel, groupMessage } from "./visual-state";
import {
  chatDraftKey,
  chatDraftVersion,
  readChatDraft,
  subscribeChatDraft,
  writeChatDraft,
  removeChatDraft,
  type DraftReply,
} from "./chat-drafts";

type Pending = {
  input: ChatSend;
  state: "pending" | "failed";
  error?: string;
  draftVersion?: number;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : "Не удалось выполнить действие.");
type ChatWindowProps = {
  roomID: string;
  roomKind: "channel" | "conversation";
  userID: string;
  title?: string;
  avatars?: Record<string, string>;
  presentation?: "voice";
};
export function ChatWindow(props: ChatWindowProps) {
  const route = useRoute();
  const draftHost = useRef<HTMLDivElement>(null);
  const thread = route.room === props.roomID ? route.thread : undefined;
  return (
    <div className={`chat-split ${thread ? "with-thread" : ""}`} ref={draftHost}>
      <ChatPane
        {...props}
        threadID=""
        key={chatDraftKey({ ...props, threadID: "" })}
        draftHost={draftHost}
      />
      {thread && (
        <ChatPane
          {...props}
          threadID={thread}
          key={chatDraftKey({ ...props, threadID: thread })}
          draftHost={draftHost}
        />
      )}
    </div>
  );
}
function ChatPane({
  roomID,
  roomKind,
  userID,
  title,
  avatars = {},
  presentation,
  threadID,
  draftHost,
}: ChatWindowProps & { threadID: string; draftHost: RefObject<HTMLDivElement | null> }) {
  const route = useRoute();
  const notifications = useNotifications();
  const setThreadID = (thread?: string) =>
    navigate({ ...route, thread, search: undefined, message: undefined });
  const base = `/${roomKind === "channel" ? "channels" : "conversations"}/${roomID}`;
  const context = `room_kind=${roomKind}&room_id=${roomID}`;
  const draftScope = useMemo(
    () => ({ userID, roomKind, roomID, threadID }),
    [userID, roomKind, roomID, threadID],
  );
  const [initialDraft] = useState(() => {
    const draft = readChatDraft(draftScope);
    return { ...draft, content: withLegacyMentions(draft.content, draft.mentions) };
  });
  const draftVersionRef = useRef(chatDraftVersion(draftScope));
  const queuedDraft = useRef<number | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [room, setRoom] = useState<ChatRoom | null>(null);
  const targets = useMemo(() => mentionTargets(room?.members, room?.roles), [room]);
  const [read, setRead] = useState<ChatRead>({ ordinal: 0, unread: 0 }),
    [status, setStatus] = useState("Подключение…"),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [threadError, setThreadError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]),
    [content, setContent] = useState(initialDraft.content),
    [reply, setReply] = useState<DraftReply | null>(initialDraft.reply);
  const [editing, setEditing] = useState<ChatMessage | null>(null),
    [editText, setEditText] = useState("");
  const [mentions, setMentions] = useState<ChatMention[]>(initialDraft.mentions),
    [typing, setTyping] = useState<string[]>([]),
    [presence, setPresence] = useState<string[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]),
    [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null),
    [threadName, setThreadName] = useState("");
  const [threadOrigin, setThreadOrigin] = useState<ChatMessage | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  useLayoutEffect(
    () =>
      subscribeChatDraft(draftScope, (version) => {
        if (draftVersionRef.current !== version) return;
        draftVersionRef.current = undefined;
        queuedDraft.current = undefined;
        setContent("");
        setMentions([]);
        setReply(null);
      }),
    [draftScope],
  );
  useEffect(() => {
    if (route.search) setThreadRoot(null);
  }, [route.search]);
  const beginThread = (message: ChatMessage) => {
    if (route.search) navigate({ ...route, search: undefined });
    setThreadRoot(message);
    setThreadName("");
  };
  const [pins, setPins] = useState<ChatMessage[] | null>(null),
    [cursors, setCursors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    [linked, setLinked] = useState<ChatMessage | null>(null);
  const ws = useRef<WebSocket | null>(null),
    sequence = useRef<number | null>(null),
    typingAt = useRef(0),
    alive = useRef(true);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function markRead() {
    const last = messages.at(-1);
    if (last) {
      const updated = await api<ChatRead>(`${base}/read-position`, "PUT", { message_id: last.id });
      updateRead(updated);
    }
  }
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const pinsRef = useRef<HTMLElement>(null);
  const pinsButtonRef = useRef<HTMLButtonElement>(null);
  const [pinsRight, setPinsRight] = useState(8);
  useLayoutEffect(() => {
    if (!pins) return;
    const position = () => {
      const button = pinsButtonRef.current;
      const panel = button?.closest(".chat-window")?.getBoundingClientRect();
      if (button && panel)
        setPinsRight(
          Math.max(
            8,
            Math.min(panel.right - button.getBoundingClientRect().right, panel.width - 428),
          ),
        );
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [pins]);
  useEffect(() => {
    if (!pins) return;
    const dismiss = (e: PointerEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !pinsRef.current?.contains(e.target as Node)
      )
        setPins(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [pins]);
  useEffect(() => {
    if (!contextMenu) return;
    contextRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape" || e.key === "Tab") setContextMenu(null);
      } else if (!contextRef.current?.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [contextMenu]);
  const currentRead = useRef<ChatRead>({ ordinal: 0, unread: 0 });
  const accessDenied = useRef(false);
  const actionPending = useRef(false);
  useLayoutEffect(() => {
    if (accessDenied.current) return;
    if (!content && !mentions.length && !reply && queuedDraft.current !== undefined) return;
    queuedDraft.current = undefined;
    draftVersionRef.current = writeChatDraft(draftScope, { content, mentions, reply });
  }, [draftScope, content, mentions, reply]);
  function clearAccess() {
    accessDenied.current = true;
    removeChatDraft(draftScope);
    setContent("");
    setMentions([]);
    setMessages([]);
    setPending([]);
    setFiles([]);
    setCursors({});
    setPins(null);
    setLinked(null);
    setRoom(null);
    setEditing(null);
    setReply(null);
    setThreads([]);
    setThreadOrigin(null);
    setThreadRoot(null);
    setTyping([]);
    setPresence([]);
    setContextMenu(null);
    setDeleting(null);
  }
  function updateRead(value: ChatRead) {
    currentRead.current = mergeRead(currentRead.current, value);
    setRead(currentRead.current);
    announceRead(roomKind, roomID, currentRead.current);
  }
  const historyElement = useRef<HTMLDivElement>(null),
    stickToBottom = useRef(true),
    lastThread = useRef("");
  useLayoutEffect(() => {
    const el = historyElement.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current && !anchor.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [ceiling, setCeiling] = useState<number | null>(null);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  function rememberAnchor() {
    const el = historyElement.current;
    if (!el) return;
    const item = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
      (v) => v.getBoundingClientRect().bottom > el.getBoundingClientRect().top + 45,
    );
    if (item)
      anchor.current = {
        id: item.dataset.messageId!,
        offset: item.getBoundingClientRect().top - el.getBoundingClientRect().top,
      };
  }
  const latestID = messages.at(-1)?.id;
  const lastMarked = useRef("");
  useEffect(() => {
    if (threadID || !latestID || read.unread < 1) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const markVisible = () => {
      if (document.visibilityState === "hidden" || lastMarked.current === latestID) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden" || stopped) return;
        lastMarked.current = latestID;
        void api<ChatRead>(`${base}/read-position`, "PUT", { message_id: latestID })
          .then((updated) => {
            if (!stopped) updateRead(updated);
          })
          .catch(() => {
            if (lastMarked.current === latestID) lastMarked.current = "";
          });
      }, 250);
    };
    markVisible();
    document.addEventListener("visibilitychange", markVisible);
    window.addEventListener("focus", markVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", markVisible);
      window.removeEventListener("focus", markVisible);
    };
  }, [base, latestID, read.unread, threadID]);
  useLayoutEffect(() => {
    if (lastThread.current !== threadID) {
      stickToBottom.current = true;
      lastThread.current = threadID;
    }
    const el = historyElement.current;
    if (el && anchor.current) {
      const item = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
        (v) => v.dataset.messageId === anchor.current?.id,
      );
      if (item)
        el.scrollTop +=
          item.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.current.offset;
      anchor.current = null;
    } else if (stickToBottom.current && el) el.scrollTop = el.scrollHeight;
  }, [latestID, messages, pending.length, threadID, ceiling, editing]);
  useEffect(() => {
    setCeiling(null);
    if (threadID) void action(() => history(false, threadID));
  }, [threadID]);
  useEffect(() => {
    const title = document.title;
    const update = () => {
      document.title =
        notifications.enabled && document.hidden && read.unread > 0
          ? `(${read.unread}) Новые сообщения · Связь`
          : title;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = title;
    };
  }, [read.unread, notifications.enabled]);
  useEffect(() => {
    if (!route.message || route.room !== roomID || !!route.thread !== !!threadID) {
      setLinked(null);
      return;
    }
    let active = true;
    void api<ChatMessage>(`/messages/${route.message}?${context}`)
      .then((message) => {
        if (active && !accessDenied.current) setLinked(message);
      })
      .catch((e) => {
        if (active) {
          setLinked(null);
          setError(`Сообщение недоступно. ${errText(e)}`);
        }
      });
    return () => {
      active = false;
    };
  }, [route.message, route.thread, threadID, roomID, context]);
  const author = (id: string) =>
    room?.members.find((m) => m.id === id)?.name ?? `Участник ${id.slice(0, 8)}`;
  function accept(items: ChatMessage[]) {
    if (!alive.current || accessDenied.current) return;
    setMessages((old) => mergeMessages(old, items));
    setPending((old) =>
      old.filter(
        (p) => !items.some((m) => m.author_id === userID && m.client_id === p.input.client_id),
      ),
    );
  }
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let backoff = 500,
      terminal = false;
    const reloadThreads = () =>
      api<ChatThreadList>(`${base}/threads`)
        .then((v) => {
          if (!stopped && !terminal) {
            setThreads(v.items);
            setThreadError("");
          }
        })
        .catch((e) => {
          if (!stopped) setThreadError(errText(e));
        });
    function consume(data: ChatEvents) {
      if (stopped || terminal) return;
      const previous = sequence.current ?? 0;
      setMessages((old) => replay(old, data.events, previous));
      const confirmed = data.events.flatMap((e) => (e.message ? [e.message] : []));
      setPending((old) =>
        old.filter(
          (p) =>
            !confirmed.some((m) => m.author_id === userID && m.client_id === p.input.client_id),
        ),
      );
      if (data.events.some((e) => e.kind === "thread.changed")) void reloadThreads();
      sequence.current = Math.max(previous, data.sequence);
      setRoom(data.room);
      updateRead(data.read);
      setTyping(data.typing.filter((id) => id !== userID));
      setPresence(data.presence);
      setConnectionError("");
      setStatus(data.has_more ? "Восстанавливаем пропущенные сообщения…" : "На связи");
      backoff = 500;
    }
    async function connect() {
      if (stopped) return;
      setStatus(sequence.current === null ? "Загружаем историю…" : "Восстановление связи…");
      try {
        if (sequence.current === null) {
          const page = await api<ChatPage>(`${base}/messages`);
          if (stopped || terminal) return;
          setMessages((old) => mergeMessages(old, page.items));
          setRoom(page.room);
          accessDenied.current = false;
          updateRead(page.read);
          setCursors((old) => ({ ...old, "": page.cursor }));
          sequence.current = page.sequence;
        }
        await session();
        if (stopped) return;
        void reloadThreads();
        socket = new WebSocket(
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/chat/ws`,
        );
        ws.current = socket;
        socket.onmessage = (event) => {
          if (stopped || terminal) return;
          try {
            const frame = JSON.parse(event.data) as ChatFrame;
            if (frame.schema_version !== 1) throw Error("Версия протокола не поддерживается.");
            if (frame.op === "ready")
              socket?.send(
                JSON.stringify({
                  op: "subscribe",
                  schema_version: 1,
                  request_id: requestID(),
                  room_id: roomID,
                  room_kind: roomKind,
                  after: sequence.current ?? 0,
                }),
              );
            if (frame.data) consume(frame.data);
            if (frame.op === "error") {
              if (frame.code === "access_revoked") {
                terminal = true;
                clearAccess();
                setStatus("Доступ к переписке отозван");
              } else if (frame.code === "resync_required") {
                sequence.current = null;
                setMessages([]);
                setStatus("Нужна повторная синхронизация…");
              } else
                setStatus(
                  frame.code === "authentication_required"
                    ? "Обновляем сессию…"
                    : "Восстановление связи…",
                );
              socket?.close();
            }
          } catch (e) {
            setConnectionError(errText(e));
            socket?.close();
          }
        };
        socket.onerror = () => {
          if (!stopped) setStatus("Сервис недоступен. Восстанавливаем связь…");
        };
        socket.onclose = () => {
          clearInterval(heartbeat);
          if (stopped || terminal) return;
          setStatus("Восстановление связи…");
          timer = setTimeout(() => void connect(), backoff);
          backoff = Math.min(backoff * 2, 10000);
        };
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({ op: "ping", schema_version: 1, request_id: requestID() }),
            );
        }, 10000);
      } catch (e) {
        if (stopped) return;
        setConnectionError(errText(e));
        setStatus("История недоступна. Повторяем подключение…");
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          terminal = true;
          clearAccess();
          setStatus("Нет доступа к переписке");
          return;
        }
        timer = setTimeout(() => void connect(), backoff);
        backoff = Math.min(backoff * 2, 10000);
      }
    }
    void connect();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
      clearInterval(heartbeat);
      socket?.close();
      ws.current = null;
    };
  }, [base, roomID, roomKind, userID, attempt]);

  async function action(fn: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      actionPending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function send(input: ChatSend, draftVersion?: number) {
    setPending((old) => [
      ...old.filter((p) => p.input.client_id !== input.client_id),
      { input, state: "pending", draftVersion },
    ]);
    try {
      const m = await api<ChatMessage>(`${base}/messages`, "POST", input);
      if (draftVersion !== undefined) removeChatDraft(draftScope, draftVersion);
      if (queuedDraft.current === draftVersion) queuedDraft.current = undefined;
      if (alive.current) accept([m]);
    } catch (e) {
      if (alive.current && !accessDenied.current)
        setPending((old) =>
          old.map((p) =>
            p.input.client_id === input.client_id
              ? { ...p, state: "failed", error: errText(e) }
              : p,
          ),
        );
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const ready = files.filter((v) => v.upload?.state === "READY" && !v.error);
    const selectedMentions = contentMentions(content, targets);
    if (
      (!content.trim() && !ready.length) ||
      !room?.can_send ||
      activeThread?.archived ||
      Array.from(content).length > 4000 ||
      selectedMentions.length > 20
    )
      return;
    const input: ChatSend = {
      client_id: requestID(),
      content: content.trim() ? content : ready.map((v) => v.file.name).join(", "),
      ...(ready.length ? { upload_ids: ready.map((v) => v.upload!.id) } : {}),
      mentions: selectedMentions,
      ...(reply ? { reply_to: reply.id } : {}),
      ...(threadID ? { thread_id: threadID } : {}),
    };
    const draftVersion = writeChatDraft(draftScope, { content, mentions: selectedMentions, reply });
    draftVersionRef.current = draftVersion;
    queuedDraft.current = draftVersion;
    setContent("");
    setReply(null);
    setMentions([]);
    setFiles((old) => old.filter((v) => !ready.some((f) => f.key === v.key)));
    void send(input, draftVersion);
  }
  async function history(older = false, tid = threadID) {
    if (older) {
      rememberAnchor();
      stickToBottom.current = false;
      if (windowed.older) {
        setCeiling(allVisible[Math.max(99, windowed.end - 51)].ordinal);
        return;
      }
    }
    const query = new URLSearchParams();
    if (tid) query.set("thread_id", tid);
    if (older && cursors[tid]) query.set("cursor", cursors[tid]!);
    const page = await api<ChatPage>(`${base}/messages?${query}`);
    if (!alive.current || accessDenied.current) return;
    if (older) setCeiling(visible[Math.min(49, visible.length - 1)]?.ordinal ?? null);
    accept(page.items);
    setCursors((old) => ({ ...old, [tid]: page.cursor }));
  }
  async function openMessage(id: string) {
    const m = await api<ChatMessage>(`/messages/${id}?${context}`);
    if (!alive.current || accessDenied.current) return;
    if ((m.thread_id ?? "") !== threadID) {
      navigate({
        ...route,
        room: roomID,
        kind: roomKind,
        thread: m.thread_id ?? undefined,
        message: m.id,
        search: undefined,
      });
    } else {
      setLinked(m);
    }
  }
  async function loadPins() {
    const page = await api<ChatPage>(`${base}/pins?limit=100`);
    if (alive.current && !accessDenied.current) setPins(page.items);
  }
  async function pinMessage(m: ChatMessage) {
    const updated = await api<ChatMessage>(`${base}/pins/${m.id}`, m.pinned ? "DELETE" : "POST");
    accept([updated]);
    if (pins) await loadPins();
  }
  const activeThread = threads.find((t) => t.id === threadID);
  useEffect(() => {
    let alive = true;
    setThreadOrigin(null);
    if (activeThread?.root_id) {
      void api<ChatMessage>(`/messages/${activeThread.root_id}?${context}`)
        .then((message) => { if (alive) setThreadOrigin(message); })
        .catch(() => { if (alive) setThreadOrigin(null); });
    }
    return () => { alive = false; };
  }, [activeThread?.root_id, context]);
  const roomPresentation = chatPresentation(
    roomKind,
    activeThread?.name ?? title ?? room?.name,
    presentation === "voice",
    !!threadID,
  );
  const allVisible = messages.filter((m) => (m.thread_id ?? "") === threadID);
  const windowed = historyWindow(allVisible, ceiling);
  const visible = windowed.items;
  const linkedInHistory = !!linked && visible.some((m) => m.id === linked.id);
  const jumpedMessage = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!linked) {
      jumpedMessage.current = null;
      return;
    }
    if (!linkedInHistory || jumpedMessage.current === linked.id) return;
    const history = historyElement.current;
    const target = [...(history?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])].find(
      (el) => el.dataset.messageId === linked.id,
    );
    if (!history || !target) return;
    stickToBottom.current = false;
    history.scrollTop +=
      target.getBoundingClientRect().top -
      history.getBoundingClientRect().top -
      (history.clientHeight - target.clientHeight) / 2;
    target.focus({ preventScroll: true });
    jumpedMessage.current = linked.id;
  }, [linked, linkedInHistory, messages]);
  function messageCard(m: ChatMessage, compact = false, grouped = false) {
    const current = messages.find((v) => v.id === m.id) ?? m;
    return (
      <article
        className={`chat-message ${current.deleted ? "is-deleted" : ""} ${grouped ? "is-grouped" : ""} ${editing?.id === current.id && !compact ? "is-editing" : ""} ${linked?.id === current.id && !compact ? "is-jump-target" : ""}`}
        key={m.id}
        data-message-id={m.id}
        tabIndex={0}
        onContextMenu={(e) => {
          if (!compact && !current.deleted) {
            e.preventDefault();
            setContextMenu({
              message: current,
              x: Math.max(8, Math.min(e.clientX, innerWidth - 293)),
              y: Math.max(8, Math.min(e.clientY, innerHeight - 340)),
            });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "F10" && e.shiftKey && !compact && !current.deleted) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setContextMenu({
              message: current,
              x: Math.max(8, Math.min(r.left + 60, innerWidth - 293)),
              y: Math.max(8, Math.min(r.top + 20, innerHeight - 340)),
            });
          }
        }}
      >
        {grouped && (
          <time className="chat-group-time" dateTime={m.created_at}>
            {new Date(m.created_at).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
        <div
          className={`chat-avatar ${avatars[m.author_id] ?? "violet"}${current.webhook ? ` hook-${current.webhook.avatar}` : ""}`}
          aria-hidden="true"
        >
          {Array.from(current.webhook?.name ?? author(m.author_id))[0]?.toUpperCase()}
        </div>
        <div className="chat-message-body">
          <div className="chat-byline">
            <strong>{current.webhook?.name ?? author(m.author_id)}</strong>
            {current.webhook && <span className="webhook-badge">APP</span>}
            <time dateTime={m.created_at}>
              {new Date(m.created_at).toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            {current.edited_at && !current.deleted && <small>(изменено)</small>}
            {current.pinned && <span className="chat-tag">закреплено</span>}
          </div>
          {current.reply_to && (
            <button
              className="chat-reply"
              onClick={() => void action(() => openMessage(current.reply_to!))}
            >
              В ответ на сообщение ↗
            </button>
          )}
          {editing?.id === current.id && !compact ? (
            <form
              className="message-inline-edit"
              onSubmit={(e) => {
                e.preventDefault();
                const editMentions = contentMentions(editText, targets);
                if (
                  !editText.trim() ||
                  Array.from(editText).length > 4000 ||
                  editMentions.length > 20
                )
                  return;
                void action(async () => {
                  accept([
                    await api<ChatMessage>(`/messages/${editing.id}?${context}`, "PATCH", {
                      revision: editing.revision,
                      content: editText,
                      mentions: editMentions,
                    }),
                  ]);
                  setEditing(null);
                });
              }}
            >
              <MentionComposer
                autoFocus
                label="Редактирование сообщения"
                value={editText}
                targets={targets}
                avatars={avatars}
                onChange={setEditText}
                onCancel={() => setEditing(null)}
              />
              <div className="message-inline-edit-actions">
                <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                  Отмена
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !editText.trim() ||
                    Array.from(editText).length > 4000 ||
                    contentMentions(editText, targets).length > 20
                  }
                >
                  Сохранить
                </button>
              </div>
            </form>
          ) : (
            <p className="chat-text">
              {current.deleted ? (
                "Сообщение удалено"
              ) : (
                <MentionText
                  content={current.content}
                  mentions={current.mentions}
                  targets={targets}
                />
              )}
            </p>
          )}
          {!current.deleted && !!current.attachments?.length && (
            <MessageFiles files={current.attachments} context={context} />
          )}
          {!current.deleted && !compact && (
            <div className="chat-message-tools">
              <div className="chat-reactions">
                {current.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    aria-pressed={r.mine}
                    title={reactionNames[r.emoji]}
                    disabled={busy || !room?.can_send}
                    onClick={() =>
                      void action(async () =>
                        accept([
                          await api<ChatMessage>(
                            `/messages/${m.id}/reactions/${r.emoji}?${context}`,
                            r.mine ? "DELETE" : "PUT",
                          ),
                        ]),
                      )
                    }
                  >
                    {reactionSymbols[r.emoji]} {r.count}
                  </button>
                ))}
              </div>
              <div className="chat-message-actions">
                {room?.can_send && (
                  <>
                    <div className="message-quick-reactions" aria-label="Быстрые реакции">
                      {Object.keys(reactionNames)
                        .slice(0, 3)
                        .map((emoji) => (
                          <button
                            key={emoji}
                            aria-label={`Быстрая реакция: ${reactionNames[emoji]}`}
                            disabled={busy}
                            onClick={() =>
                              void action(async () =>
                                accept([
                                  await api<ChatMessage>(
                                    `/messages/${m.id}/reactions/${emoji}?${context}`,
                                    "PUT",
                                  ),
                                ]),
                              )
                            }
                          >
                            {reactionSymbols[emoji]}
                          </button>
                        ))}
                    </div>
                    <button
                      aria-label="Ответить"
                      title="Ответить"
                      onClick={() => setReply(current)}
                    >
                      <Icon name="reply" size={18} />
                    </button>
                    <details
                      className="action-menu emoji-picker"
                      onToggle={(e) => {
                        if (!e.currentTarget.open) return;
                        const edge =
                          e.currentTarget.closest(".chat-history")?.getBoundingClientRect().top ??
                          0;
                        e.currentTarget.dataset.placement =
                          e.currentTarget.getBoundingClientRect().top - 114 < edge
                            ? "below"
                            : "above";
                      }}
                    >
                      <summary aria-label="Добавить реакцию" data-tooltip="Добавить реакцию">
                        <Icon name="smile" size={18} />
                      </summary>
                      <div className="emoji-grid">
                        {Object.entries(reactionNames).map(([id, name]) => (
                          <button
                            key={id}
                            aria-label={name}
                            disabled={busy}
                            onClick={(e) => {
                              e.currentTarget.closest("details")?.removeAttribute("open");
                              void action(async () =>
                                accept([
                                  await api<ChatMessage>(
                                    `/messages/${m.id}/reactions/${id}?${context}`,
                                    "PUT",
                                  ),
                                ]),
                              );
                            }}
                          >
                            {reactionSymbols[id]}
                          </button>
                        ))}
                      </div>
                    </details>
                  </>
                )}
                {!m.thread_id && room?.can_thread && (
                  <button
                    aria-label="Ветка"
                    title="Ветка"
                    onClick={() => {
                      const existing = threads.find((t) => t.root_id === m.id);
                      if (existing) {
                        setThreadID(existing.id);
                      } else {
                        beginThread(current);
                      }
                    }}
                  >
                    <Icon name="thread" size={18} />
                  </button>
                )}
                <button
                  aria-label="Другие действия"
                  title="Другие действия"
                  aria-haspopup="menu"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      message: current,
                      x: Math.max(8, Math.min(rect.right - 285, innerWidth - 293)),
                      y: Math.max(8, Math.min(rect.bottom + 8, innerHeight - 340)),
                    });
                  }}
                >
                  <Icon name="more" size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  }
  return (
    <section
      className={`chat-window ${threadID ? "is-thread" : "is-main"}${roomPresentation.voiceChat ? " is-voice-chat" : ""}`}
      aria-label={threadID ? "Ветка обсуждения" : "Переписка"}
    >
      {contextMenu && (
        <div
          ref={contextRef}
          className="message-context-menu"
          role="menu"
          aria-label="Действия с сообщением"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const buttons = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
              ];
              const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
        >
          {room?.can_send && (
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setReply(contextMenu.message);
                setContextMenu(null);
              }}
            >
              Ответить
              <Icon name="reply" size={18} />
            </button>
          )}
          {(contextMenu.message.author_id === userID || room?.can_manage) && (
            <button
              role="menuitem"
              disabled={busy || !(room?.can_send || room?.can_manage)}
              onClick={() => {
                setEditing(contextMenu.message);
                setEditText(
                  withLegacyMentions(contextMenu.message.content, contextMenu.message.mentions),
                );
                setContextMenu(null);
              }}
            >
              Изменить сообщение
              <Icon name="edit" size={18} />
            </button>
          )}
          {room?.can_manage && (
            <button
              role="menuitem"
              onClick={() => {
                void action(() => pinMessage(contextMenu.message));
                setContextMenu(null);
              }}
            >
              {contextMenu.message.pinned ? "Открепить" : "Закрепить сообщение"}
              <Icon name="pin" size={18} />
            </button>
          )}
          {!contextMenu.message.thread_id && room?.can_thread && (
            <button
              role="menuitem"
              onClick={() => {
                const t = threads.find((t) => t.root_id === contextMenu.message.id);
                if (t) setThreadID(t.id);
                else {
                  beginThread(contextMenu.message);
                }
                setContextMenu(null);
              }}
            >
              Создать ветку
              <Icon name="thread" size={18} />
            </button>
          )}
          <button
            role="menuitem"
            disabled={!messages.length || busy}
            onClick={() => {
              void action(markRead);
              setContextMenu(null);
            }}
          >
            Отметить прочитанным
            <Icon name="check" size={18} />
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const url = new URL(location.href);
              url.hash = routeHash({
                ...route,
                room: roomID,
                kind: roomKind,
                message: contextMenu.message.id,
                thread: contextMenu.message.thread_id,
              });
              void action(async () => {
                await navigator.clipboard.writeText(url.toString());
                setNotice("Ссылка скопирована.");
              });
              setContextMenu(null);
            }}
          >
            Копировать ссылку
            <Icon name="link" size={18} />
          </button>
          {(contextMenu.message.author_id === userID || room?.can_manage) && (
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setDeleting(contextMenu.message);
                setContextMenu(null);
              }}
            >
              Удалить сообщение
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      )}
      {deleting && (
        <Modal
          title="Удалить сообщение"
          onClose={() => setDeleting(null)}
          className="confirm-dialog"
        >
          <p>Удалить сообщение? Это действие нельзя отменить.</p>
          <blockquote>
            <MentionText
              content={deleting.content}
              mentions={deleting.mentions}
              targets={targets}
            />
          </blockquote>
          {error && (
            <p role="alert" className="id-error">
              {error}
            </p>
          )}
          <footer>
            <button disabled={busy} onClick={() => setDeleting(null)}>
              Отмена
            </button>
            <button
              className="danger-solid"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  accept([
                    await api<ChatMessage>(`/messages/${deleting.id}?${context}`, "DELETE", {
                      revision: deleting.revision,
                    }),
                  ]);
                  setDeleting(null);
                })
              }
            >
              Удалить
            </button>
          </footer>
        </Modal>
      )}
      <header className="chat-header">
        <div>
          <ChatRoomIcon
            kind={roomKind}
            voice={roomPresentation.voiceChat}
            thread={!!threadID}
            size={roomPresentation.voiceChat ? 20 : 24}
          />
          <h3>{activeThread ? activeThread.name : (title ?? room?.name ?? "Переписка")}</h3>
          {status !== "На связи" && (
            <p
              className={`chat-connection ${status === "На связи" ? "is-online" : ""}`}
              role="status"
            >
              {status}
            </p>
          )}
        </div>
        {threadID && (
          <nav className="chat-thread-header-tools" aria-label="Действия ветки">
            {activeThread && (activeThread.creator_id === userID || room?.can_manage) && (
              <details className="thread-actions-menu action-menu">
                <summary aria-label="Настройки ветки" title="Настройки ветки">
                  <Icon name="more" />
                </summary>
                <div>
                  <button
                    disabled={busy}
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      void action(async () => {
                        const t = await api<ChatThread>(
                          `/threads/${threadID}?${context}`,
                          "PATCH",
                          {
                            revision: activeThread.revision,
                            archived: !activeThread.archived,
                          },
                        );
                        setThreads((old) => old.map((v) => (v.id === t.id ? t : v)));
                      });
                    }}
                  >
                    {activeThread.archived ? "Открыть ветку" : "Архивировать ветку"}
                  </button>
                </div>
              </details>
            )}
            <button
              aria-label="Закрыть ветку"
              title="Закрыть ветку"
              onClick={() => {
                setThreadID("");
                setReply(null);
              }}
            >
              <Icon name="close" />
            </button>
          </nav>
        )}
        {!threadID && notifications.enabled && read.unread > 0 && (
          <span className="chat-unread">{read.unread} непрочитанных</span>
        )}
      </header>
      {threadID && activeThread && (
        <button
          type="button"
          className="chat-thread-origin"
          disabled={!threadOrigin}
          onClick={() => {
            if (!threadOrigin) return;
            navigate({ ...route, thread: undefined, message: threadOrigin.id });
          }}
          title={threadOrigin ? "Перейти к исходному сообщению" : undefined}
        >
          <Icon name="reply" size={16} />
          <span>
            <strong>Ветка от сообщения {threadOrigin ? author(threadOrigin.author_id) : "…"}</strong>
            <small>{threadOrigin?.deleted ? "Сообщение удалено" : threadOrigin?.content || "Загрузка сообщения…"}</small>
          </span>
        </button>
      )}
      <div className="chat-toolbar chat-header-tools">
        {!threadID && (
          <details className="chat-threads-picker">
            <summary aria-label="Ветки" title="Ветки">
              <Icon name="thread" />
            </summary>
            <section className="chat-threads-popover" aria-label="Ветки">
              <header>
                <h4>Ветки</h4>
              </header>
              <input
                aria-label="Поиск по названию ветки"
                placeholder="Поиск по названию ветки"
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
              />
              <div className="chat-thread-results">
                {threads
                  .filter((t) =>
                    t.name.toLocaleLowerCase().includes(threadSearch.toLocaleLowerCase()),
                  )
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={(e) => {
                        e.currentTarget.closest("details")?.removeAttribute("open");
                        setThreadID(t.id);
                      }}
                    >
                      <Icon name="thread" />
                      <span>
                        <strong>{t.name}</strong>
                        {t.archived && <small>В архиве</small>}
                      </span>
                      <Icon name="arrow" size={16} />
                    </button>
                  ))}
                {!threads.length && (
                  <div className="chat-threads-empty">
                    <Icon name="thread" size={48} />
                    <h4>Нет веток</h4>
                  </div>
                )}
                {!!threads.length &&
                  !threads.some((t) =>
                    t.name.toLocaleLowerCase().includes(threadSearch.toLocaleLowerCase()),
                  ) && <p>Ничего не найдено</p>}
              </div>
            </section>
          </details>
        )}
        {!threadID && roomKind === "channel" && (
          <details className="chat-notification-menu">
            <summary aria-label="Уведомления канала" title="Уведомления канала">
              <Icon name="bell" />
            </summary>
            <div className="chat-notification-popup">
              <NotificationRuleEditor
                key={roomID}
                scope="channel"
                id={roomID}
                label="Уведомления канала"
              />
            </div>
          </details>
        )}
        <button
          ref={pinsButtonRef}
          aria-label="Закреплённое"
          title="Закреплённые сообщения"
          disabled={busy || !room}
          onClick={() => void action(loadPins)}
        >
          <Icon name="pin" />
        </button>
        {roomKind !== "channel" && (
          <details>
            <summary
              aria-label={`Участники · ${room?.members.length ?? 0}`}
              title="Участники переписки"
            >
              <Icon name="users" />
            </summary>
            <div className="chat-members">
              {room?.members.map((m) => (
                <div key={m.id}>
                  <span className={presence.includes(m.id) ? "online-dot" : "offline-dot"} />
                  {m.name}
                  {m.id === userID ? " (вы)" : ""}
                </div>
              ))}
            </div>
          </details>
        )}
        {roomKind !== "channel" && (
          <button
            aria-label="Отметить прочитанным"
            title="Отметить прочитанным"
            disabled={!messages.length || busy}
            onClick={() => void action(markRead)}
          >
            <Icon name="check" />
          </button>
        )}
        {!threadID && <SearchBox />}
      </div>
      {(error || connectionError || threadError) && (
        <p className="id-error" role="alert">
          {error || connectionError || threadError}{" "}
          <button
            onClick={() => {
              setError("");
              sequence.current = null;
              setMessages([]);
              setCursors({});
              setAttempt((n) => n + 1);
            }}
          >
            Синхронизировать
          </button>
        </p>
      )}
      {notice && (
        <p className="chat-copy-notice" role="status">
          <Icon name="check" size={18} /> {notice}
        </p>
      )}
      {room && !room.can_send && (
        <p className="chat-policy">У вас нет прав отправлять сообщения в эту переписку.</p>
      )}
      {pins && (
        <section
          className="chat-panel chat-pins"
          aria-label="Закреплённые сообщения"
          ref={pinsRef}
          style={{ right: pinsRight }}
        >
          <div className="chat-pins-heading">
            <h4>Закреплённые сообщения</h4>
            <button
              aria-label="Закрыть закреплённое"
              title="Закрыть закреплённое"
              onClick={() => setPins(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          {pins.length ? (
            pins.map((m) => messageCard(m, true))
          ) : (
            <div className="chat-pins-empty">
              <Icon name="pin" size={64} />
              <p>В этом канале пока нет закреплённых сообщений.</p>
            </div>
          )}
        </section>
      )}
      {linked && !linkedInHistory && (
        <section
          className="chat-panel linked-message-panel"
          aria-label="Сообщение по ссылке"
          tabIndex={-1}
        >
          <div className="chat-toolbar">
            <h4>Исходное сообщение</h4>
            <button
              aria-label="Закрыть сообщение"
              onClick={() => {
                setLinked(null);
                navigate({ ...route, message: undefined }, true);
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {messageCard(linked, true)}
        </section>
      )}
      <div
        className="chat-history"
        aria-label="История сообщений"
        ref={historyElement}
        tabIndex={0}
        onLoadCapture={() => {
          const el = historyElement.current;
          if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
        }}
        onScroll={(e) => {
          const v = e.currentTarget;
          stickToBottom.current = v.scrollHeight - v.scrollTop - v.clientHeight < 80;
          if (!stickToBottom.current && ceiling === null && visible.length)
            setCeiling(visible.at(-1)!.ordinal);
        }}
      >
        {(cursors[threadID] || windowed.older) && (
          <button
            className="chat-older"
            disabled={busy}
            onClick={() => void action(() => history(true))}
          >
            Более ранние сообщения
          </button>
        )}
        {!visible.length && !room && <Skeleton />}
        {!visible.length && room && (
          <div className="chat-empty">
            <span className="chat-empty-icon">
              <ChatRoomIcon kind={roomKind} voice={roomPresentation.voiceChat} size={40} />
            </span>
            <h2>
              {threadID
                ? (activeThread?.name ?? "Ветка обсуждения")
                : roomKind === "channel"
                  ? roomPresentation.welcome
                  : (title ?? room?.name ?? "Новая переписка")}
            </h2>
            {roomPresentation.description && <p>{roomPresentation.description}</p>}
          </div>
        )}
        {visible.map((m, index) => (
          <Fragment key={m.id}>
            {(!visible[index - 1] ||
              dateLabel(visible[index - 1].created_at) !== dateLabel(m.created_at)) && (
              <div
                className="chat-date-divider"
                role="separator"
                aria-label={dateLabel(m.created_at)}
              >
                <span>{dateLabel(m.created_at)}</span>
              </div>
            )}
            {messageCard(m, false, groupMessage(m, visible[index - 1]))}
          </Fragment>
        ))}
        {pending
          .filter((p) => (p.input.thread_id ?? "") === threadID)
          .map((p) => (
            <article className={`chat-pending ${p.state}`} key={p.input.client_id}>
              <p className="chat-text">
                <MentionText
                  content={p.input.content}
                  mentions={p.input.mentions}
                  targets={targets}
                />
              </p>
              <small>{p.state === "pending" ? "Отправляем…" : p.error}</small>
              {p.state === "failed" && (
                <button onClick={() => void send(p.input, p.draftVersion)}>
                  Повторить отправку
                </button>
              )}
            </article>
          ))}
      </div>
      {windowed.newer && (
        <div className="chat-page-navigation">
          <button
            onClick={() => {
              stickToBottom.current = false;
              setCeiling(allVisible[Math.min(allVisible.length - 1, windowed.end + 49)].ordinal);
              historyElement.current?.scrollTo(0, 0);
            }}
          >
            Следующие сообщения
          </button>
          <button
            onClick={() => {
              stickToBottom.current = true;
              setCeiling(null);
            }}
          >
            К последним сообщениям
          </button>
        </div>
      )}
      <div className={`chat-typing ${typing.length ? "has-typing" : "is-idle"}`} aria-live="polite">
        {typing.length ? (
          <>
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {`${typing.map(author).join(", ")} печатает…`}
          </>
        ) : (
          " "
        )}
      </div>
      {threadRoot &&
        draftHost.current &&
        createPortal(
          <section
            className="thread-create-pane"
            aria-label="Новая ветка"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.preventDefault();
                e.stopPropagation();
                setThreadRoot(null);
              }
            }}
          >
            <header>
              <Icon name="thread" />
              <h3>Новая ветка</h3>
              <button
                aria-label="Закрыть новую ветку"
                title="Закрыть"
                disabled={busy}
                onClick={() => setThreadRoot(null)}
              >
                <Icon name="close" />
              </button>
            </header>
            {error && (
              <p className="id-error" role="alert">
                {error}
              </p>
            )}
            <form
              className="thread-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const t = await api<ChatThread>(
                    `/messages/${threadRoot.id}/threads?${context}`,
                    "POST",
                    { name: threadName },
                  );
                  setThreads((old) => [...old.filter((v) => v.id !== t.id), t]);
                  setThreadRoot(null);
                  setThreadID(t.id);
                });
              }}
            >
              <label>
                Название ветки
                <input
                  autoFocus
                  value={threadName}
                  onChange={(e) => setThreadName(e.target.value)}
                  required
                  maxLength={80}
                />
              </label>
              <blockquote className="thread-source-message">
                <strong>{author(threadRoot.author_id)}</strong>
                <p>
                  <MentionText
                    content={threadRoot.content}
                    mentions={threadRoot.mentions}
                    targets={targets}
                  />
                </p>
              </blockquote>
              <footer>
                <button className="id-primary" type="submit" disabled={busy || !threadName.trim()}>
                  Создать ветку
                </button>
              </footer>
            </form>
          </section>,
          draftHost.current,
        )}
      <form className="chat-composer has-inline-mentions" onSubmit={submit}>
        <UploadPicker
          context={context}
          files={files}
          setFiles={setFiles}
          disabled={!room?.can_attach || !room.can_send || !!activeThread?.archived}
        />
        {reply && (
          <div className="chat-reply-preview">
            <span>
              Ответ пользователю <strong>{author(reply.author_id)}</strong>
            </span>
            <button
              type="button"
              aria-label="Отменить ответ"
              title="Отменить ответ"
              onClick={() => setReply(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="chat-composer-label">
          <MentionComposer
            label="Сообщение"
            placeholder={activeThread?.archived ? "Ветка в архиве" : roomPresentation.placeholder}
            value={content}
            targets={targets}
            avatars={avatars}
            disabled={!room?.can_send || activeThread?.archived}
            onChange={(value) => {
              setContent(value);
              setMentions(contentMentions(value, targets));
            }}
            onTyping={() => {
              if (
                Date.now() - typingAt.current > 3000 &&
                ws.current?.readyState === WebSocket.OPEN
              ) {
                typingAt.current = Date.now();
                ws.current.send(
                  JSON.stringify({
                    op: "typing",
                    schema_version: 1,
                    request_id: requestID(),
                  }),
                );
              }
            }}
          />
        </div>
        <div className="chat-compose-footer">
          {Array.from(content).length > 3800 && <small>{Array.from(content).length} / 4000</small>}
          <button
            className="id-primary"
            aria-label="Отправить"
            title="Отправить"
            type="submit"
            disabled={
              (!content.trim() && !files.some((v) => v.upload?.state === "READY" && !v.error)) ||
              Array.from(content).length > 4000 ||
              contentMentions(content, targets).length > 20 ||
              !room?.can_send ||
              activeThread?.archived
            }
          >
            <Icon name="send" />
          </button>
        </div>
      </form>
    </section>
  );
}
