import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icons";
import { selectTypeahead } from "./select-field-state";
import { SelectLabel } from "./SelectLabel";

export type VoiceDeviceOption = { value: string; label: string };

export function voiceDeviceMenuPosition(
  anchor: { left: number; right: number; top: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  parentBottom: number,
) {
  const safeBottom = Math.min(viewport.height - 8, parentBottom);
  const maxHeight = Math.max(0, safeBottom - 8);
  const height = Math.min(menu.height, maxHeight);
  const beside =
    anchor.right + 4 + menu.width <= viewport.width - 8
      ? anchor.right + 4
      : anchor.left - menu.width - 4;
  return {
    left: Math.max(8, Math.min(beside, viewport.width - menu.width - 8)),
    top: Math.max(8, Math.min(anchor.top - 9, safeBottom - height)),
    maxHeight,
  };
}

export function voiceDeviceOptions(
  devices: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
  kind: MediaDeviceKind,
  fallback: string,
): VoiceDeviceOption[] {
  const seen = new Set([""]);
  const options: VoiceDeviceOption[] = [{ value: "", label: "По умолчанию" }];
  devices
    .filter((device) => device.kind === kind)
    .forEach((device, index) => {
      if (seen.has(device.deviceId)) return;
      seen.add(device.deviceId);
      options.push({ value: device.deviceId, label: device.label || `${fallback} ${index + 1}` });
    });
  return options;
}

export function VoiceDeviceChoice({
  label,
  value,
  options,
  open,
  setOpen,
  onChange,
  icon,
}: {
  label: string;
  value: string;
  options: VoiceDeviceOption[];
  open: boolean;
  setOpen: (value: boolean) => void;
  onChange: (value: string) => void;
  icon?: "mic" | "headphones" | "camera";
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const typed = useRef({ text: "", at: 0 });
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight?: number }>({
    left: 0,
    top: 0,
  });
  const current = options.findIndex((option) => option.value === value);
  function show(focus = true) {
    focusOnOpen.current = focus;
    typed.current = { text: "", at: 0 };
    setActive(Math.max(0, current));
    setOpen(true);
    if (open && focus)
      popup.current
        ?.querySelector<HTMLElement>(`[data-device-option="${Math.max(0, current)}"]`)
        ?.focus();
  }
  function close(restore = false) {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const menu = popup.current;
    if (typeof menu.showPopover === "function") menu.showPopover();
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const rect = menu.getBoundingClientRect();
      const parentBottom =
        trigger.current?.closest(".voice-devices")?.getBoundingClientRect().bottom ??
        innerHeight - 8;
      setPosition(
        voiceDeviceMenuPosition(
          anchor,
          rect,
          { width: innerWidth, height: innerHeight },
          parentBottom,
        ),
      );
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(menu);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
      if (typeof menu.hidePopover === "function" && menu.matches(":popover-open"))
        menu.hidePopover();
    };
  }, [open]);
  useLayoutEffect(() => {
    if (open && focusOnOpen.current)
      popup.current?.querySelector<HTMLElement>(`[data-device-option="${active}"]`)?.focus();
  }, [open, active]);
  useEffect(() => {
    if (active >= options.length) setActive(Math.max(0, options.length - 1));
  }, [active, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        popup.current?.contains(event.target) ||
        trigger.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, setOpen]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      focusOnOpen.current = true;
      setActive(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (active + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length,
      );
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      const next = selectTypeahead(options, active, typed.current, event.key, Date.now());
      focusOnOpen.current = true;
      setActive(next.index);
      typed.current = { text: next.text, at: next.at };
    }
  }
  return (
    <div
      className="voice-device-choice"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        data-voice-device-trigger
        aria-label={`${label}: ${options[current]?.label ?? "Недоступно"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") show(false);
        }}
        onClick={() => show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            show();
          } else if (open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <span>
          <span>{label}</span>
          <small>{options[current]?.label ?? "Недоступно"}</small>
        </span>
        <Icon name="down" size={20} />
      </button>
      {open && (
        <div
          ref={popup}
          id={id}
          role="menu"
          aria-label={label}
          popover="manual"
          className="voice-device-submenu"
          style={position}
          onKeyDown={keyDown}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={index === active ? 0 : -1}
              data-device-option={index}
              onFocus={() => setActive(index)}
              onPointerEnter={() => setActive(index)}
              onClick={() => {
                if (option.value !== value) onChange(option.value);
                close(true);
              }}
            >
              {icon && <Icon name={icon} size={20} />}
              <SelectLabel text={option.label} active={index === active} />
              <span className="voice-device-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
