import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { GuildCategory, GuildChannel } from "../../../packages/contracts/generated/ts/models";
import {
  canApplyResourceOrder,
  planResourceMove,
  sortResources,
  type OrderItem,
  type OrderTarget,
} from "./channel-order";
import { Icon } from "./Icons";
import "./channel-order.css";

type Options = {
  scope: string;
  revision: number;
  channels: GuildChannel[];
  categories: GuildCategory[];
  permissions: string[];
  disabled: boolean;
  onMove: (item: OrderItem, target: OrderTarget, revision: number) => void;
  onExpand: (id: string) => void;
};
type Marker = { x: number; y: number; width: number; height: number };
type Session = {
  item: OrderItem;
  scope: string;
  revision: number;
  label: string;
  pointer: number;
  source: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: OrderTarget | null;
};
type Visual = {
  item: OrderItem;
  label: string;
  x: number;
  y: number;
  marker: Marker | null;
  inside: boolean;
};

export function useChannelDrag(options: Options) {
  const current = useRef(options);
  current.current = options;
  const session = useRef<Session | null>(null);
  const suppressUntil = useRef(0);
  const [visual, setVisual] = useState<Visual | null>(null);
  const stop = useRef<() => void>(() => {});

  useEffect(() => {
    let frame = 0;
    let expanding = "";
    let expandTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      const s = session.current;
      session.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(expandTimer);
      expanding = "";
      if (s?.source.hasPointerCapture(s.pointer)) s.source.releasePointerCapture(s.pointer);
      if (s?.active) suppressUntil.current = Date.now() + 250;
      document.body.classList.remove("guild-tree-dragging");
      setVisual(null);
    };
    stop.current = finish;
    const update = () => {
      const s = session.current;
      if (!s?.active) return;
      if (document.querySelector("dialog[open]")) {
        finish();
        return;
      }
      const root = document.getElementById("channel-tree");
      let target: OrderTarget | null = null;
      let marker: Marker | null = null;
      const hit = document.elementFromPoint(s.x, s.y);
      if (root && hit && root.contains(hit)) {
        const category = hit.closest<HTMLElement>(".guild-category[data-category-id]");
        const row = hit
          .closest<HTMLElement>(".channel-entry")
          ?.querySelector<HTMLElement>("[data-order-kind=channel]");
        if (s.item.kind === "category" && category?.dataset.categoryId) {
          const rect = category.getBoundingClientRect();
          const edge = s.y < rect.top + rect.height / 2 ? "before" : "after";
          target = { kind: "category", id: category.dataset.categoryId, edge };
          marker = {
            x: rect.left + 8,
            y: edge === "before" ? rect.top : rect.bottom,
            width: rect.width - 16,
            height: 2,
          };
        } else if (s.item.kind === "channel" && row) {
          const rect = row.getBoundingClientRect();
          const edge = s.y < rect.top + rect.height / 2 ? "before" : "after";
          target = { kind: "channel", id: row.dataset.orderId!, edge };
          marker = {
            x: rect.left + 4,
            y: edge === "before" ? rect.top : rect.bottom,
            width: rect.width - 8,
            height: 2,
          };
        } else if (s.item.kind === "channel" && category) {
          const rect = category.querySelector("header")!.getBoundingClientRect();
          target = { kind: "category", id: category.dataset.categoryId ?? "", edge: "inside" };
          marker = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }
      }
      if (target) {
        const o = current.current;
        const plan = planResourceMove(o.categories, o.channels, s.item, target);
        if (!plan || !canApplyResourceOrder(o.permissions, o.categories, o.channels, plan)) {
          target = null;
          marker = null;
        }
      }
      const expand = target?.edge === "inside" ? target.id : "";
      if (expand !== expanding) {
        clearTimeout(expandTimer);
        expanding = expand;
        if (expand) expandTimer = setTimeout(() => current.current.onExpand(expand), 550);
      }
      s.target = target;
      setVisual({
        item: s.item,
        label: s.label,
        x: Math.min(Math.max(8, s.x + 14), window.innerWidth - 228),
        y: Math.min(s.y + 12, window.innerHeight - 44),
        marker,
        inside: target?.edge === "inside",
      });
    };
    const scroll = () => {
      const s = session.current;
      if (!s?.active) return;
      if (document.querySelector("dialog[open]")) {
        finish();
        return;
      }
      const root = document.getElementById("channel-tree");
      if (root) {
        const rect = root.getBoundingClientRect();
        if (s.x >= rect.left && s.x <= rect.right) {
          const distance =
            s.y < rect.top + 40
              ? s.y - rect.top - 40
              : s.y > rect.bottom - 40
                ? s.y - rect.bottom + 40
                : 0;
          if (distance) {
            root.scrollTop += Math.max(-14, Math.min(14, distance / 3));
            update();
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      const s = session.current;
      if (!s || s.pointer !== event.pointerId) return;
      s.x = event.clientX;
      s.y = event.clientY;
      if (!s.active && Math.hypot(s.x - s.startX, s.y - s.startY) < 6) return;
      if (!s.active) {
        s.active = true;
        document.body.classList.add("guild-tree-dragging");
        frame = requestAnimationFrame(scroll);
      }
      event.preventDefault();
      update();
    };
    const up = (event: PointerEvent) => {
      const s = session.current;
      if (!s || s.pointer !== event.pointerId) return;
      if (document.querySelector("dialog[open]")) {
        finish();
        return;
      }
      if (s.active) event.preventDefault();
      const target = s.target;
      finish();
      if (s.active && target && s.scope === current.current.scope)
        current.current.onMove(s.item, target, s.revision);
    };
    const cancel = (event: PointerEvent) => {
      if (session.current?.pointer === event.pointerId) finish();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.current) {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", cancel);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", finish);
    return () => {
      finish();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", finish);
    };
  }, []);
  useEffect(() => {
    const s = session.current;
    if (s && (s.scope !== options.scope || s.revision !== options.revision || options.disabled))
      stop.current();
  }, [options.scope, options.revision, options.disabled]);

  const enabled = (item: OrderItem) =>
    !options.disabled &&
    (item.kind === "channel" ? options.channels : options.categories)
      .find((row) => row.id === item.id)
      ?.permissions.includes("MANAGE_CHANNEL");
  function start(event: ReactPointerEvent<HTMLElement>, item: OrderItem, handle = false) {
    if (
      session.current ||
      !event.isPrimary ||
      !enabled(item) ||
      event.button !== 0 ||
      (event.pointerType === "touch" && !handle)
    )
      return;
    const row = (item.kind === "channel" ? options.channels : options.categories).find(
      (row) => row.id === item.id,
    )!;
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      item,
      scope: options.scope,
      revision: options.revision,
      label: row.name,
      pointer: event.pointerId,
      source: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      target: null,
    };
  }
  function keyboard(event: ReactKeyboardEvent<HTMLElement>, item: OrderItem) {
    if (!enabled(item) || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const channel = options.channels.find((row) => row.id === item.id);
    const rows = sortResources(
      item.kind === "category"
        ? options.categories
        : options.channels.filter(
            (row) => (row.category_id ?? "") === (channel?.category_id ?? ""),
          ),
    );
    const index = rows.findIndex((row) => row.id === item.id);
    const neighbor = rows[index + (event.key === "ArrowUp" ? -1 : 1)];
    event.preventDefault();
    if (neighbor)
      options.onMove(
        item,
        { kind: item.kind, id: neighbor.id, edge: event.key === "ArrowUp" ? "before" : "after" },
        options.revision,
      );
  }
  return {
    active: visual?.item,
    enabled,
    start,
    keyboard,
    suppressClick: () => Date.now() < suppressUntil.current,
    layer: visual
      ? createPortal(
          <div className="guild-tree-drag-layer" aria-hidden="true">
            {visual.marker && (
              <div
                className={`guild-tree-drop-marker ${visual.inside ? "is-inside" : ""}`}
                style={{
                  left: visual.marker.x,
                  top: visual.marker.y,
                  width: visual.marker.width,
                  height: visual.marker.height,
                }}
              />
            )}
            <div className="guild-tree-drag-preview" style={{ left: visual.x, top: visual.y }}>
              <Icon
                name={
                  visual.item.kind === "category"
                    ? "down"
                    : options.channels.find((c) => c.id === visual.item.id)?.kind === "VOICE"
                      ? "speaker"
                      : "hash"
                }
                size={20}
              />
              <span>{visual.label}</span>
            </div>
          </div>,
          document.body,
        )
      : null,
  };
}
