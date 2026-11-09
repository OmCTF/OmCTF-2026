import { Icon } from "./Icons";

export function chatPresentation(
  kind: "channel" | "conversation",
  name: string | undefined,
  voice = false,
  thread = false,
) {
  const voiceChat = voice && kind === "channel" && !thread;
  return {
    voiceChat,
    placeholder: `Написать ${voiceChat ? "" : kind === "channel" ? "#" : "@"}${name ?? "сообщение"}`,
    welcome: voiceChat
      ? `Добро пожаловать на канал ${name ?? "канал"}!`
      : kind === "channel"
        ? `Добро пожаловать в #${name ?? "канал"}!`
        : (name ?? "Новая переписка"),
    description: voiceChat ? `Это начало канала ${name ?? "канал"}.` : undefined,
  };
}

export function ChatRoomIcon({
  kind,
  voice = false,
  thread = false,
  size = 24,
}: {
  kind: "channel" | "conversation";
  voice?: boolean;
  thread?: boolean;
  size?: number;
}) {
  if (voice && kind === "channel" && !thread)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 22a10 10 0 1 0-8.45-4.64c.13.19.11.44-.04.61l-2.06 2.37A1 1 0 0 0 2.2 22H12Z" />
      </svg>
    );
  return <Icon name={thread ? "thread" : kind === "channel" ? "hash" : "chat"} size={size} />;
}
