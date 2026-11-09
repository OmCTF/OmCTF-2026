import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyMentionInput,
  atomicSelection,
  contentMentions,
  filterMentionTargets,
  mentionKey,
  mentionDisplayTargets,
  mentionQuery,
  mentionToken,
  projectMentions,
  rawOffset,
  replaceMentionRange,
  type MentionTarget,
} from "./chat-mentions";
import "./mention-composer.css";

type Snapshot = { content: string; caret: number };
type Props = {
  value: string;
  targets: MentionTarget[];
  avatars?: Record<string, string>;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onTyping?: () => void;
  onCancel?: () => void;
};

function fitComposer(input: HTMLTextAreaElement) {
  const minimum = parseFloat(getComputedStyle(input).minHeight) || 50;
  const previousScroll = input.scrollTop;
  const followCaret =
    document.activeElement === input &&
    input.selectionStart === input.value.length &&
    input.selectionEnd === input.value.length;
  input.style.height = "0px";
  input.style.height = `${Math.min(240, Math.max(minimum, input.scrollHeight))}px`;
  input.scrollTop = followCaret
    ? Math.max(0, input.scrollHeight - input.clientHeight)
    : previousScroll;
}

export function MentionComposer({
  value,
  targets,
  avatars = {},
  label,
  placeholder,
  disabled,
  autoFocus,
  onChange,
  onTyping,
  onCancel,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listID = useId();
  const displayTargets = useMemo(() => mentionDisplayTargets(value, targets), [value, targets]);
  const projection = useMemo(() => projectMentions(value, displayTargets), [value, displayTargets]);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [composingText, setComposingText] = useState<string | null>(null);
  const composing = useRef(false);
  const compositionBase = useRef(value);
  const compositionSelection = useRef({ start: 0, end: 0 });
  const beforeInputSelection = useRef<{ start: number; end: number } | undefined>(undefined);
  const pendingCaret = useRef<number | null>(null);
  const history = useRef<{ items: Snapshot[]; index: number; current: string }>({
    items: [{ content: value, caret: 0 }],
    index: 0,
    current: value,
  });
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const [pasteError, setPasteError] = useState("");
  const query =
    !disabled && focused && composingText === null
      ? mentionQuery(projection, selection.start, selection.end)
      : null;
  const queryKey = query ? `${query.start}:${query.end}:${query.query}` : "";
  const existing = contentMentions(value, targets);
  const options = query
    ? filterMentionTargets(targets, query.query).filter(
        (target) =>
          existing.length < 20 ||
          existing.some((mention) => mentionKey(mention) === mentionKey(target)),
      )
    : [];
  const open = !!query && dismissed !== queryKey;
  const selected = Math.min(active, Math.max(0, options.length - 1));

  const syncMirror = () => {
    if (!input.current || !mirror.current) return;
    mirror.current.scrollTop = input.current.scrollTop;
    mirror.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    if (history.current.current !== value) {
      history.current = {
        items: [{ content: value, caret: element.selectionStart }],
        index: 0,
        current: value,
      };
    }
    if (pendingCaret.current !== null && !composing.current) {
      element.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    fitComposer(element);
    syncMirror();
  }, [value, projection.text, composingText]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth) return;
      width = element.clientWidth;
      fitComposer(element);
      syncMirror();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    const update = () => {
      const anchor = input.current?.closest(".chat-composer") ?? input.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(rect.width, window.innerWidth - 16);
      const above = rect.top - 12;
      const below = window.innerHeight - rect.bottom - 12;
      const placeAbove = above >= 140 || above >= below;
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: placeAbove ? rect.top - 8 : rect.bottom + 8,
        width,
        maxHeight: Math.max(80, Math.min(320, placeAbove ? above : below)),
      });
      popup.current?.setAttribute("data-placement", placeAbove ? "above" : "below");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(input.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    const element = popup.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const list = element?.parentElement;
    if (!element || !list) return;
    if (element.offsetTop < list.scrollTop) list.scrollTop = element.offsetTop;
    if (element.offsetTop + element.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = element.offsetTop + element.offsetHeight - list.clientHeight;
  }, [selected, queryKey, open]);

  const commit = (next: Snapshot, record = true) => {
    if (record && next.content.length > 8000 && next.content.length > value.length) {
      setPasteError("Не более 4000 символов в сообщении.");
      return;
    }
    if (record && next.content !== value) {
      const current = history.current;
      current.items[current.index].caret = selection.start;
      current.items = [...current.items.slice(0, current.index + 1), next].slice(-100);
      current.index = current.items.length - 1;
    }
    history.current.current = next.content;
    pendingCaret.current = next.caret;
    setSelection({ start: next.caret, end: next.caret });
    setActive(0);
    setDismissed(null);
    setPasteError("");
    onChange(next.content);
    onTyping?.();
  };
  const choose = (target: MentionTarget) => {
    if (!query) return;
    const tail = projection.text.slice(query.end);
    const separator = /^\s/.test(tail) ? "" : " ";
    commit(
      replaceMentionRange(
        value,
        displayTargets,
        query.start,
        query.end,
        mentionToken(target) + separator,
      ),
    );
    input.current?.focus();
  };
  const updateSelection = (element: HTMLTextAreaElement) => {
    const next = { start: element.selectionStart, end: element.selectionEnd };
    setSelection((previous) =>
      previous.start === next.start && previous.end === next.end ? previous : next,
    );
  };

  return (
    <div className={`mention-editor${composingText !== null ? " is-composing" : ""}`}>
      <div className="mention-editor-mirror" ref={mirror} aria-hidden="true">
        {projection.parts.map((part) =>
          part.mention ? (
            <span
              className={`mention-composer-token${part.mention.unavailable ? " is-unavailable" : ""}`}
              key={part.rawStart}
            >
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
        {projection.text.endsWith("\n") ? "\n" : ""}
      </div>
      <textarea
        ref={input}
        aria-label={label}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={open ? listID : undefined}
        aria-activedescendant={open && options.length ? `${listID}-${selected}` : undefined}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        value={composingText ?? projection.text}
        maxLength={8000}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(null);
        }}
        onSelect={(event) => updateSelection(event.currentTarget)}
        onScroll={syncMirror}
        onBeforeInput={(event) => {
          beforeInputSelection.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
        }}
        onCompositionStart={(event) => {
          composing.current = true;
          compositionBase.current = value;
          compositionSelection.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
          beforeInputSelection.current = undefined;
          setComposingText(projection.text);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setComposingText(null);
          beforeInputSelection.current = undefined;
          commit(
            applyMentionInput(
              compositionBase.current,
              displayTargets,
              event.currentTarget.value,
              compositionSelection.current,
            ),
          );
        }}
        onChange={(event) => {
          if (composing.current) {
            setComposingText(event.currentTarget.value);
            return;
          }
          if (event.currentTarget.value === projection.text) {
            beforeInputSelection.current = undefined;
            updateSelection(event.currentTarget);
            return;
          }
          commit(
            applyMentionInput(
              value,
              displayTargets,
              event.currentTarget.value,
              beforeInputSelection.current,
            ),
          );
          beforeInputSelection.current = undefined;
        }}
        onCopy={(event) => {
          const element = event.currentTarget;
          if (element.selectionStart === element.selectionEnd) return;
          const range = atomicSelection(projection, element.selectionStart, element.selectionEnd);
          const canonical = value.slice(
            rawOffset(projection, range.start),
            rawOffset(projection, range.end),
          );
          event.preventDefault();
          event.clipboardData.setData(
            "text/plain",
            projectMentions(canonical, displayTargets).text,
          );
          event.clipboardData.setData("application/x-svyaz-message", canonical);
        }}
        onCut={(event) => {
          const element = event.currentTarget;
          if (element.selectionStart === element.selectionEnd) return;
          const range = atomicSelection(projection, element.selectionStart, element.selectionEnd);
          const canonical = value.slice(
            rawOffset(projection, range.start),
            rawOffset(projection, range.end),
          );
          event.preventDefault();
          event.clipboardData.setData(
            "text/plain",
            projectMentions(canonical, displayTargets).text,
          );
          event.clipboardData.setData("application/x-svyaz-message", canonical);
          commit(replaceMentionRange(value, displayTargets, range.start, range.end, ""));
        }}
        onPaste={(event) => {
          const element = event.currentTarget;
          const pasted = (
            event.clipboardData.getData("application/x-svyaz-message") ||
            event.clipboardData.getData("text/plain")
          ).replace(/\r\n?/g, "\n");
          if (!pasted && event.clipboardData.files.length) return;
          event.preventDefault();
          const next = replaceMentionRange(
            value,
            displayTargets,
            element.selectionStart,
            element.selectionEnd,
            pasted,
          );
          if (
            (next.content.length > 8000 && next.content.length > value.length) ||
            contentMentions(next.content, targets).length > 20
          ) {
            setPasteError("Не более 4000 символов и 20 упоминаний в сообщении.");
            return;
          }
          commit(next);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          const element = event.currentTarget;
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            const nextIndex = history.current.index + (event.shiftKey ? 1 : -1);
            if (nextIndex >= 0 && nextIndex < history.current.items.length) {
              history.current.index = nextIndex;
              commit(history.current.items[nextIndex], false);
            }
            return;
          }
          if (open && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(queryKey);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (options.length)
                setActive(
                  (selected + (event.key === "ArrowDown" ? 1 : options.length - 1)) %
                    options.length,
                );
              return;
            }
            if (options.length && !event.shiftKey) {
              event.preventDefault();
              choose(options[selected]);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              setDismissed(queryKey);
              return;
            }
          }
          if (
            ["Backspace", "Delete"].includes(event.key) &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey
          ) {
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const part = projection.parts.find(
              (part) =>
                part.mention &&
                (start === end
                  ? event.key === "Backspace"
                    ? start > part.start && start <= part.end
                    : start >= part.start && start < part.end
                  : start < part.end && end > part.start),
            );
            if (part) {
              event.preventDefault();
              commit(
                replaceMentionRange(
                  value,
                  displayTargets,
                  start === end ? part.start : start,
                  start === end ? part.end : end,
                  "",
                ),
              );
              return;
            }
          }
          if (
            ["ArrowLeft", "ArrowRight"].includes(event.key) &&
            !event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            element.selectionStart === element.selectionEnd
          ) {
            const caret = element.selectionStart;
            const part = projection.parts.find(
              (part) =>
                part.mention &&
                (event.key === "ArrowLeft"
                  ? caret > part.start && caret <= part.end
                  : caret >= part.start && caret < part.end),
            );
            if (part) {
              event.preventDefault();
              const next = event.key === "ArrowLeft" ? part.start : part.end;
              element.setSelectionRange(next, next);
              updateSelection(element);
              return;
            }
          }
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            element.form?.requestSubmit();
          }
        }}
      />
      {pasteError && (
        <span className="mention-input-error" role="status">
          {pasteError}
        </span>
      )}
      {open &&
        createPortal(
          <div
            className="mention-autocomplete"
            ref={popup}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <div className="mention-autocomplete-heading">Участники</div>
            <div role="listbox" aria-label="Участники и роли" id={listID}>
              {options.map((target, index) => (
                <div
                  key={mentionKey(target)}
                  id={`${listID}-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  className={`mention-option${target.kind === "role" ? " is-role" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(target)}
                >
                  <span
                    className={`mention-option-avatar ${target.kind === "role" ? "is-role" : (avatars[target.id] ?? "violet")}`}
                    aria-hidden="true"
                  >
                    {target.kind === "role" ? "@" : Array.from(target.name)[0]?.toUpperCase()}
                  </span>
                  <span className="mention-option-name">{target.name}</span>
                  {target.kind === "role" && <span className="mention-option-kind">Роль</span>}
                </div>
              ))}
              {!options.length && (
                <div className="mention-autocomplete-empty">
                  {existing.length >= 20
                    ? "Добавлено 20 упоминаний"
                    : "Участники и роли не найдены"}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
