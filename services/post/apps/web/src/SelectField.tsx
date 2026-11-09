import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { SelectLabel } from "./SelectLabel";
import {
  selectEdge,
  selectKeyIntent,
  selectPlacement,
  selectStep,
  selectTypeahead,
  type SelectOption,
} from "./select-field-state";
import "./select-field.css";

export function SelectField({
  id,
  name,
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
}: {
  id?: string;
  name?: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const generatedID = useId();
  const listID = `${id ?? generatedID}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [focusMode, setFocusMode] = useState<"keyboard" | "pointer" | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof selectPlacement> | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const current = options.findIndex((option) => option.value === value);
  const unavailable = disabled || selectEdge(options, "first") < 0;
  const usable = () => !unavailable && !trigger.current?.matches(":disabled");
  function place() {
    const anchor = trigger.current;
    if (anchor)
      setPosition(
        selectPlacement(
          anchor.getBoundingClientRect(),
          { width: innerWidth, height: innerHeight },
          options.length,
        ),
      );
  }
  function show(index = current, keyboard = false) {
    if (!usable()) return;
    typed.current = { text: "", at: 0 };
    setActive(index >= 0 && !options[index]?.disabled ? index : selectEdge(options, "first"));
    setFocusMode(keyboard ? "keyboard" : null);
    place();
    setOpen(true);
  }
  function commit(index: number, focus = false) {
    if (!usable()) return;
    const option = options[index];
    if (option && !option.disabled && option.value !== value) onChange(option.value);
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    setHost(trigger.current?.closest<HTMLElement>("details, dialog") ?? document.body);
  }, []);
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  useEffect(() => {
    if (open && (!options[active] || options[active].disabled))
      setActive(selectEdge(options, "first"));
  }, [open, active, options]);
  useLayoutEffect(() => {
    if (!open || !host || !panel.current) return;
    const popup = panel.current;
    if (typeof popup.showPopover === "function") popup.showPopover();
    const reposition = (event?: Event) => {
      if (event?.target instanceof Node && popup.contains(event.target)) return;
      const anchor = trigger.current;
      if (anchor)
        setPosition(
          selectPlacement(
            anchor.getBoundingClientRect(),
            { width: innerWidth, height: innerHeight },
            options.length,
          ),
        );
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, host, options.length]);
  useLayoutEffect(() => {
    if (!open) return;
    const row = panel.current?.querySelector<HTMLElement>(`[data-select-index="${active}"]`);
    const scroll = scroller.current;
    if (!row || !scroll) return;
    if (row.offsetTop < scroll.scrollTop) scroll.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > scroll.scrollTop + scroll.clientHeight)
      scroll.scrollTop = row.offsetTop + row.offsetHeight - scroll.clientHeight;
  }, [active, open, position?.height]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        trigger.current?.contains(event.target) ||
        Array.from(trigger.current?.labels ?? []).some((label) =>
          label.contains(event.target as Node),
        ) ||
        panel.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!usable()) return;
    const key = event.key;
    const intent = selectKeyIntent(key, open);
    if (intent === "cancel") {
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      setOpen(false);
      return;
    }
    if (open && event.altKey && key === "ArrowUp") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (intent === "commit" || intent === "open") {
      event.preventDefault();
      if (intent === "commit") commit(active);
      else show(current, true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(key)) {
      event.preventDefault();
      setFocusMode("keyboard");
      if (key === "Home" || key === "End") {
        const next = selectEdge(options, key === "Home" ? "first" : "last");
        if (open) setActive(next);
        else show(next, true);
      } else if (!open) show(key === "ArrowUp" ? selectEdge(options, "first") : current, true);
      else
        setActive(
          selectStep(
            options,
            active,
            key === "PageDown" ? 10 : key === "PageUp" ? -10 : key === "ArrowDown" ? 1 : -1,
          ),
        );
      return;
    }
    if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const next = selectTypeahead(
        options,
        open ? active : current,
        open ? typed.current : { text: "", at: 0 },
        key,
        Date.now(),
      );
      if (!open) show(next.index, true);
      else {
        setActive(next.index);
        setFocusMode("keyboard");
      }
      typed.current = { text: next.text, at: next.at };
    }
  }
  const popup = open && host && position && (
    <div
      ref={panel}
      className="select-field-popup"
      popover="manual"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
      }}
      data-side={position.side}
      onMouseLeave={() => {
        if (focusMode === "pointer") setFocusMode(null);
      }}
    >
      <div
        ref={scroller}
        id={listID}
        role="listbox"
        aria-label={label}
        className="select-field-options"
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${listID}-${index}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            data-active={focusMode && index === active ? "true" : undefined}
            data-select-index={index}
            onMouseMove={() => {
              if (!option.disabled) {
                setActive(index);
                setFocusMode("pointer");
              }
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => commit(index, true)}
          >
            <SelectLabel text={option.label} active={!!focusMode && index === active} />
            {option.value === value && <Icon name="check" size={20} />}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <span className="select-field">
      <button
        ref={trigger}
        id={id ?? generatedID}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required || undefined}
        aria-controls={open ? listID : undefined}
        aria-activedescendant={open && active >= 0 ? `${listID}-${active}` : undefined}
        disabled={unavailable}
        onKeyDown={keyDown}
        onClick={() => {
          if (open) setOpen(false);
          else show();
        }}
        onBlur={(event) => {
          if (open && !panel.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span>{options[current]?.label ?? "Выберите…"}</span>
        <Icon name="down" size={24} />
      </button>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      {popup && createPortal(popup, host!)}
    </span>
  );
}
