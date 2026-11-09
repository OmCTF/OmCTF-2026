import type { NotificationRuleInput } from "../../../packages/contracts/generated/ts/models";

export const moderationKinds = [
  { value: "KICK", label: "Исключение" },
  { value: "BAN", label: "Бан" },
  { value: "MUTE_TEXT", label: "Запрет текста" },
  { value: "MUTE_VOICE", label: "Запрет микрофона и трансляций" },
] as const;
export const moderationDurations = [
  { value: "900", label: "15 минут" },
  { value: "3600", label: "1 час" },
  { value: "86400", label: "1 день" },
  { value: "604800", label: "7 дней" },
  { value: "0", label: "Без срока" },
] as const;
export const webhookAvatars = [
  { value: "violet", label: "Фиолетовый" },
  { value: "mint", label: "Мятный" },
  { value: "amber", label: "Янтарный" },
  { value: "rose", label: "Розовый" },
  { value: "sky", label: "Голубой" },
] as const;
export const notificationModes = [
  { value: "inherit", label: "По умолчанию" },
  { value: "all", label: "Все сообщения" },
  { value: "mentions", label: "Только упоминания" },
  { value: "mute", label: "Не уведомлять" },
] as const;
export const notificationDurations = [
  { value: "0", label: "До отмены" },
  { value: "900", label: "15 минут" },
  { value: "3600", label: "1 час" },
  { value: "86400", label: "1 день" },
  { value: "604800", label: "7 дней" },
] as const;

export function moderationSelectionError(
  target: string,
  kind: string,
  duration: string,
  eligibleIDs: readonly string[],
) {
  if (!target || !eligibleIDs.includes(target)) return "Выберите доступного участника.";
  if (!moderationKinds.some((option) => option.value === kind)) return "Выберите ограничение.";
  if (kind !== "KICK" && !moderationDurations.some((option) => option.value === duration))
    return "Выберите длительность ограничения.";
  return "";
}

export function webhookSelectionError(
  channel: string,
  avatar: string,
  manageableIDs: readonly string[],
) {
  if (!channel || !manageableIDs.includes(channel)) return "Выберите доступный канал.";
  if (!webhookAvatars.some((option) => option.value === avatar)) return "Выберите цвет аватара.";
  return "";
}

export function notificationPayload(mode: string, duration: string): NotificationRuleInput | null {
  if (!notificationModes.some((option) => option.value === mode)) return null;
  if (mode === "mute" && !notificationDurations.some((option) => option.value === duration))
    return null;
  return {
    mode: mode as NotificationRuleInput["mode"],
    duration_seconds: mode === "mute" ? Number(duration) : 0,
  };
}

export async function refreshAfterCommunityWrite(
  write: () => Promise<void>,
  refresh: () => Promise<void>,
): Promise<Error | null> {
  await write();
  try {
    await refresh();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error("Не удалось обновить список.");
  }
}
