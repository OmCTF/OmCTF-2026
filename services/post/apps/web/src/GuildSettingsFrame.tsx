import type { ReactNode } from "react";
import { Modal } from "./AppUI";

export function GuildSettingsFrame({
  active,
  name,
  page,
  sections,
  onPage,
  onClose,
  children,
}: {
  active: boolean;
  name: string;
  page: string;
  sections: string[][];
  onPage: (page: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <Modal
      title="Настройки сервера"
      className={`guild-settings-dialog guild-settings-${page}`}
      onClose={onClose}
      animateClose={false}
    >
      <aside className="guild-settings-sidebar">
        <nav aria-label="Настройки сервера">
          <h2>{name}</h2>
          {sections
            .filter(([id]) => id !== "channels")
            .map(([id, label]) => (
              <button
                key={id}
                aria-current={page === id ? "page" : undefined}
                onClick={() => onPage(id)}
              >
                {label}
              </button>
            ))}
        </nav>
      </aside>
      <div className="guild-settings-scroll">
        <div className="guild-settings-content">{children}</div>
      </div>
    </Modal>
  );
}
