import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { selectTypeahead } from "./select-field-state";

export const searchSortOptions = [
  { value: "newest", label: "По новизне" },
  { value: "oldest", label: "Самое старое" },
  { value: "relevance", label: "По релевантности" },
] as const;

export function SearchSort({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const typed = useRef({ text: "", at: 0 });
  const current = Math.max(
    0,
    searchSortOptions.findIndex((option) => option.value === value),
  );

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show(index = current) {
    typed.current = { text: "", at: 0 };
    setActive(index);
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const popup = menu.current;
    if (typeof popup.showPopover === "function") popup.showPopover();
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const rect = popup.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(anchor.right - rect.width, innerWidth - rect.width - 8)),
        top: Math.max(
          8,
          anchor.bottom + 8 + rect.height <= innerHeight - 8
            ? anchor.bottom + 8
            : anchor.top - rect.height - 8,
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-sort-index="${active}"]`)?.focus();
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        menu.current?.contains(event.target) ||
        trigger.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? searchSortOptions.length - 1
            : (active + (event.key === "ArrowDown" ? 1 : searchSortOptions.length - 1)) %
              searchSortOptions.length,
      );
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      const next = selectTypeahead(searchSortOptions, active, typed.current, event.key, Date.now());
      setActive(next.index);
      typed.current = { text: next.text, at: next.at };
    }
  }
  return (
    <span
      className="search-sort"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Сортировать"
        aria-describedby={`${id}-value`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            show(event.key === "ArrowUp" ? searchSortOptions.length - 1 : 0);
          }
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 21V3m-4 4 4-4 4 4m6-4v18m-4-4 4 4 4-4" />
        </svg>
        <span>Сортировать</span>
      </button>
      <span id={`${id}-value`} className="id-sr">
        {searchSortOptions[current].label}
      </span>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label="Сортировка результатов поиска"
          popover="manual"
          className="search-sort-menu"
          style={position}
          onKeyDown={keyDown}
        >
          {searchSortOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={index === active ? 0 : -1}
              data-sort-index={index}
              onFocus={() => setActive(index)}
              onClick={() => {
                onChange(option.value);
                close(true);
              }}
            >
              <span>{option.label}</span>
              <span className="search-sort-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
