import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type TouchEvent,
} from "react";
import type { PublicProfile } from "../../../packages/contracts/generated/ts/models";
import { Icon, type IconName } from "./Icons";
import { BrandMark } from "./Brand";
import {
  DEFAULT_SIDEBAR,
  clampSidebar,
  parseVisualPreferences,
  type VisualPreferences,
} from "./visual-state";

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  className = "",
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
    >
      <Icon name={icon} />
    </button>
  );
}

export function useAppearance(userID: string) {
  const key = `svyaz:appearance:${userID}`;
  const [appearance, setAppearance] = useState<VisualPreferences>(() => {
    try {
      return parseVisualPreferences(localStorage.getItem(key));
    } catch {
      return parseVisualPreferences(null);
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--user-sidebar-width", `${appearance.sidebar}px`);
    root.dataset.motion = appearance.reducedMotion ? "reduced" : "system";
    root.dataset.density = appearance.compact ? "compact" : "cozy";
    try {
      localStorage.setItem(key, JSON.stringify(appearance));
    } catch {
    }
  }, [appearance, key]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--user-sidebar-width");
      delete document.documentElement.dataset.motion;
      delete document.documentElement.dataset.density;
    },
    [],
  );
  return { appearance, setAppearance };
}

export function SidebarResize({
  width,
  onChange,
}: {
  width: number;
  onChange: (n: number) => void;
}) {
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-label="Ширина боковой панели"
      aria-orientation="vertical"
      aria-valuemin={220}
      aria-valuemax={420}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.dragging = "true";
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(clampSidebar(e.clientX - 72));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        delete e.currentTarget.dataset.dragging;
      }}
      onPointerCancel={(e) => {
        delete e.currentTarget.dataset.dragging;
      }}
      onDoubleClick={() => onChange(DEFAULT_SIDEBAR)}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          onChange(
            e.key === "Home"
              ? 220
              : e.key === "End"
                ? 420
                : clampSidebar(width + (e.key === "ArrowRight" ? 8 : -8)),
          );
        }
      }}
    />
  );
}

export function useMenuDismissal() {
  useEffect(() => {
    const selector =
      ".channel-actions[open], .channel-row-actions[open], .category-tools[open], .chat-header-tools details[open], .dm-settings[open], .action-menu[open], .voice-device-menu[open], .gateway-palette[open]";
    const dismiss = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach((menu) => {
        if (e instanceof KeyboardEvent || !menu.contains(e.target as Node)) menu.open = false;
      });
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
}

export function useSwipeSidebar(onChange: (open: boolean) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart(e: TouchEvent) {
      const target = e.target as HTMLElement;
      if (
        e.touches.length !== 1 ||
        target.closest("input,textarea,select,video,dialog,.tree-touch-drag")
      ) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd(e: TouchEvent) {
      const from = start.current;
      start.current = null;
      if (!from || innerWidth > 600 || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - from.x,
        dy = e.changedTouches[0].clientY - from.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onChange(false);
      else if (from.x < 100) onChange(true);
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}

export function Modal({
  title,
  children,
  onClose,
  className = "",
  dismissible = true,
  animateClose = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  dismissible?: boolean;
  animateClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleID = useId();
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => {
    if (closing || !dismissible) return;
    if (
      !animateClose ||
      document.documentElement.dataset.motion === "reduced" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      onClose();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(onClose, 140);
  };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      clearTimeout(timer.current);
      dialog.close();
      if (opener?.isConnected) {
        const menu = opener.closest("details");
        const target = menu && !menu.open ? menu.querySelector("summary") : opener;
        (target as HTMLElement | null)?.focus();
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleID}
      className={`identity app-modal ${className} ${closing ? "is-closing" : ""}`}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || (e.target as HTMLElement).closest("dialog") !== e.currentTarget)
          return;
        const controls = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => {
          if (el.tabIndex < 0 || !el.getClientRects().length || el.closest("[hidden]"))
            return false;
          if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) {
            const group = [
              ...e.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
            ].filter((radio) => radio.name === el.name);
            return !group.some((radio) => radio.checked) && group[0] === el;
          }
          return true;
        });
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first && last) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last && first) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <header className="modal-heading">
        <h2 id={titleID}>{title}</h2>
        <IconButton icon="close" label="Закрыть" onClick={close} disabled={!dismissible} />
      </header>
      {children}
    </dialog>
  );
}

export type SettingsPage =
  | "account"
  | "profile"
  | "privacy"
  | "notifications"
  | "devices"
  | "appearance";
const settingLabels: Record<SettingsPage, string> = {
  account: "Учётная запись",
  profile: "Профиль",
  privacy: "Разрешения для сообщений",
  notifications: "Уведомления",
  devices: "Устройства",
  appearance: "Внешний вид",
};
const settingIcons: Record<SettingsPage, IconName> = {
  account: "profile",
  profile: "edit",
  privacy: "lock",
  notifications: "bell",
  devices: "screen",
  appearance: "palette",
};
export function SettingsDialog({
  user,
  page,
  onPage,
  onClose,
  children,
  onLogout,
}: {
  user: PublicProfile;
  page: SettingsPage;
  onPage: (p: SettingsPage) => void;
  onClose: () => void;
  children: ReactNode;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  if (page === "profile") {
    return (
      <Modal key="profile-editor" title="Мой профиль" onClose={onClose} className="profile-dialog">
        {children}
      </Modal>
    );
  }
  return (
    <Modal
      key="user-settings"
      title={settingLabels[page]}
      onClose={onClose}
      className={`settings-dialog settings-${page}`}
    >
      <aside className="settings-sidebar">
        <button className="settings-profile-link" onClick={() => onPage("profile")}>
          <span className={`id-avatar ${user.avatar}`}>{Array.from(user.display_name)[0]}</span>
          <span>
            <strong>{user.display_name}</strong>
            <small>
              Редактировать профиль <Icon name="edit" size={12} />
            </small>
          </span>
        </button>
        <label className="settings-search">
          <Icon name="search" size={18} />
          <input
            aria-label="Поиск настроек"
            placeholder="Поиск"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <nav aria-label="Настройки пользователя">
          <small>Основные</small>
          {(Object.keys(settingLabels) as SettingsPage[])
            .filter((p) => settingLabels[p].toLowerCase().includes(query.toLowerCase()))
            .map((p) => (
              <button
                key={p}
                aria-current={page === p ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                <Icon name={settingIcons[p]} />
                {settingLabels[p]}
              </button>
            ))}
        </nav>
        <button className="settings-logout" onClick={onLogout}>
          <Icon name="logout" />
          Выйти
        </button>
        <div className="settings-brand">
          <BrandMark size={23} />
          <span>Связь</span>
        </div>
      </aside>
      <div className="settings-content" key={page}>
        {children}
      </div>
    </Modal>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Загрузка">
      <span className="id-sr">Загрузка…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          className="skeleton-row"
          key={i}
          style={{ "--skeleton-width": `${48 + ((i * 17) % 42)}%` } as CSSProperties}
        >
          <i />
          <span>
            <b />
            <b />
          </span>
        </div>
      ))}
    </div>
  );
}
