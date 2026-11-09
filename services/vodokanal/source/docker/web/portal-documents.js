
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MIMES = Object.freeze({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", csv: "text/csv" });
  const TYPES = { incoming: "Входящее приложение", request: "Приложение к обращению", export: "Исходящий документ" };
  const STATES = { Draft: "Черновик", Submitted: "Передан", Archived: "В архиве", Active: "Действующий", Ready: "Готов", Deleted: "Удалён" };
  const MAX = 5 * 1024 * 1024;
  function bad() { const error = new Error("Некорректный ответ сервера"); error.code = "некорректно_ответ"; return error; }
  function text(v, n = 4000) { if (typeof v !== "string" || v.length > n) throw bad(); return v; }
  function id(v) { if (!UUID.test(text(v, 36))) throw bad(); return v; }
  function number(v, min, max) { if (!Number.isInteger(v) || v < min || v > max) throw bad(); return v; }
  function dto(v) {
    if (!v || typeof v !== "object" || !TYPES[v.kind] || !STATES[v.state]) throw bad();
    const row = {};
    for (const key of ["id", "kind", "objectType", "objectId", "ownerAccountId", "workspaceId", "areaId", "state", "revisionId", "previousRevisionId", "filename", "mime", "sha256", "createdAt", "reason"]) row[key] = text(v[key]);
    id(row.id); id(row.ownerAccountId); id(row.revisionId);
    for (const key of ["objectId", "workspaceId", "areaId", "previousRevisionId"]) if (row[key]) id(row[key]);
    if (!Object.values(MIMES).includes(row.mime) || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/.test(row.filename) || !/^[A-Za-z0-9+/]{43}=$/.test(row.sha256)) throw bad();
    row.revision = number(v.revision, 1, 100); row.version = number(v.version, 1, 100); if (row.version !== row.revision) throw bad(); row.byteCount = number(v.byteCount, 1, MAX);
    if (row.kind === "export") { row.expiresAt = text(v.expiresAt, 30); row.sourceKind = text(v.sourceKind, 32); }
    return row;
  }
  async function validateReceipt(intent, row) {
    const body = intent.body, parts = intent.path.split("/");
    if (intent.path === "exports") {
      if (row.kind !== "export" || row.state !== "Ready" || row.sourceKind !== body.sourceKind || row.mime !== (body.format === "pdf" ? MIMES.pdf : MIMES.csv)) throw bad();
      return;
    }
    if (row.kind !== "incoming" || row.objectType !== "labOrder") throw bad();
    if (intent.path === "documents") {
      if (row.objectId !== body.objectId || row.state !== "Draft" || row.version !== 1 || row.previousRevisionId) throw bad();
    } else {
      if (parts[0] !== "documents" || row.id !== parts[1]) throw bad();
      if (parts[2] === "versions") {
        if (row.version !== body.expectedVersion + 1 || !row.previousRevisionId || row.reason !== body.reason || !["Draft", "Submitted"].includes(row.state)) throw bad();
      } else if (parts[2] === "actions") {
        if (row.version !== body.expectedVersion || row.state !== ({ submit: "Submitted", archive: "Archived", delete: "Deleted" })[parts[3]]) throw bad();
      } else throw bad();
    }
    if (body.contentBase64 !== undefined) {
      const binary = atob(body.contentBase64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (row.filename !== body.filename || row.mime !== body.mime || row.byteCount !== bytes.length) throw bad();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      if (row.sha256 !== btoa(String.fromCharCode(...digest))) throw bad();
    }
  }
  function create({ root, request, requestBinary, setGlobalBusy = () => {}, onSessionError = () => false, onMutationLock = () => {} }) {
    if (!root || typeof request !== "function" || typeof requestBinary !== "function") throw new Error("Контейнер документов недоступен");
    const doc = root.ownerDocument;
    let context = { accountId: "", workspaceId: "" }, epoch = 0, running = false, externalBusy = false, controller = null, pending = null;
    let rows = [], cursor = "", more = false, selected = null, orders = [], orderCursor = "", orderMore = false;
    let appliedFilters = "", listGeneration = 0;
    const urls = new Set();
    function el(tag, value, cls = "") { const node = doc.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node; }
    function button(label, fn) { const node = el("button", label); node.type = "button"; node.addEventListener("click", fn); return node; }
    function input(label, type = "text") { const wrap = el("label", label); const control = el("input"); control.type = type; wrap.append(control); return { wrap, control }; }
    function select(label, options) { const wrap = el("label", label), control = el("select"); for (const [value, name] of options) { const opt = el("option", name); opt.value = value; control.append(opt); } wrap.append(control); return { wrap, control }; }
    const shell = el("section", undefined, "documents-ui"), heading = el("h2", "Мои документы"), status = el("p", "Загрузите список документов.", "doc-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const description = el("p", "Входящие приложения, файлы обращений и подготовленные исходящие документы хранятся отдельно.", "doc-muted");
    const filters = el("form", undefined, "doc-filters"), kind = select("Вид", [["", "Все виды"], ...Object.entries(TYPES)]), state = select("Состояние", [["", "Любое"], ...Object.entries(STATES).filter(([k]) => k !== "Deleted")]);
    const from = input("С даты", "date"), to = input("По дату", "date"), objectId = input("ID связанного объекта (необязательно)"); objectId.control.maxLength = 36;
    const refresh = button("Показать документы", () => load(false));
    filters.append(kind.wrap, state.wrap, from.wrap, to.wrap, objectId.wrap, refresh); filters.addEventListener("submit", event => { event.preventDefault(); load(false); });
    const toolbar = el("div", undefined, "doc-actions"), list = el("div", undefined, "doc-list"), detail = el("div", undefined, "doc-detail"), upload = el("div", undefined, "doc-upload"), command = el("div", undefined, "doc-command");
    const next = button("Показать ещё", () => load(true)); next.hidden = true;
    toolbar.append(button("Новое приложение к заказу", () => openUpload()), button("Реестр CSV", () => exportRegistry("csv")), button("Печатный реестр PDF", () => exportRegistry("pdf")));
    shell.append(heading, description, filters, toolbar, status, command, upload, list, next, detail); root.replaceChildren(shell);
    function note(value, error = false) { status.textContent = value; status.classList.toggle("doc-error", error); }
    function controls() { for (const node of shell.querySelectorAll("button,input,select,textarea")) node.disabled = running || externalBusy || !context.accountId || node.dataset.disabled === "true"; shell.setAttribute("aria-busy", String(running)); }
    function filtersBody() { const p = { kind: kind.control.value, state: state.control.value, from: from.control.value, to: to.control.value, objectId: objectId.control.value.trim() }; if (p.objectId && !UUID.test(p.objectId)) throw new Error("Укажите полный ID объекта или оставьте поле пустым."); if (p.from && p.to && p.from > p.to) throw new Error("Начальная дата не может быть позже конечной."); return p; }
    function filterKey() { return JSON.stringify([kind.control.value, state.control.value, from.control.value, to.control.value, objectId.control.value.trim()]); }
    function clearListing() {
      listGeneration += 1; appliedFilters = ""; rows = []; cursor = ""; more = false; selected = null;
      detail.replaceChildren(); renderRows();
    }
    function filtersChanged() { clearListing(); note("Условия изменены. Нажмите «Показать документы», чтобы загрузить новый список."); }
    for (const field of [kind, state, from, to, objectId]) { field.control.addEventListener("input", filtersChanged); field.control.addEventListener("change", filtersChanged); }
    function message(error) { return error.code === "некорректно_ответ" ? "Получен некорректный ответ. Данные не приняты." : error.status === 403 || error.status === 404 ? "Документ или его источник недоступен. Содержимое закрыто." : error.status === 409 ? "Состояние изменилось. Обновите карточку перед новой операцией." : error.status === 429 ? "Достигнут лимит. Повторите позже." : error.status === 400 || error.status === 413 ? "Проверьте формат, имя, размер файла и заполненные поля." : error.message && !error.status ? error.message : "Ответ сервера не получен. Результат записи может быть неизвестен."; }
    function uncertain(error) { return !error.status || error.status >= 500 || error.code === "некорректно_ответ"; }
    async function run(fn) {
      if (running || externalBusy || !context.accountId) return;
      const ticket = epoch, own = new AbortController(); controller = own; running = true; controls(); setGlobalBusy(true);
      try { await fn(ticket, own.signal); } catch (error) { if (ticket === epoch && !onSessionError(error)) note(message(error), true); }
      finally { if (controller === own) controller = null; if (ticket === epoch) { running = false; setGlobalBusy(false); controls(); } }
    }
    function renderRows() {
      list.replaceChildren();
      if (!rows.length) list.append(el("p", "По выбранным условиям документы не загружены."));
      for (const row of rows) {
        const item = el("article", undefined, "doc-row"); item.append(el("h3", row.filename), el("p", `${TYPES[row.kind]} · ${STATES[row.state]} · редакция ${row.revision}`), el("p", `${Math.ceil(row.byteCount / 1024)} КиБ · ${row.createdAt.replace("T", " ")} UTC`, "doc-muted"));
        if (row.objectId) item.append(el("p", "Объект: " + row.objectId, "doc-id"));
        const actions = el("div", undefined, "doc-actions"); actions.append(button("Скачать", () => download(row)));
        if (row.kind === "incoming") actions.append(button("Карточка и версии", () => openCard(row)));
        if (row.kind === "export") item.append(el("p", "Доступен до " + row.expiresAt.replace("T", " ") + " UTC. Доступ к источнику проверяется при каждом скачивании.", "doc-muted"));
        item.append(actions); list.append(item);
      }
      next.hidden = !more; controls();
    }
    async function load(append) {
      await run(async (ticket, signal) => {
        const queryKey = filterKey();
        if (append && queryKey !== appliedFilters) { filtersChanged(); return; }
        const generation = listGeneration;
        const p = filtersBody(), sentCursor = append ? cursor : ""; p.limit = "25"; if (sentCursor) p.cursor = sentCursor;
        const value = await request("documents?" + new URLSearchParams(p), { signal }); if (ticket !== epoch) return;
        if (generation !== listGeneration || queryKey !== filterKey()) { if (generation === listGeneration) filtersChanged(); return; }
        if (!value || value.limit !== 25 || !Array.isArray(value.items) || value.items.length > 25 || typeof value.hasMore !== "boolean") throw bad();
        const loaded = value.items.map(dto), seen = new Set(append ? rows.map(row => row.kind + ":" + row.id) : []);
        for (const row of loaded) { if (row.ownerAccountId !== context.accountId || seen.has(row.kind + ":" + row.id)) throw bad(); seen.add(row.kind + ":" + row.id); }
        const newCursor = text(value.nextCursor, 80); if (value.hasMore && (!loaded.length || !newCursor || newCursor === sentCursor)) throw bad(); if (!value.hasMore && newCursor) throw bad();
        rows = append ? [...rows, ...loaded] : loaded; cursor = newCursor; more = value.hasMore; if (!append) { detail.replaceChildren(); selected = null; }
        appliedFilters = queryKey;
        renderRows(); note("Загружено документов: " + rows.length + (more ? ". Есть продолжение." : ". Список завершён."));
      });
    }
    async function download(row, version = row.revision) {
      await run(async (ticket, signal) => {
        let path = row.kind === "export" ? `exports/${id(row.id)}/download` : row.kind === "request" ? `my/request-files/${id(row.id)}/versions/${number(version, 1, 100)}/content` : `documents/${id(row.id)}/download?version=${number(version, 1, 100)}`;
        const blob = await requestBinary(path, row.mime, signal); if (ticket !== epoch) return;
        if (!(blob instanceof Blob) || blob.size !== row.byteCount || blob.size > MAX) throw bad();
        const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())); let binary = ""; for (const byte of sum) binary += String.fromCharCode(byte);
        if (btoa(binary) !== row.sha256 || ticket !== epoch) throw bad();
        const url = URL.createObjectURL(blob); urls.add(url); const anchor = el("a"); anchor.href = url; anchor.download = row.filename; shell.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { if (urls.delete(url)) URL.revokeObjectURL(url); }, 1000); note("Файл передан браузеру для сохранения. Имя, размер и хеш проверены.");
      });
    }
    async function openCard(row) {
      await run(async (ticket, signal) => {
        const value = await request("documents/" + id(row.id), { signal }); if (ticket !== epoch) return;
        const current = dto(value.document); if (current.kind !== "incoming" || current.objectType !== "labOrder" || current.id !== row.id || current.ownerAccountId !== context.accountId || !Array.isArray(value.versions) || value.versions.length !== current.revision) throw bad();
        const versions = value.versions.map(dto), revisionIds = new Set();
        versions.forEach((v, i) => {
          if (["id", "kind", "objectType", "objectId", "ownerAccountId", "workspaceId", "areaId", "state"].some(key => v[key] !== current[key]) || v.revision !== i + 1 || v.previousRevisionId !== (i ? versions[i - 1].revisionId : "") || revisionIds.has(v.revisionId)) throw bad();
          revisionIds.add(v.revisionId);
        });
        if (JSON.stringify(versions[versions.length - 1]) !== JSON.stringify(current)) throw bad();
        selected = current; detail.replaceChildren(el("h3", current.filename), el("p", `Состояние: ${STATES[current.state]}. Предыдущие редакции сохраняются без перезаписи.`));
        const actions = el("div", undefined, "doc-actions");
        if (["Draft", "Submitted"].includes(current.state)) actions.append(button("Заменить новой редакцией", () => openUpload(current)));
        if (current.state === "Draft") actions.append(button("Передать документ", () => changeState(current, "submit")), button("Удалить черновик", () => changeState(current, "delete")));
        if (current.state === "Submitted") actions.append(button("Архивировать", () => changeState(current, "archive")));
        detail.append(actions);
        for (const v of versions.slice().reverse()) { const line = el("div", undefined, "doc-version"); line.append(el("p", `Редакция ${v.revision}: ${v.reason}`), el("p", v.sha256, "doc-id"), button("Скачать редакцию " + v.revision, () => download(v, v.revision))); detail.append(line); }
        controls();
      });
    }
    async function orderPage(append, selectControl, nextControl) {
      await run(async (ticket, signal) => {
        const previous = selectControl.value, value = await request("lab/my/orders" + (append && orderCursor ? "?afterId=" + id(orderCursor) : ""), { signal });
        if (ticket !== epoch) return; if (!value || !Array.isArray(value.items) || value.items.length > 100 || typeof value.hasMore !== "boolean") throw bad();
        const items = value.items.map(item => ({ id: id(item.id), state: text(item.state), createdAt: text(item.createdAt) })); const seen = new Set(append ? orders.map(item => item.id) : []);
        for (const item of items) { if (seen.has(item.id)) throw bad(); seen.add(item.id); }
        orderCursor = text(value.nextCursor, 36); orderMore = value.hasMore; if (orderMore && !UUID.test(orderCursor)) throw bad();
        orders = append ? orders.concat(items) : items; selectControl.replaceChildren();
        for (const order of orders.filter(item => item.state !== "Cancelled")) { const option = el("option", order.createdAt.slice(0, 10) + " · " + order.id); option.value = order.id; selectControl.append(option); }
        if (orders.some(item => item.id === previous)) selectControl.value = previous; nextControl.hidden = !orderMore;
        if (!orders.length) note("Сначала создайте свой заказ в разделе «Лаборатория»."); controls();
      });
    }
    function openUpload(replace = null) {
      if (pending) { note("Сначала подтвердите результат отправленной операции.", true); return; }
      upload.replaceChildren(); const form = el("form", undefined, "doc-upload-form"), title = el("h3", replace ? "Новая редакция приложения" : "Приложение к лабораторному заказу");
      const file = input("Файл: PDF, PNG, JPEG, TXT или CSV; до 5 МиБ", "file"); file.control.accept = ".pdf,.png,.jpg,.jpeg,.txt,.csv"; file.control.required = true;
      const reason = input("Причина замены"); reason.control.maxLength = 250; reason.control.required = Boolean(replace);
      const order = select("Мой заказ", []), orderNext = button("Ещё заказы", () => orderPage(true, order.control, orderNext)); orderNext.hidden = true;
      form.append(title, el("p", "В имени файла допустимы латинские буквы, цифры, пробел и символы - . _. Файл останется в кабинете и не заменит утверждённый протокол.", "doc-muted"));
      if (!replace) { form.append(order.wrap, button("Загрузить мои заказы", () => orderPage(false, order.control, orderNext)), orderNext); }
      else form.append(reason.wrap);
      form.append(file.wrap); const submit = el("button", "Сохранить приложение"); submit.type = "submit"; form.append(submit, button("Закрыть", () => upload.replaceChildren()));
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (pending || running || externalBusy) return;
        const preparedAt = epoch; let intent = null;
        await run(async ticket => {
          const chosen = file.control.files?.[0]; if (!chosen || !chosen.size || chosen.size > MAX) throw new Error("Выберите один файл размером от 1 байта до 5 МиБ.");
          const ext = chosen.name.split(".").pop().toLowerCase(), mime = MIMES[ext];
          if (!mime || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/.test(chosen.name) || chosen.name.includes("..")) throw new Error("Проверьте тип и имя файла.");
          const bytes = new Uint8Array(await chosen.arrayBuffer()); if (ticket !== epoch) return;
          let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          const body = { filename: chosen.name, mime, contentBase64: btoa(binary) };
          if (replace) { body.expectedVersion = replace.version; body.reason = reason.control.value.trim(); if (!body.reason) throw new Error("Укажите причину замены."); }
          else { body.objectType = "labOrder"; body.objectId = id(order.control.value); body.field = "labOrderAttachment"; }
          intent = { path: replace ? "documents/" + replace.id + "/versions" : "documents", body, key: crypto.randomUUID(), accountId: context.accountId };
        });
        if (intent && preparedAt === epoch) await send(intent);
      }); upload.append(form); controls();
    }
    function changeState(row, action) {
      if (pending) return; upload.replaceChildren(); const form = el("form", undefined, "doc-upload-form"), reason = input("Причина операции"); reason.control.required = true; reason.control.maxLength = 250;
      const labels = { submit: "Передать документ", archive: "Архивировать документ", delete: "Удалить черновик" }, confirm = el("button", labels[action]); confirm.type = "submit";
      form.append(el("h3", labels[action]), el("p", action === "delete" ? "Черновик исчезнет из списка. Эта операция не удаляет утверждённый результат лаборатории." : "Содержимое сохранённых редакций не изменяется."), reason.wrap, confirm, button("Отмена", () => upload.replaceChildren()));
      form.addEventListener("submit", event => { event.preventDefault(); if (!reason.control.value.trim() || pending) return; send({ path: `documents/${row.id}/actions/${action}`, body: { expectedVersion: row.version, reason: reason.control.value.trim() }, key: crypto.randomUUID(), accountId: context.accountId }); }); upload.append(form); controls();
    }
    function commandPanel() {
      command.replaceChildren(); onMutationLock(Boolean(pending));
      if (pending) { command.append(el("p", "Результат сохранения неизвестен. Повторите ту же операцию кнопкой ниже."), button("Повторить ту же операцию", () => send(pending))); }
      controls();
    }
    async function send(intent) {
      if (intent.accountId !== context.accountId) return;
      await run(async (ticket, signal) => {
        const retrying = pending === intent; pending = intent; commandPanel();
        try {
          const row = dto(await request(intent.path, { method: "POST", body: intent.body, headers: { "Idempotency-Key": intent.key }, signal })); if (ticket !== epoch) return;
          if (row.ownerAccountId !== context.accountId) throw bad();
          await validateReceipt(intent, row); if (ticket !== epoch) return;
          pending = null; commandPanel(); upload.replaceChildren(); selected = row; detail.replaceChildren(); rows = []; cursor = ""; more = false; renderRows();
          listGeneration += 1; appliedFilters = "";
          if (row.state !== "Deleted") { detail.append(el("h3", "Операция подтверждена"), el("p", row.filename + " · " + STATES[row.state]), button("Скачать", () => download(row))); }
          note("Изменение сохранено. Обновите список документов.");
        } catch (error) { if (ticket !== epoch) return; if (!retrying && !uncertain(error)) pending = null; commandPanel(); throw error; }
      });
    }
    function exportRegistry(format) {
      if (pending) { note("Сначала подтвердите результат предыдущей операции.", true); return; }
      try { send({ path: "exports", body: { sourceKind: "documentRegistry", parameters: filtersBody(), format }, key: crypto.randomUUID(), accountId: context.accountId }); }
      catch (error) { note(message(error), true); }
    }
    function reset() {
      const ownedBusy = running;
      epoch += 1; controller?.abort(); controller = null; running = false; pending = null; onMutationLock(false); context = { accountId: "", workspaceId: "" };
      if (ownedBusy) setGlobalBusy(false);
      rows = []; cursor = ""; more = false; selected = null; orders = []; orderCursor = ""; orderMore = false;
      listGeneration += 1; appliedFilters = "";
      for (const url of urls) URL.revokeObjectURL(url); urls.clear(); command.replaceChildren(); detail.replaceChildren(); upload.replaceChildren(); renderRows(); note("Войдите, чтобы открыть свои документы.");
    }
    function syncContext(value) { const accountId = UUID.test(value?.accountId || "") ? value.accountId : ""; if (accountId !== context.accountId) reset(); context = { accountId, workspaceId: value?.workspaceId || "" }; controls(); }
    function setExternalBusy(value) { externalBusy = Boolean(value); controls(); }
    controls(); return Object.freeze({ syncContext, reset, setExternalBusy });
  }
  globalThis.VodokanalDocuments = Object.freeze({ create });
})();
