import type { AuthSession } from "../../../packages/contracts/generated/ts/models";

const messages: Record<string, string> = {
  gateway_unavailable:
    "API временно недоступен. Восстанавливаем соединение; не закрывайте неотправленное сообщение.",
  invalid_file_size: "Размер файла должен быть от 1 байта до 8 МБ.",
  file_too_large: "Файл больше 8 МБ.",
  invalid_filename: "Недопустимое имя файла.",
  invalid_image: "Изображение повреждено или превышает 2048 × 2048 пикселей.",
  unsupported_file: "Этот формат файла не поддерживается.",
  upload_quota: "Лимит: 3 незавершённые загрузки и 100 МБ файлов на пользователя.",
  upload_not_attachable: "Файл ещё не готов, истёк или уже прикреплён к другому сообщению.",
  upload_expired: "Срок загрузочной сессии истёк. Выберите файл заново.",
  upload_state: "Эту загрузку нельзя продолжить. Повторите загрузку файла.",
  media_unavailable: "Сервис файлов временно недоступен.",
  media_busy: "Сервис файлов занят. Повторите попытку.",
  attachment_not_found: "Вложение удалено или у вас нет доступа к нему.",
  attach_forbidden: "Прикрепление файлов запрещено правами или приватностью.",
  invalid_search: "Проверьте запрос: до 256 символов, 16 слов и парные кавычки.",
  query_too_broad: "Добавьте хотя бы одно слово для поиска, не только исключения.",
  query_too_expensive: "Запрос слишком сложный. Уточните слова или выберите канал.",
  search_scope_changed: "Доступ к перепискам изменился. Запустите поиск заново.",
  invalid_cursor: "Страница устарела. Запустите поиск заново.",
  version_conflict: "Запись уже изменилась. Обновите её и повторите действие с новой версией.",
  contact_not_allowed: "Блокировка или настройки приватности не разрешают эту переписку.",
  send_forbidden: "Отправка запрещена правами или настройками приватности.",
  edit_forbidden: "Изменять сообщение может его автор или модератор.",
  message_deleted: "Сообщение удалено. Восстановить его текст нельзя.",
  thread_archived: "Ветка закрыта для новых сообщений.",
  messaging_unavailable: "Сервис сообщений временно недоступен. Повторите попытку.",
  policy_busy: "Права сейчас обновляются. Повторите попытку.",
  access_denied: "Нет доступа к этой переписке.",
  self_escalation: "Изменение повысило бы ваши собственные права и запрещено.",
  role_hierarchy: "Нельзя управлять своей ролью или ролью не ниже вашей.",
  member_hierarchy:
    "Нельзя управлять собой, владельцем или участником с равной либо более высокой ролью.",
  permission_missing: "У вас нет разрешения на это действие.",
  explicit_deny: "Действие запрещено переопределением прав.",
  channel_hidden: "Доступ к каналу закрыт.",
  category_hidden: "Доступ к родительской категории закрыт.",
  invite_unavailable: "Приглашение истекло, отозвано или исчерпало лимит.",
  confirmation_required: "Необходимо отдельное подтверждение владельца.",
  wrong_channel_type: "Действие недоступно для этого типа канала.",
  owner_required: "Действие доступно только владельцу.",
  category_has_channels: "Категория содержит каналы. Подтвердите их перенос в корень.",
  invalid_credentials: "Неверный логин или пароль.",
  registration_unavailable: "Регистрация с этими данными недоступна. Попробуйте другой логин.",
  invalid_registration: "Проверьте логин (3–32 символа), имя (1–64) и пароль (12–128).",
  rate_limited: "Слишком много попыток. Подождите минуту.",
  authentication_busy: "Сервис занят. Повторите через минуту.",
  not_found: "Пользователь или запись не найдены.",
  contact_forbidden: "Настройки приватности не разрешают это действие.",
  already_friends: "Этот пользователь уже в друзьях.",
  incoming_request_exists: "У вас уже есть входящая заявка от этого пользователя.",
  invalid_request_state: "Заявка уже обработана. Обновите список.",
  idempotency_conflict: "Этот идентификатор повтора уже использован с другими данными.",
  session_expired: "Сессия завершена. Войдите снова.",
  refresh_reused: "Сессия отозвана для безопасности. Войдите снова.",
  authentication_required: "Войдите в аккаунт.",
  invalid_login: "Логин: 3–32 буквы, цифры, точка, дефис или подчёркивание.",
  invalid_display_name: "Имя должно содержать от 1 до 64 символов.",
  service_unavailable: "Сервис временно недоступен. Попробуйте ещё раз.",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(messages[code] ?? "Не удалось выполнить запрос. Повторите попытку позже.");
  }
}
export class NetworkError extends Error {
  constructor(public uncertain: boolean) {
    super(
      uncertain
        ? "Ответ сервера не получен. Действие могло выполниться. Проверьте результат перед повтором."
        : "Нет ответа от сервера. Проверьте соединение и повторите запрос.",
    );
  }
}
let identity: string | null = null;
let boundary = 0;
export function setSessionIdentity(id: string | null) {
  if (identity !== id) {
    identity = id;
    boundary++;
  }
}
export function endSession() {
  boundary++;
  identity = null;
  window.dispatchEvent(new Event("svyaz-session-ended"));
}
async function raw(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  try {
    return await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(method !== "GET" ? { "X-Svyaz-CSRF": "1" } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new NetworkError(method !== "GET");
  }
}
async function read<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status || 503, "service_unavailable");
  }
  if (!response.ok) throw new ApiError(response.status, data.code ?? "service_unavailable");
  return data as T;
}
let refreshing: Promise<void> | undefined;
async function renew() {
  if (!refreshing) {
    const run = async () => {
      const expected = identity,
        epoch = boundary;
      const verify = (auth: AuthSession) => {
        if (epoch !== boundary || (expected && auth.user?.id !== expected))
          throw new ApiError(401, "session_expired");
      };
      const current = await raw("/auth/session");
      if (current.ok) {
        verify(await read<AuthSession>(current));
        return;
      }
      if (current.status !== 401) {
        await read(current);
        return;
      }
      verify(await read<AuthSession>(await raw("/auth/refresh", "POST")));
    };
    refreshing = Promise.resolve(
      navigator.locks ? navigator.locks.request("svyaz-session", run) : run(),
    )
      .then(() => {})
      .finally(() => {
        refreshing = undefined;
      });
  }
  return refreshing;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const epoch = boundary;
  let response = await raw(path, method, body, headers);
  const publicRoute = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].includes(
    path,
  );
  if (response.status === 401 && !publicRoute) {
    try {
      await renew();
      if (epoch !== boundary) throw new ApiError(401, "session_expired");
      response = await raw(path, method, body, headers);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) endSession();
      throw error;
    }
  }
  const result = await read<T>(response);
  if (!publicRoute && epoch !== boundary) throw new ApiError(401, "session_expired");
  if (path === "/auth/login") {
    setSessionIdentity((result as AuthSession).user.id);
    channel?.postMessage("account-changed");
  }
  return result;
}
export const session = async () => {
  const auth = await api<AuthSession>("/auth/session");
  setSessionIdentity(auth.user.id);
  return auth;
};
const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("svyaz-session") : null;
channel?.addEventListener("message", (event) => {
  if (event.data === "logout" || event.data === "account-changed") endSession();
});
export async function signOut(all = false) {
  const run = async () => {
    await api(all ? "/auth/logout-all" : "/auth/logout", "POST");
    channel?.postMessage("logout");
    endSession();
  };
  if (all) await run();
  else if (navigator.locks) await navigator.locks.request("svyaz-session", run);
  else await run();
}
