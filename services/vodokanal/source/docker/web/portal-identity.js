(function () {
  "use strict";
  const messages = Object.freeze({
    идентификация_некорректно_ввод: "Проверьте поля формы. Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание. Пароль: 12–128 символов.",
    идентификация_регистрация_конфликт: "Этот логин уже занят или запрос регистрации отличается от предыдущего. Выберите другой логин либо войдите в созданную учётную запись.",
    идентификация_почтовый_ящик_не_найдено: "Не удалось открыть ящик. Проверьте логин и сохранённый ключ.",
    идентификация_код_некорректно: "Код не подошёл, истёк или исчерпал попытки. Запросите новое письмо.",
    идентификация_контакт_не_подтверждено: "Сначала подтвердите контакт в разделе профиля. Неподтверждённый ящик не используется для восстановления.",
    идентификация_частота_ограничено: "Слишком много запросов. Подождите минуту и повторите действие.",
    идентификация_восстановление_ожидание: "Смена пароля ещё не завершена. Повторите отправку с тем же новым паролем или через минуту запросите новое письмо.",
    идентификация_версия_конфликт: "Настройки ящика изменились. Обновите страницу раздела перед повтором.",
    кабинет_повторная_авторизация_требуется: "Для замены ключа снова войдите в кабинет и повторите действие в течение минуты.",
    идентификация_недоступно: "Не удалось подтвердить результат операции. Повторите её кнопкой ниже.",
    владение_не_найдено: "Передача или адресат недоступны. Проверьте выбранную область и учётную запись.",
    владение_некорректно_ввод: "Проверьте адресата и срок передачи управления.",
    владение_ожидание_конфликт: "Для этой области уже есть предложение передачи. Сначала отзовите его или дождитесь решения.",
    владение_запрос_конфликт: "Состав предложения отличается от предыдущего запроса. Обновите список.",
    владение_версия_конфликт: "Предложение изменилось. Обновите список перед повторным решением.",
    владение_состояние_конфликт: "Передача уже завершена или текущий владелец изменился. Обновите список.",
    владение_истекло: "Срок предложения истёк. Владелец может создать новое.",
    контекст_изменено: "Рабочая область изменилась. Откройте раздел заново.",
    идентификация_страница_некорректно: "Список изменился или ответ сервера неполон. Обновите раздел с первой страницы.",
    сеть_ошибка: "Нет ответа сервера. Данные запроса сохранены только в этой вкладке; повторите действие вручную."
  });
  function errorText(error) { return messages[error?.code] || "Не удалось выполнить действие. Повторите позже."; }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uncertain(error) { return !error?.status || error.status >= 500 || ["некорректно_ответ", "идентификация_недоступно", "идентификация_восстановление_ожидание"].includes(error.code); }
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function button(text, action, primary = false) {
    const result = node("button", text, "button " + (primary ? "primary" : "secondary"));
    result.type = "button"; result.addEventListener("click", action); return result;
  }
  function field(form, label, name, options = {}) {
    const wrap = node("label", label, "identity-field");
    const input = document.createElement("input"); input.name = name; input.type = options.type || "text";
    input.required = options.required !== false; input.autocomplete = options.autocomplete || "off";
    if (options.minLength) input.minLength = options.minLength;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.pattern) input.pattern = options.pattern;
    if (options.readOnly) input.readOnly = true;
    input.spellcheck = false; wrap.append(input); form.append(wrap); return input;
  }
  function randomKey() {
    if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.randomUUID) throw new Error("Криптографический генератор недоступен");
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
  }
  function saveKey(login, key) {
    const content = JSON.stringify({ schema: 1, login, mailboxKey: key, note: "Почтовый ящик. Храните отдельно от пароля; не передавайте другим." }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "vodokanal-mailbox-key.json";
    try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async function publicRequest(path, body) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/identity/hs/identity/" + path, {
        method: "POST", credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Vodokanal-Request": "1", ...(body.requestId ? { "Idempotency-Key": body.requestId } : {}) },
        body: JSON.stringify(body)
      });
      let data; try { data = await response.json(); } catch (_) { throw { code: "идентификация_недоступно", status: response.status }; }
      if (!response.ok) throw { code: typeof data?.error === "string" ? data.error : data?.error?.code, status: response.status };
      return data;
    } catch (error) { if (error?.code) throw error; throw { code: "сеть_ошибка", status: 0 }; }
    finally { clearTimeout(timeout); }
  }
  function letters(container, data, onUse) {
    container.replaceChildren();
    if (!data || typeof data.address !== "string" || !Array.isArray(data.items) || data.items.length > 2 || data.hasMore !== false || data.nextCursor !== "") throw { code: "идентификация_недоступно" };
    container.append(node("h4", "Внутренняя почта: " + String(data.address || "")));
    if (!data.items.length) container.append(node("p", "Писем пока нет."));
    for (const item of data.items) {
      if (!item || !["contact", "recovery"].includes(item.purpose) || !uuid.test(item.id || "") || typeof item.code !== "string" ||
          (item.completionRequestId && !uuid.test(item.completionRequestId)) || !Number.isFinite(Date.parse(item.expiresAt))) throw { code: "идентификация_недоступно" };
      const row = node("article", undefined, "identity-letter");
      row.append(node("h5", item.purpose === "contact" ? "Подтверждение контакта" : "Восстановление доступа"));
      const labels = { Pending: "Ожидает подтверждения", Consumed: "Использовано", Expired: "Срок истёк", Exhausted: "Попытки исчерпаны", Processing: "Смена пароля не завершена" };
      row.append(node("p", labels[item.state] || "Недоступно"));
      if (["Pending", "Processing"].includes(item.state) && item.code) {
        const code = node("code", item.code, "identity-code"); row.append(code);
        row.append(node("p", "Срок действия: " + new Date(item.expiresAt).toLocaleString("ru-RU"), "muted"));
        if (onUse) row.append(button("Использовать этот код", () => onUse(item)));
      }
      container.append(row);
    }
  }
  let clearPublic = () => {};
  function mountAuth() {
    const host = document.querySelector("#login-screen .login-card");
    if (!host || host.querySelector(".identity-auth")) return;
    const root = node("section", undefined, "identity-auth");
    const navigation = node("div", undefined, "identity-actions");
    const panel = node("div", undefined, "identity-panel"); panel.hidden = true;
    const status = node("p", "", "identity-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const command = node("div", undefined, "identity-command");
    root.append(navigation, panel, status, command); host.append(root);
    const loginMode = host.querySelector("#identity-login-mode");
    if (!loginMode) { root.remove(); return; }
    let epoch = 0; let busy = false; let cleanup = () => {}; let pending = null;
    function controls() {
      for (const control of root.querySelectorAll("button,input,select")) control.disabled = busy || Boolean(pending);
      for (const control of command.querySelectorAll("button")) control.disabled = busy;
    }
    function focusLogin() { document.getElementById("login-name")?.focus(); }
    function reset() {
      epoch++; cleanup(); cleanup = () => {}; pending = null; command.replaceChildren(); panel.replaceChildren(); panel.hidden = true; status.textContent = ""; busy = false; root.removeAttribute("aria-busy");
      loginMode.hidden = false; root.dataset.authMode = "login"; registerButton.hidden = false; recoveryButton.hidden = false; backButton.hidden = true; controls();
    }
    function backToLogin() { if (busy || pending) return; reset(); focusLogin(); }
    function display(title, mode) {
      reset(); loginMode.hidden = true; root.dataset.authMode = mode; registerButton.hidden = true; recoveryButton.hidden = true; backButton.hidden = false;
      panel.hidden = false; const heading = node("h2", title); heading.tabIndex = -1; panel.append(heading); heading.focus();
    }
    async function run(work, retry = false) {
      if (busy || (pending && !retry)) return; const ticket = epoch; busy = true; status.textContent = "Выполняем запрос…";
      root.setAttribute("aria-busy", "true");
      controls();
      try { const value = await work(); if (ticket !== epoch) return; return value; }
      catch (error) { if (ticket === epoch) status.textContent = errorText(error); }
      finally {
        if (ticket === epoch) { busy = false; root.removeAttribute("aria-busy"); controls(); }
      }
    }
    function renderCommand() {
      command.replaceChildren();
      if (pending) {
        command.append(node("p", "Результат отправки неизвестен. Повторите ту же операцию кнопкой ниже, не меняя пароль."));
        command.append(button("Повторить ту же операцию", () => send(pending)));
        command.append(button("Закрыть и удалить данные из вкладки", () => {
          if (busy || !globalThis.confirm("Операция могла выполниться. Закрытие формы не отменит её и удалит данные для повтора. Сохраните скачанный ключ. Закрыть форму?")) return;
          reset(); focusLogin();
        }));
      }
      controls();
    }
    function send(intent) {
      return run(async () => {
        const ticket = epoch; const retrying = pending === intent; pending = intent; renderCommand();
        let result;
        try {
          result = await publicRequest(intent.path, intent.body);
          if (ticket !== epoch) return;
          if (!intent.accept(result)) throw { code: "идентификация_недоступно" };
        } catch (error) {
          if (ticket !== epoch) return;
          if (!retrying && !uncertain(error)) pending = null;
          renderCommand(); throw error;
        }
        pending = null; renderCommand(); intent.done(result);
      }, true);
    }
    function showRegister() {
      display("Создать учётную запись", "register");
      const form = document.createElement("form");
      const login = field(form, "Логин", "login", { minLength: 3, maxLength: 64, pattern: "[A-Za-z0-9._-]{3,64}", autocomplete: "username" });
      const displayName = field(form, "Имя", "displayName", { maxLength: 150 });
      const password = field(form, "Пароль", "password", { type: "password", minLength: 12, maxLength: 128, autocomplete: "new-password" });
      const again = field(form, "Повторите пароль", "again", { type: "password", minLength: 12, maxLength: 128, autocomplete: "new-password" });
      let mailboxKey = ""; let downloadedLogin = ""; let intent = null;
      const explanation = node("p", "Скачайте и сохраните ключ для восстановления пароля.", "identity-note");
      const savedLabel = node("label", undefined, "identity-checkbox"); const saved = document.createElement("input"); saved.type = "checkbox"; saved.required = true;
      savedLabel.append(saved, document.createTextNode("Я сохранил ключ почтового ящика"));
      const download = button("Создать и скачать ключ почты", () => {
        if (!login.checkValidity()) { login.reportValidity(); return; }
        try { if (!mailboxKey) mailboxKey = randomKey(); downloadedLogin = ""; const keyLogin = login.value.toLowerCase(); saveKey(keyLogin, mailboxKey); downloadedLogin = keyLogin; status.textContent = "Ключ скачан. Он не сохраняется в браузере."; }
        catch (_) { status.textContent = "Не удалось создать ключ. Откройте защищённую версию сайта или обратитесь в поддержку."; }
      });
      const submit = node("button", "Зарегистрироваться", "button primary"); submit.type = "submit";
      form.append(explanation, download, savedLabel, submit); panel.append(form);
      login.addEventListener("input", () => { saved.checked = false; intent = null; });
      form.addEventListener("submit", event => {
        event.preventDefault(); if (busy || pending || !form.reportValidity()) return;
        if (!mailboxKey || downloadedLogin !== login.value.toLowerCase()) { status.textContent = "Сначала скачайте ключ для указанного логина и подтвердите его сохранение."; return; }
        if (password.value !== again.value) { status.textContent = "Пароли не совпадают."; again.focus(); return; }
        const payload = { login: login.value.toLowerCase(), displayName: displayName.value.trim(), password: password.value, mailboxKey };
        const serialized = JSON.stringify(payload);
        if (!intent || intent.serialized !== serialized) intent = { serialized, requestId: crypto.randomUUID() };
        send({ path: "register", body: { ...payload, requestId: intent.requestId },
          accept: result => uuid.test(result?.id || "") && result.login === payload.login && result.applicant === true && result.loginRequired === true && typeof result.mailboxAddress === "string",
          done(result) {
          const current = new URLSearchParams(location.search); const next = new URLSearchParams();
          for (const [key, values] of [["service", ["meter", "request", "lab", "water"]], ["applicant", ["resident", "organization"]]]) {
            if (current.getAll(key).length === 1 && values.includes(current.get(key))) next.set(key, current.get(key));
          }
          reset();
          const nativeLogin = document.getElementById("login-name"); if (nativeLogin) nativeLogin.value = result.login;
          location.replace("/login" + (next.size ? "?" + next.toString() : ""));
          }
        });
      });
      cleanup = () => { mailboxKey = ""; downloadedLogin = ""; intent = null; password.value = ""; again.value = ""; };
    }
    function showRecovery() {
      display("Восстановить доступ", "recovery");
      panel.append(node("p", "Используйте ключ, сохранённый при регистрации или в профиле.", "muted"));
      const form = document.createElement("form");
      const login = field(form, "Логин", "login", { minLength: 3, maxLength: 64, autocomplete: "username" });
      const key = field(form, "Ключ ящика", "mailboxKey", { type: "password", minLength: 64, maxLength: 64, pattern: "[0-9a-f]{64}" });
      const fileLabel = node("label", "Или выберите сохранённый файл ключа", "identity-field"); const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; fileLabel.append(file); form.append(fileLabel);
      file.addEventListener("change", async () => {
        const value = file.files?.[0]; if (!value) return;
        const ticket = epoch;
        try {
          if (value.size > 4096) throw new Error(); const parsed = JSON.parse(await value.text());
          if (ticket !== epoch || busy || pending) return;
          if (parsed.schema !== 1 || typeof parsed.login !== "string" || !/^[a-z0-9._-]{3,64}$/.test(parsed.login) || !/^[0-9a-f]{64}$/.test(parsed.mailboxKey)) throw new Error();
          invalidate(); login.value = parsed.login; key.value = parsed.mailboxKey; status.textContent = "Ключ загружен только в эту форму.";
        } catch (_) { if (ticket === epoch) status.textContent = "Это не файл ключа почтового ящика."; }
        finally { file.value = ""; }
      });
      const mail = node("div"); const completion = document.createElement("form"); completion.hidden = true;
      const newPassword = field(completion, "Новый пароль", "newPassword", { type: "password", minLength: 12, maxLength: 128, autocomplete: "new-password" });
      const again = field(completion, "Повторите новый пароль", "again", { type: "password", minLength: 12, maxLength: 128, autocomplete: "new-password" });
      let selected = null; let resetIntent = null; let requestId = "";
      function body() { return { login: login.value.toLowerCase(), mailboxKey: key.value }; }
      function invalidate() { selected = null; resetIntent = null; requestId = ""; completion.hidden = true; mail.replaceChildren(); newPassword.value = ""; again.value = ""; }
      login.addEventListener("input", invalidate); key.addEventListener("input", invalidate);
      function choose(item) {
        if (item.purpose !== "recovery") { status.textContent = "Контакт подтверждается после обычного входа в профиле."; return; }
        selected = item; resetIntent = null; completion.hidden = false; newPassword.focus();
        status.textContent = item.state === "Processing" ? "Предыдущая смена пароля не завершена. Укажите тот же новый пароль, который вводили для этого письма." : "Код выбран. Задайте новый пароль.";
      }
      const request = node("button", "Отправить письмо восстановления", "button primary"); request.type = "submit";
      form.append(request, button("Открыть внутреннюю почту", () => {
        if (!form.reportValidity()) return;
        run(async () => { const ticket = epoch; const result = await publicRequest("mailbox", body()); if (ticket !== epoch) return; letters(mail, result, choose); status.textContent = "Почта открыта. Выберите письмо восстановления."; });
      }));
      form.addEventListener("submit", event => {
        event.preventDefault(); if (busy || pending || !form.reportValidity()) return;
        if (!requestId) requestId = crypto.randomUUID();
        send({ path: "recovery/request", body: { ...body(), requestId }, accept: result => result?.accepted === true,
          done() { status.textContent = "Письмо отправлено. Откройте внутреннюю почту отдельной кнопкой."; } });
      });
      form.append(button("Запросить новое письмо вместо предыдущего", () => { if (!busy) { requestId = ""; invalidate(); status.textContent = "Предыдущий код будет заменён. Отправьте новое письмо; между отправками нужна минута."; } }));
      const complete = node("button", "Изменить пароль и завершить старые сессии", "button primary"); complete.type = "submit"; completion.append(complete);
      completion.addEventListener("submit", event => {
        event.preventDefault(); if (busy || pending || !selected || !completion.reportValidity()) return;
        if (newPassword.value !== again.value) { status.textContent = "Пароли не совпадают."; return; }
        const snapshot = { ...body(), messageId: selected.id, code: selected.code, newPassword: newPassword.value };
        const serialized = JSON.stringify(snapshot);
        if (!resetIntent || resetIntent.serialized !== serialized) resetIntent = { serialized, requestId: selected.completionRequestId || crypto.randomUUID() };
        send({ path: "recovery/complete", body: { ...snapshot, requestId: resetIntent.requestId },
          accept: result => result?.completed === true && result.loginRequired === true,
          done() {
          const nativeLogin = document.getElementById("login-name"); if (nativeLogin) nativeLogin.value = snapshot.login;
          key.value = ""; newPassword.value = ""; again.value = ""; selected = null; resetIntent = null; mail.replaceChildren(); completion.hidden = true;
          status.textContent = "Пароль изменён, прежние сессии завершены. Нажмите «Назад ко входу», чтобы войти с новым паролем.";
          }
        });
      });
      panel.append(form, mail, completion);
      cleanup = () => { key.value = ""; newPassword.value = ""; again.value = ""; selected = null; resetIntent = null; requestId = ""; };
    }
    const registerButton = button("Зарегистрироваться", showRegister);
    const recoveryButton = button("Забыли пароль?", showRecovery);
    const backButton = button("Назад ко входу", backToLogin); backButton.hidden = true;
    navigation.append(registerButton, recoveryButton, backButton);
    root.dataset.authMode = "login";
    const auth = new URLSearchParams(location.search).get("auth");
    if (auth === "register") showRegister(); else if (auth === "recovery") showRecovery();
    clearPublic = reset;
    const screen = document.getElementById("login-screen");
    if (screen) new MutationObserver(() => { if (screen.hidden) reset(); }).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
  }
  function createAccount({ root, request, onSessionError, onOwnershipChanged, onMutationLock = () => {} }) {
    if (!root || typeof request !== "function") throw new TypeError("identity account requires root and request");
    let actor = "", account = "", login = "", epoch = 0, profile = null, busy = false;
    let externalBusy = false, externalMutationLock = false, pending = null, configureIntent = null, initialLoadPending = false;
    let transferCursor = "", transferRows = [], transferHasMore = false;
    let workspaceCursor = "", workspaceRows = [], workspaceHasMore = false, workspaceLoaded = false;
    const states = Object.freeze({ Pending: "Ожидает решения", Accepted: "Управление передано", Declined: "Отклонено", Revoked: "Отозвано", Expired: "Срок истёк" });
    const heading = node("h3", "Контакт и восстановление");
    const identity = node("div", undefined, "identity-profile");
    const status = node("p", "", "identity-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const command = node("div", undefined, "identity-command"), actions = node("div", undefined, "identity-actions");
    const mail = node("div"), ownership = node("section", undefined, "identity-ownership");
    root.classList.add("identity-account"); root.replaceChildren(heading, identity, status, command, actions, mail, ownership); root.hidden = true;
    function controls() {
      const blocked = busy || externalBusy || externalMutationLock || !account;
      for (const control of root.querySelectorAll("button,input,select")) control.disabled = blocked || Boolean(pending);
      for (const control of command.querySelectorAll("button")) control.disabled = blocked;
    }
    function commandPanel() {
      command.replaceChildren();
      if (pending) {
        command.append(node("p", "Результат сохранения неизвестен. Повторите ту же операцию кнопкой ниже. Не закрывайте вкладку до подтверждения."));
        command.append(button("Повторить ту же операцию", () => send(pending)));
      }
      onMutationLock(Boolean(pending)); controls();
    }
    function clear() {
      epoch++; actor = ""; account = ""; login = ""; profile = null; busy = false; pending = null; configureIntent = null; initialLoadPending = false;
      transferCursor = ""; transferRows = []; transferHasMore = false;
      workspaceCursor = ""; workspaceRows = []; workspaceHasMore = false; workspaceLoaded = false;
      status.textContent = ""; identity.replaceChildren(); actions.replaceChildren(); mail.replaceChildren(); ownership.replaceChildren();
      root.hidden = true; root.removeAttribute("aria-busy"); commandPanel();
    }
    function flushInitialLoad() {
      if (!initialLoadPending || busy || externalBusy || externalMutationLock || pending || !actor || !account) return;
      initialLoadPending = false;
      run(load);
    }
    async function run(work, retry = false) {
      if (busy || externalBusy || externalMutationLock || !actor || !account || (pending && !retry)) return;
      const ticket = epoch; busy = true; root.setAttribute("aria-busy", "true"); controls();
      try { await work(ticket); }
      catch (error) {
        if (ticket !== epoch) return;
        if (error?.status === 401 || error?.code === "кабинет_учетная_запись_отключено") { clear(); onSessionError?.(error); return; }
        status.textContent = errorText(error);
      } finally { if (ticket === epoch) { busy = false; root.removeAttribute("aria-busy"); controls(); flushInitialLoad(); } }
    }
    function newIntent(path, body, accept, done) {
      return { path, body: Object.freeze({ ...body }), key: body.requestId || crypto.randomUUID(), actor, account, epoch, accept, done };
    }
    function send(intent) {
      if (!intent || intent.actor !== actor || intent.account !== account || intent.epoch !== epoch || (pending && pending !== intent)) return;
      return run(async ticket => {
        const retrying = pending === intent; pending = intent; commandPanel();
        let result;
        try {
          result = await request(intent.path, { method: "POST", headers: { "Idempotency-Key": intent.key }, body: intent.body });
          if (ticket !== epoch) return;
          if (!intent.accept(result)) throw { code: "идентификация_недоступно" };
        } catch (error) {
          if (ticket !== epoch) return;
          if (!retrying && !uncertain(error)) pending = null;
          commandPanel(); throw error;
        }
        pending = null; commandPanel(); await intent.done(result, ticket);
      }, true);
    }
    function validProfile(value) { return typeof value?.configured === "boolean" && typeof value.confirmed === "boolean" && typeof value.address === "string" && Number.isSafeInteger(value.version) && value.version >= 0; }
    function validTransfer(item) {
      return uuid.test(item?.id || "") && uuid.test(item.workspaceId || "") && typeof item.workspaceName === "string" &&
        uuid.test(item.senderId || "") && uuid.test(item.recipientId || "") && (item.senderId === account || item.recipientId === account) &&
        Number.isSafeInteger(item.version) && item.version >= 1 && Object.hasOwn(states, item.state) && Number.isFinite(Date.parse(item.expiresAt));
    }
    function page(data, cursor, existing, valid) {
      if (!Array.isArray(data?.items) || data.items.length > 25 || data.limit !== 25 || typeof data.hasMore !== "boolean" ||
          typeof data.nextCursor !== "string" || data.nextCursor.length > 256 || (data.hasMore && (!data.items.length || !data.nextCursor || data.nextCursor === cursor)) ||
          (!data.hasMore && data.nextCursor !== "")) throw { code: "идентификация_страница_некорректно" };
      const seen = new Set(existing.map(item => item.id));
      for (const item of data.items) { if (!valid(item) || seen.has(item.id)) throw { code: "идентификация_страница_некорректно" }; seen.add(item.id); }
      return existing.concat(data.items);
    }
    async function load(ticket) {
      const result = await request("account/contact"); if (ticket !== epoch) return;
      if (!validProfile(result)) throw { code: "идентификация_недоступно" };
      profile = result; render();
    }
    async function fetchTransfers(ticket, reset = false) {
      const cursor = reset ? "" : transferCursor;
      const data = await request("ownership-transfers?limit=25" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
      if (ticket !== epoch) return;
      transferRows = page(data, cursor, reset ? [] : transferRows, validTransfer); transferCursor = data.nextCursor; transferHasMore = data.hasMore;
      renderTransfers();
    }
    function renderTransfers() {
      const list = ownership.querySelector(".identity-transfer-list"); if (!list) return;
      list.replaceChildren();
      if (!transferRows.length) list.append(node("p", "Предложений передачи пока нет."));
      for (const item of transferRows) {
        const row = node("article", undefined, "identity-letter"); row.append(node("h5", item.workspaceName));
        row.append(node("p", states[item.state] || "Недоступно"));
        row.append(node("p", item.senderId === account ? "Вы предлагаете передать управление учётной записи " + item.recipientId : "Вам предлагают принять управление областью."));
        row.append(node("p", "Действует до " + new Date(item.expiresAt).toLocaleString("ru-RU"), "muted"));
        function decide(action) {
          if (busy || pending || externalBusy || externalMutationLock) return;
          const question = action === "accept" ? "Принять управление областью? Прежний владелец больше не сможет управлять её участниками. Доступ к личным документам не изменится." : action === "decline" ? "Отклонить предложение передачи управления?" : "Отозвать предложение передачи управления?";
          if (!globalThis.confirm(question)) return;
          const state = { accept: "Accepted", decline: "Declined", revoke: "Revoked" }[action];
          send(newIntent("ownership-transfers/" + encodeURIComponent(item.id) + "/actions/" + action, { expectedVersion: item.version },
            result => validTransfer(result) && result.id === item.id && result.state === state,
            async result => {
            transferRows = transferRows.map(value => value.id === result.id ? result : value); renderTransfers();
            status.textContent = action === "accept" ? "Управление принято. Выберите область в переключателе." : "Решение сохранено.";
            if (action === "accept") await onOwnershipChanged?.();
          }));
        }
        if (item.state === "Pending") {
          if (item.recipientId === account) row.append(button("Принять управление", () => decide("accept"), true), button("Отклонить", () => decide("decline")));
          if (item.senderId === account) row.append(button("Отозвать предложение", () => decide("revoke")));
        }
        list.append(row);
      }
      if (transferHasMore) list.append(button("Показать ещё 25 предложений", () => run(ticket => fetchTransfers(ticket))));
      controls();
    }
    async function fetchWorkspaces(ticket, reset = false) {
      const cursor = reset ? "" : workspaceCursor;
      const data = await request("workspaces?limit=25" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
      if (ticket !== epoch) return;
      workspaceRows = page(data, cursor, reset ? [] : workspaceRows, item => uuid.test(item?.id || "") && typeof item.name === "string" && typeof item.state === "string" && uuid.test(item.ownerAccountId || ""));
      workspaceCursor = data.nextCursor; workspaceHasMore = data.hasMore; workspaceLoaded = true;
      renderOwnedWorkspaces();
    }
    function renderOwnedWorkspaces() {
      const form = ownership.querySelector(".identity-transfer-form"), select = form?.querySelector("select[name='workspace']"), pager = ownership.querySelector(".identity-workspace-pages");
      if (!form || !select || !pager) return;
      const owned = workspaceRows.filter(item => item.ownerAccountId === account && item.state === "Active"), previous = select.value;
      select.replaceChildren();
      for (const item of owned) { const option = node("option", item.name); option.value = item.id; select.append(option); }
      if (owned.some(item => item.id === previous)) select.value = previous;
      form.hidden = !owned.length; pager.replaceChildren();
      pager.append(node("p", workspaceLoaded ? "Загружено доступных областей: " + workspaceRows.length + ". Из них под вашим управлением: " + owned.length + "." : "Список областей ещё не загружен.", "muted"));
      if (!owned.length && workspaceLoaded) pager.append(node("p", workspaceHasMore ? "На этой части списка нет областей под вашим управлением. Загрузите следующую часть." : "У вас нет активных областей для передачи управления."));
      if (workspaceHasMore) pager.append(button("Загрузить следующие 25 областей", () => run(ticket => fetchWorkspaces(ticket))));
      pager.append(button("Обновить области с начала", () => run(ticket => fetchWorkspaces(ticket, true)))); controls();
    }
    async function showOwnership(ticket) {
      workspaceRows = []; workspaceCursor = ""; workspaceHasMore = false; workspaceLoaded = false;
      transferRows = []; transferCursor = ""; transferHasMore = false;
      ownership.replaceChildren(node("h4", "Передача управления областью"));
      ownership.append(node("p", "Получатель должен принять передачу в своём кабинете. После этого прежний владелец теряет право управления. Остальные права не меняются.", "muted"));
        const form = node("form", undefined, "identity-transfer-form"); const label = node("label", "Ваша область", "identity-field"); const select = document.createElement("select"); select.name = "workspace"; select.required = true; label.append(select); form.hidden = true;
        form.append(label);
        const recipient = field(form, "ID учётной записи нового владельца", "recipient", { minLength: 36, maxLength: 36, pattern: "[0-9a-fA-F-]{36}" });
        form.append(node("p", "Попросите получателя скопировать ID из своего профиля.", "muted"));
        const expiryLabel = node("label", "Срок для принятия", "identity-field"); const expiry = document.createElement("select");
        for (const [value, text] of [[3600, "1 час"], [86400, "24 часа"]]) { const option = node("option", text); option.value = String(value); expiry.append(option); }
        expiryLabel.append(expiry); form.append(expiryLabel);
        const submit = node("button", "Предложить передачу управления", "button primary"); submit.type = "submit"; form.append(submit);
        form.addEventListener("submit", event => {
          event.preventDefault(); if (busy || pending || externalBusy || externalMutationLock || !form.reportValidity()) return;
          if (!uuid.test(recipient.value) || recipient.value.toLowerCase() === account.toLowerCase()) { status.textContent = "Укажите ID другой учётной записи."; return; }
          if (!workspaceRows.some(item => item.id === select.value && item.ownerAccountId === account && item.state === "Active")) { status.textContent = "Обновите список и выберите область под вашим управлением."; return; }
          if (!globalThis.confirm("Вы подтверждаете передачу управления выбранной областью этому адресату после его принятия?")) return;
          const payload = { workspaceId: select.value, recipientId: recipient.value.toLowerCase(), expiresIn: Number(expiry.value), requestId: crypto.randomUUID() };
          send(newIntent("ownership-transfers", payload,
            result => validTransfer(result) && result.workspaceId === payload.workspaceId && result.senderId === account && result.recipientId === payload.recipientId,
            result => {
              transferRows = [result]; transferCursor = ""; transferHasMore = false; renderTransfers(); recipient.value = "";
              status.textContent = "Предложение подтверждено сервером. Его состояние: " + states[result.state] + ". Обновите предложения, чтобы увидеть весь список.";
            }));
        }); ownership.append(form);
      ownership.append(node("div", undefined, "identity-workspace-pages")); renderOwnedWorkspaces();
      ownership.append(button("Обновить предложения", () => run(current => fetchTransfers(current, true))));
      ownership.append(node("div", undefined, "identity-transfer-list")); controls();
      await fetchWorkspaces(ticket, true); if (ticket !== epoch) return; await fetchTransfers(ticket, true);
    }
    function renderKeyPrompt() {
      actions.querySelector(".identity-key-confirm")?.remove(); if (!configureIntent) return;
      const draft = configureIntent, prompt = node("div", undefined, "identity-key-confirm");
      prompt.append(node("p", "Подтвердите сохранение нового ключа. Если с момента входа прошла минута, войдите заново."));
      prompt.append(button("Скачать этот ключ ещё раз", () => saveKey(login, draft.mailboxKey)));
      prompt.append(button("Ключ сохранён, применить", () => send(newIntent("account/mailbox/actions/configure", draft,
        result => validProfile(result) && result.configured && result.version === draft.expectedVersion + 1,
        result => { configureIntent = null; mail.replaceChildren(); profile = result; render(); })), true));
      prompt.append(button("Отмена", () => { if (busy || pending) return; configureIntent = null; prompt.remove(); }));
      actions.append(prompt); controls();
    }
    function render() {
      identity.replaceChildren();
      const id = field(identity, "ID вашей учётной записи", "accountId", { readOnly: true, required: false }); id.value = account;
      identity.append(node("p", "Передайте этот ID для приглашения в рабочую область.", "muted"));
      actions.replaceChildren();
      status.textContent = profile?.configured ? (profile.confirmed ? "Контакт подтверждён: " : "Контакт ещё не подтверждён: ") + profile.address : "Внутренняя почта ещё не настроена. Для настройки снова войдите в кабинет.";
      actions.append(button("Обновить состояние", () => run(load)));
      actions.append(button("Передача управления областью", () => run(showOwnership)));
      actions.append(button(profile?.configured ? "Заменить ключ внутренней почты" : "Настроить внутреннюю почту", () => {
        if (!profile || busy || pending || externalBusy || externalMutationLock) return;
        if (configureIntent) { status.textContent = "Сначала примените или отмените уже подготовленный ключ."; return; }
        if (profile.configured && !globalThis.confirm("Старый ключ перестанет открывать ящик. Контакт потребуется подтвердить повторно. Продолжить?")) return;
        try {
          configureIntent = { mailboxKey: randomKey(), requestId: crypto.randomUUID(), expectedVersion: profile.version };
          saveKey(login, configureIntent.mailboxKey); renderKeyPrompt();
        } catch (_) { configureIntent = null; status.textContent = "Не удалось создать или скачать ключ. Откройте защищённую версию сайта или обратитесь в поддержку."; }
      }));
      if (profile?.configured) {
        actions.append(button("Отправить код подтверждения", () => {
          if (busy || pending || externalBusy || externalMutationLock) return;
          const requestId = crypto.randomUUID();
          send(newIntent("account/contact/actions/request", { requestId }, result => result?.accepted === true,
            () => { mail.replaceChildren(); status.textContent = "Письмо отправлено в внутреннюю почту."; }));
        }));
        actions.append(button("Открыть мою внутреннюю почту", () => run(async ticket => {
          const result = await request("account/mailbox"); if (ticket !== epoch) return;
          letters(mail, result, item => {
            if (item.purpose !== "contact") { status.textContent = "Восстановление пароля выполняется в форме входа."; return; }
            send(newIntent("account/contact/actions/confirm", { messageId: item.id, code: item.code }, result => result?.confirmed === true,
              () => { mail.replaceChildren(); profile = { ...profile, confirmed: true }; render(); }));
          });
        })));
      }
      renderKeyPrompt(); controls();
    }
    function setContext(context) {
      const nextActor = typeof context?.actorId === "string" ? context.actorId : "";
      const nextAccount = typeof context?.accountId === "string" ? context.accountId : "";
      if (!uuid.test(nextActor) || !uuid.test(nextAccount)) { clear(); return; }
      if (actor === nextActor && account === nextAccount) { login = typeof context.login === "string" ? context.login : login; return; }
      clear(); actor = nextActor; account = nextAccount; login = typeof context.login === "string" ? context.login : "";
      root.hidden = false; render();
      status.textContent = "Загружаем контакт…";
      initialLoadPending = true; flushInitialLoad();
    }
    return Object.freeze({ setContext, clear,
      setExternalBusy(value) { externalBusy = Boolean(value); controls(); flushInitialLoad(); },
      setExternalMutationLock(value) { externalMutationLock = Boolean(value); controls(); flushInitialLoad(); }
    });
  }
  globalThis.VodokanalIdentity = Object.freeze({ createAccount, clearPublic() { clearPublic(); } });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAuth, { once: true }); else mountAuth();
})();
