
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STATES = Object.freeze({ Draft: "Черновик", Submitted: "Подано", NeedsInfo: "Нужно уточнение", Registered: "Зарегистрировано", InAnalysis: "В работе", Review: "На утверждении", Approved: "Утверждено", Archived: "В архиве", Rejected: "Отклонено", Cancelled: "Отменено" });
  const LABELS = Object.freeze({ lake: "Озерная вода", tap: "Водопроводная вода", well: "Колодезная вода", shore: "Берег", center: "Центр водоема", intake: "Водозабор", customer: "Самостоятельный отбор", courier: "Отбор курьером", basic: "Базовая панель", extended: "Расширенная панель", ph: "pH", turbidity: "Мутность", appearance: "Внешний вид", temperature: "Температура", clear: "Прозрачная", turbid: "Мутная" });
  const OPERATIONS = Object.freeze({ "sample.create": "Создание пробы", "order.create": "Создание заказа", "order.submit": "Подача заказа", "order.cancel": "Отмена заказа", "sample.register": "Регистрация пробы", "sample.ask-info": "Запрос уточнения", "sample.answer": "Ответ владельца", "sample.reject": "Отклонение пробы", "sample.assign": "Назначение лаборанта", "sample.start-analysis": "Начало исследования", "sample.archive": "Архивация", "sample.correct": "Начало исправления", "sample.results": "Ввод результатов", "sample.approve": "Утверждение протокола", "sample.rework": "Возврат на доработку" });
  const SAMPLE_KEYS = "id,orderId,workspaceId,areaId,lakeCode,waterType,placeCode,source,location,collectedAt,conditions,panel,registrationNumber,clarification,lastReason,state,revision,createdAt,updatedAt,approvedVersion".split(",");
  const ORDER_KEYS = "id,workspaceId,areaId,contact,collectionMethod,estimatedCost,state,revision,createdAt,updatedAt".split(",");
  function invalid() { const error = new Error("Некорректный ответ лаборатории"); error.status = 200; error.code = "некорректно_ответ"; return error; }
  function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value; }
  function str(value, max = 8192) { if (typeof value !== "string" || value.length > max) throw invalid(); return value; }
  function id(value) { if (!UUID.test(str(value, 36))) throw invalid(); return value; }
  function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw invalid(); return value; }
  function array(value, max) { if (!Array.isArray(value) || value.length > max) throw invalid(); return value; }
  function pick(value, keys) { object(value); const out = {}; for (const key of keys) out[key] = value[key]; return out; }
  function utcTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value)) throw invalid();
    const wire = value.endsWith("Z") ? value : value + "Z";
    const time = Date.parse(wire);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) + "Z" !== wire) throw invalid();
    return time;
  }
  function collectedAt(value, now = Date.now()) {
    if (typeof value !== "string" || !value.endsWith("Z")) throw new Error("Укажите время UTC в формате ГГГГ-ММ-ДДTчч:мм:ссZ.");
    let time; try { time = utcTimestamp(value); } catch (_) { throw new Error("Проверьте календарную дату и время UTC."); }
    if (time < Date.UTC(2000, 0, 1) || time > now) throw new Error("Дата отбора должна быть с 2000 года и не позднее текущего UTC.");
    return value;
  }
  function dateLabel(value) { return new Date(utcTimestamp(value)).toISOString().slice(0, 19).replace("T", " ") + " UTC"; }
  function unitLabel(value) { return value.kind === "qualitative" && value.unit === "code" ? "Качественное значение" : value.unit === "C" ? "°C" : value.unit; }
  function textInput(value, max, multiline = false) {
    if (typeof value !== "string" || !value.trim() || value.length > max || (multiline ? /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) throw new Error("Введите непустой текст до " + max + " символов без управляющих знаков.");
    return value;
  }
  function sampleDTO(value) {
    const out = pick(value, SAMPLE_KEYS);
    for (const key of ["id", "orderId", "workspaceId", "areaId"]) id(out[key]);
    for (const key of SAMPLE_KEYS.filter(key => !["revision", "approvedVersion"].includes(key))) str(out[key]);
    if (!STATES[out.state]) throw invalid();
    integer(out.revision, 1, 200); integer(out.approvedVersion, 0, 20);
    for (const key of ["collectedAt", "createdAt", "updatedAt"]) utcTimestamp(out[key]);
    return out;
  }
  function orderDTO(value, full = false) {
    const out = pick(value, ORDER_KEYS);
    for (const key of ["id", "workspaceId", "areaId"]) id(out[key]);
    for (const key of ["contact", "collectionMethod", "state", "createdAt", "updatedAt"]) str(out[key]);
    if (!["Draft", "Submitted", "Cancelled"].includes(out.state)) throw invalid();
    integer(out.revision, 1, 200); integer(out.estimatedCost, 0, 100000);
    utcTimestamp(out.createdAt); utcTimestamp(out.updatedAt);
    if (full) {
      out.samples = array(value.samples, 5).map(sampleDTO);
      if (!out.samples.length || out.samples.some(sample => sample.orderId !== out.id || sample.workspaceId !== out.workspaceId || sample.areaId !== out.areaId)) throw invalid();
    }
    return out;
  }
  function validateReference(value) {
    object(value);
    const out = { dictionaryVersion: str(value.dictionaryVersion), source: str(value.source), warning: str(value.warning) };
    out.lakes = array(value.lakes, 10).map(item => ({ code: str(object(item).code, 32), name: str(item.name, 100), public: item.public === true }));
    for (const key of ["waterTypes", "places", "collectionMethods"]) out[key] = array(value[key], 20).map(item => str(item, 32));
    out.panels = array(value.panels, 10).map(item => ({ code: str(object(item).code, 32), estimatedCost: integer(item.estimatedCost, 0, 100000), indicatorCodes: array(item.indicatorCodes, 8).map(code => str(code, 32)) }));
    out.indicators = array(value.indicators, 8).map(item => ({ code: str(object(item).code, 32), kind: str(item.kind, 32), unit: str(item.unit, 32), method: str(item.method, 64) }));
    if (!out.lakes.length || !out.panels.length || !out.waterTypes.length || !out.places.length || !out.collectionMethods.length) throw invalid();
    return out;
  }
  function protocolDTO(value, sampleId) {
    const out = pick(value, "sampleId,protocolId,version,previousApprovedProtocolId,lakeCode,lakeName,collectedAt,approvedAt,state,dictionaryVersion,source,warning,registrationNumber,location,collectionSource,conditions,correctionReason".split(","));
    if (id(out.sampleId) !== sampleId || out.state !== "Approved") throw invalid();
    id(out.protocolId); if (out.previousApprovedProtocolId !== "") id(out.previousApprovedProtocolId);
    integer(out.version, 1, 20); utcTimestamp(out.collectedAt); utcTimestamp(out.approvedAt);
    for (const key of Object.keys(out).filter(key => key !== "version")) str(out[key]);
    out.values = array(value.values, 8).map(item => ({ indicatorCode: str(object(item).indicatorCode, 32), value: str(item.value, 32), kind: str(item.kind, 32), unit: str(item.unit, 32), method: str(item.method, 64) }));
    if (!out.values.length) throw invalid(); return out;
  }
  function privateDTO(value, sampleId, withText) {
    object(value); if (id(value.sampleId) !== sampleId) throw invalid();
    const out = { sampleId, versionId: id(value.versionId), version: integer(value.version, 1, 20), createdAt: str(value.createdAt) };
    utcTimestamp(out.createdAt);
    if (withText) out.text = str(value.text, 8192);
    return out;
  }
  function commandReceipt(raw, intent) {
    const value = intent.kind === "orders" ? orderDTO(raw, true) : sampleDTO(raw);
    if (intent.targetId && value.id !== intent.targetId) throw invalid();
    if (!intent.targetId) {
      if (value.state !== "Draft" || value.revision !== 1 || value.workspaceId !== intent.body.workspaceId || value.areaId !== intent.body.areaId || value.contact !== intent.body.contact || value.collectionMethod !== intent.body.collectionMethod) throw invalid();
      const fingerprint = sample => JSON.stringify([sample.lakeCode, sample.waterType, sample.placeCode, sample.source, sample.location, utcTimestamp(sample.collectedAt), sample.conditions, sample.panel]);
      const expected = intent.body.samples.map(fingerprint).sort(), received = value.samples.map(fingerprint).sort();
      if (JSON.stringify(expected) !== JSON.stringify(received) || new Set(value.samples.map(sample => sample.id)).size !== received.length || value.samples.some(sample => sample.revision !== 1 || sample.state !== "Draft" || sample.approvedVersion !== 0)) throw invalid();
    } else {
      const expectedState = intent.action === "submit" || intent.action === "answer" ? "Submitted" : "Cancelled";
      if (value.revision !== intent.body.expectedRevision + 1 || value.state !== expectedState) throw invalid();
      const before = intent.before;
      const stable = intent.kind === "orders" ? ["id", "workspaceId", "areaId", "contact", "collectionMethod", "estimatedCost", "createdAt"] : SAMPLE_KEYS.filter(key => !["state", "revision", "updatedAt", "lastReason", "clarification"].includes(key));
      if (stable.some(key => value[key] !== before[key])) throw invalid();
      if (intent.kind === "samples") {
        if (value.clarification !== intent.body.reason || value.lastReason !== intent.body.reason) throw invalid();
      } else {
        if (value.samples.length !== before.samples.length) throw invalid();
        for (const sample of value.samples) {
          const prior = before.samples.find(item => item.id === sample.id);
          if (!prior || sample.revision <= prior.revision || sample.state !== (intent.action === "submit" ? "Submitted" : "Rejected") || sample.lastReason !== intent.body.reason || SAMPLE_KEYS.filter(key => !["state", "revision", "updatedAt", "lastReason", "clarification"].includes(key)).some(key => sample[key] !== prior[key])) throw invalid();
        }
      }
    }
    return value;
  }
  function create({ root, request, requestBinary, setGlobalBusy = () => {}, onSessionError = () => false }) {
    if (!root || typeof request !== "function" || typeof requestBinary !== "function") throw new Error("Не подключены зависимости лаборатории");
    const doc = root.ownerDocument;
    const el = (tag, className, text, elementId) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; if (elementId) node.id = elementId; return node; };
    let generation = 0, selection = 0, externalBusy = false, busyEpoch = 0, running = false, contextKey = "", activeTask = null;
    let context = { accountId: "", workspaceId: "", areas: [], canCreateAreaIds: [] };
    let state = initialState();
    let command = null;
    let privatePanel = null, privateReceipt = null;
    const controllers = new Set(), objectURLs = new Set();
    const shell = el("div", "lab-content"), heading = el("h2", "", "Лаборатория", "lab-heading");
    const warning = el("p", "lab-warning", "Результаты лабораторных исследований.");
    const status = el("p", "lab-status", "Загрузите мои пробы или создайте заказ.", "lab-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const commandHost = el("div", "lab-actions"), toolbar = el("div", "lab-toolbar"), tabs = el("div", "lab-tabs");
    const listHost = el("div", "lab-list", undefined, "lab-list"), detailHost = el("div", "lab-detail-panel", undefined, "lab-detail");
    const formHost = el("div", "lab-form-host"), listPanel = el("div", "lab-list-panel"), grid = el("div", "lab-grid");
    const refresh = button("Загрузить мои пробы", "lab-refresh", () => loadList(false));
    const createOpen = button("Новый заказ", "lab-create-open", openCreate, "lab-primary");
    const samplesTab = button("Мои пробы", "lab-tab-samples", () => switchList("samples"));
    const ordersTab = button("Заказы", "lab-tab-orders", () => switchList("orders"));
    const listNext = button("Следующая страница", "lab-list-next", () => loadList(true));
    toolbar.append(refresh, createOpen); tabs.append(samplesTab, ordersTab); listPanel.append(tabs, listHost, listNext); grid.append(listPanel, detailHost);
    shell.append(heading, toolbar, status, commandHost, formHost, grid); root.replaceChildren(shell);
    function initialState() { return { reference: null, mode: "samples", items: [], loaded: false, hasMore: false, cursor: "", selected: null, selectedKind: "", history: [], historyCursor: 0, historyMore: false, protocol: null, form: null }; }
    function button(text, elementId, fn, extra = "") {
      const node = el("button", "lab-button" + (extra ? " " + extra : ""), text, elementId); node.type = "button";
      node.addEventListener("click", async event => { event.preventDefault(); if (node.disabled) return; try { await fn(event); } catch (error) { report(error); } });
      return node;
    }
    function field(parent, label, inputId, type = "text", max = 0) {
      const wrap = el("div", "lab-field"), caption = el("label", "", label), input = el(type === "textarea" ? "textarea" : type === "select" ? "select" : "input", "", undefined, inputId);
      caption.htmlFor = inputId; if (!["textarea", "select"].includes(type)) input.type = type;
      if (max) input.maxLength = max;
      wrap.append(caption, input); parent.append(wrap); return input;
    }
    function options(select, values, label) { select.replaceChildren(...values.map(value => { const node = el("option", "", label(value)); node.value = typeof value === "string" ? value : value.code || value.id; return node; })); }
    function note(message, error = false) { status.textContent = message; status.className = error ? "lab-status lab-error" : "lab-status"; }
    function errorText(error) {
      const code = String(error?.code || "");
      let message = error?.status === 404 ? (Number.isInteger(error.labProtocolVersion) ? "Редакция недоступна. Это не подтверждает отсутствие других редакций." : "Объект или выбранная версия недоступны.") : error?.status === 403 ? "Для этой операции нет доступа." : error?.status === 409 ? "Данные изменились или команда недопустима. Перечитайте карточку и сверьте результат." : error?.status === 429 ? "Достигнут лимит операций. Повторите позже." : error?.status === 400 ? "Сервер отклонил параметры. Проверьте заполнение формы." : ["таймаут_ошибка", "сеть_ошибка"].includes(code) ? "Не удалось получить ответ сервера." : code === "некорректно_ответ" ? "Получен некорректный ответ сервера." : "Результат операции не подтвержден. Обновите данные.";
      if (/^[a-zA-ZА-Яа-яЁё0-9_-]{1,160}$/.test(code)) message += " Код: " + code + ".";
      if (/^[a-zA-Z0-9_-]{1,80}$/.test(error?.requestId || "")) message += " Запрос: " + error.requestId + ".";
      return message;
    }
    function report(error) { if (onSessionError(error)) return true; note(errorText(error), true); return false; }
    function fresh(ticket) { return ticket === generation && Boolean(context.accountId); }
    function canCreate() { return context.accountId && UUID.test(context.workspaceId) && context.areas.some(area => area.state === "Active" && context.canCreateAreaIds.includes(area.id)); }
    function block(node, disabled) { node.disabled = Boolean(disabled); }
    function updateBusy() {
      const busy = externalBusy || running || !context.accountId;
      for (const node of shell.querySelectorAll("button,input,select,textarea")) node.disabled = busy || node.dataset.labDisabled === "true";
      block(createOpen, busy || !canCreate() || Boolean(command) || Boolean(privateReceipt?.phase === "unknown"));
      block(listNext, busy || !state.hasMore);
      if (privatePanel) privatePanel.text.readOnly = privatePanel.readOnly || Boolean(privatePanel.pending);
      const primary = privatePanel ? privatePanel.save : state.form ? formHost.querySelector("#lab-order-create") : detailHost.querySelector("#lab-order-submit, #lab-sample-answer") || createOpen;
      for (const node of shell.querySelectorAll("button")) node.classList.toggle("lab-primary", node === primary);
      shell.setAttribute("aria-busy", String(running));
    }
    function flag(node, disabled) { node.dataset.labDisabled = String(Boolean(disabled)); node.disabled = Boolean(disabled) || externalBusy || running; }
    function abortAll() { for (const controller of controllers) controller.abort(); controllers.clear(); }
    function invalidateTask() {
      const task = activeTask; activeTask = null; running = false;
      if (task && task.busyEpoch === busyEpoch) setGlobalBusy(false);
    }
    async function get(path, signal) { return request(path, { signal }); }
    async function run(fn) {
      if (running || externalBusy || !context.accountId) return;
      const ticket = generation, controller = new AbortController(), task = {}; activeTask = task; controllers.add(controller); running = true; setGlobalBusy(true); task.busyEpoch = busyEpoch; updateBusy();
      try { await fn(ticket, controller.signal); }
      catch (error) { if (fresh(ticket)) report(error); }
      finally {
        controllers.delete(controller);
        if (activeTask === task) { activeTask = null; running = false; if (task.busyEpoch === busyEpoch) setGlobalBusy(false); updateBusy(); }
      }
    }
    function closePrivate() {
      if (privatePanel) { privatePanel.text.value = ""; privatePanel.pending = null; privatePanel.host.replaceChildren(); privatePanel = null; }
    }
    function clearSelection() { closePrivate(); selection += 1; state.selected = null; state.selectedKind = ""; state.history = []; state.protocol = null; detailHost.replaceChildren(); }
    function denied(error) { if (error?.status === 403 || error?.status === 404) clearSelection(); }
    function renderList() {
      samplesTab.setAttribute("aria-pressed", String(state.mode === "samples")); ordersTab.setAttribute("aria-pressed", String(state.mode === "orders"));
      refresh.textContent = state.loaded ? "Обновить список" : state.mode === "samples" ? "Загрузить мои пробы" : "Загрузить заказы";
      listHost.replaceChildren(el("p", "lab-muted", state.loaded ? "Загружено записей вашей учетной записи: " + state.items.length + ", включая архивные." : "Список еще не загружен."));
      if (state.loaded && !state.items.length) listHost.append(el("p", "lab-empty", "На этой странице записей нет."));
      for (const item of state.items) {
        const row = el("div", "lab-card"), title = state.mode === "samples" ? lakeName(item.lakeCode) + " · " + (item.registrationNumber || "Без регистрационного номера") : "Заказ · " + dateLabel(item.createdAt);
        const open = button(title, "lab-open-" + (state.mode === "samples" ? "sample-" : "order-") + item.id, () => openDetail(state.mode, item.id));
        row.append(open, el("span", "lab-badge", STATES[item.state]));
        if (state.mode === "samples") {
          const description = el("p", "lab-meta", "Отбор: " + dateLabel(item.collectedAt) + " · Место: " + item.location + " · Панель: " + (LABELS[item.panel] || item.panel), "lab-row-meta-" + item.id);
          open.setAttribute("aria-describedby", description.id); row.append(description);
        }
        listHost.append(row);
      }
      listNext.hidden = !state.hasMore; updateBusy();
    }
    function lakeName(code) { return state.reference?.lakes.find(lake => lake.code === code)?.name || ({ danilovo: "Данилово", lenyovo: "Ленёво", shchuchye: "Щучье", shaitan: "Шайтан", potaennoe: "Потаённое" })[code] || code; }
    async function ensureReference(ticket, signal) { if (!state.reference) { const value = validateReference(await get("lab/reference", signal)); if (!fresh(ticket)) return; state.reference = value; warning.textContent = value.warning; } }
    async function readList(ticket, signal, more) {
      const mode = state.mode, cursor = more ? state.cursor : "";
      const data = object(await get("lab/my/" + mode + (cursor ? "?afterId=" + id(cursor) : ""), signal));
      const items = array(data.items, 100).map(item => mode === "orders" ? orderDTO(item) : sampleDTO(item));
      if (typeof data.hasMore !== "boolean") throw invalid();
      const next = str(data.nextCursor, 36); if (data.hasMore && (!items.length || id(next) === cursor)) throw invalid();
      if (!fresh(ticket) || state.mode !== mode) return;
      state.items = more ? [...state.items, ...items.filter(item => !state.items.some(existing => existing.id === item.id))] : items;
      state.cursor = next; state.hasMore = data.hasMore; state.loaded = true; renderList();
    }
    async function loadList(more) { await run(async (ticket, signal) => {
      try { await ensureReference(ticket, signal); if (!fresh(ticket)) return; await readList(ticket, signal, more); if (fresh(ticket)) note("Список загружен. Для карточки выберите запись."); }
      catch (error) { if (fresh(ticket) && [403, 404].includes(error?.status)) { clearSelection(); state.items = []; state.loaded = false; state.cursor = ""; state.hasMore = false; renderList(); } throw error; }
    }); }
    async function switchList(mode) { if (mode !== state.mode) { clearSelection(); state.mode = mode; state.items = []; state.cursor = ""; state.hasMore = false; state.loaded = false; renderList(); } await loadList(false); }
    async function fetchCard(kind, targetId, signal) { const raw = await get("lab/my/" + kind + "/" + id(targetId), signal); const out = kind === "orders" ? orderDTO(raw, true) : sampleDTO(raw); if (out.id !== targetId) throw invalid(); return out; }
    async function openDetail(kind, targetId) {
      await run(async (ticket, signal) => { clearSelection(); const selected = selection;
        try { const value = await fetchCard(kind, targetId, signal); if (!fresh(ticket) || selected !== selection) return; state.selected = value; state.selectedKind = kind; renderDetail(); note("Карточка загружена."); }
        catch (error) { if (fresh(ticket)) denied(error); throw error; }
      });
    }
    function meta(parent, label, value) { parent.append(el("p", "lab-meta", label + ": " + value)); }
    function renderDetail() {
      closePrivate(); state.history = []; state.historyCursor = 0; state.historyMore = false; state.protocol = null;
      detailHost.replaceChildren(); const value = state.selected; if (!value) return;
      const kind = state.selectedKind; detailHost.append(el("h3", "", kind === "orders" ? "Заказ" : "Проба · " + lakeName(value.lakeCode)), el("span", "lab-badge", STATES[value.state]));
      const support = el("details", "lab-meta"); support.append(el("summary", "", "Сведения для поддержки")); meta(support, "Служебный код", value.id); meta(support, "Версия записи", value.revision); detailHost.append(support); meta(detailHost, "Создано", dateLabel(value.createdAt));
      detailHost.append(button("Обновить карточку", "lab-detail-refresh", () => openDetail(kind, value.id)));
      if (kind === "orders") {
        meta(detailHost, "Контакт", value.contact); meta(detailHost, "Отбор", LABELS[value.collectionMethod] || value.collectionMethod); meta(detailHost, "Предварительная стоимость", value.estimatedCost + " руб.");
        const allDraft = value.samples.every(sample => sample.state === "Draft"), cancelable = ["Draft", "Submitted"].includes(value.state) && value.samples.every(sample => ["Draft", "Submitted", "NeedsInfo"].includes(sample.state));
        if ((value.state === "Draft" && allDraft) || cancelable) {
          const reason = field(detailHost, "Комментарий к действию (обязателен)", "lab-action-reason", "text", 500), actions = el("div", "lab-actions");
          if (value.state === "Draft" && allDraft) actions.append(button("Подать заказ", "lab-order-submit", () => ordinaryAction("submit", value, reason), "lab-primary"));
          if (cancelable) actions.append(button("Отменить заказ", "lab-order-cancel", () => ordinaryAction("cancel", value, reason), "lab-danger")); detailHost.append(actions);
        }
        detailHost.append(el("h4", "", "Пробы заказа"));
        for (const sample of value.samples) detailHost.append(button(lakeName(sample.lakeCode) + " · " + STATES[sample.state], "lab-order-sample-" + sample.id, () => openDetail("samples", sample.id)));
      } else {
        for (const [label, data] of [["Источник", value.source], ["Место", value.location], ["Время отбора", dateLabel(value.collectedAt)], ["Условия", value.conditions], ["Панель", LABELS[value.panel] || value.panel], ["Регистрационный номер", value.registrationNumber || "Еще не присвоен"], ["Последний комментарий", value.lastReason || "Нет"], ["Ответ владельца", value.clarification || "Нет"]]) meta(detailHost, label, data);
        detailHost.append(button("Открыть заказ", "lab-sample-order", () => openDetail("orders", value.orderId)));
        if (value.state === "NeedsInfo") { const reason = field(detailHost, "Ответ на уточнение", "lab-action-reason", "text", 500); detailHost.append(button("Отправить ответ", "lab-sample-answer", () => ordinaryAction("answer", value, reason), "lab-primary")); }
        const historyHost = el("div", "lab-history", undefined, "lab-history"); detailHost.append(el("h4", "", "История пробы"), button("Загрузить историю", "lab-history-load", () => loadHistory(false, historyHost)), historyHost);
        if (value.approvedVersion > 0) buildProtocol(value); else detailHost.append(el("p", "lab-muted", "Утвержденный протокол пока не выпущен."));
        if (value.lakeCode === "potaennoe") { const privateHost = el("div", "", undefined, "lab-private-host"); detailHost.append(button("Личное заключение", "lab-private-open", () => openPrivate(value.id, privateHost)), privateHost); }
      }
      const title = detailHost.querySelector("h3"); title.tabIndex = -1; title.focus(); updateBusy();
    }
    function formError(input, message) {
      for (const previous of shell.querySelectorAll('[aria-invalid="true"]')) { previous.setAttribute("aria-invalid", "false"); previous.removeAttribute("aria-describedby"); }
      for (const previous of shell.querySelectorAll(".lab-error-summary")) previous.remove();
      input.setAttribute("aria-invalid", "true"); const summary = el("div", "lab-error-summary", undefined, input.id + "-error"); summary.setAttribute("role", "alert"); summary.tabIndex = -1;
      summary.append(el("p", "", message), button("Перейти к полю", input.id + "-error-focus", () => input.focus()));
      input.setAttribute("aria-describedby", summary.id); input.parentNode.append(summary); summary.focus();
    }
    function renderCommand() {
      commandHost.replaceChildren(); if (!command) return;
      const message = command.phase === "confirmed" ? "Сохранение подтверждено; актуальная карточка еще не загружена." : "Результат сохранения неизвестен. Обновите данные или повторите ту же операцию кнопкой ниже.";
      commandHost.append(el("p", "lab-warning", message));
      commandHost.append(button(command.phase === "confirmed" ? "Перечитать подтвержденную запись" : "Повторить исходную команду", "lab-command-retry", () => executeCommand(command)));
    }
    function uncertain(error) { return !error?.status || error.status >= 500 || error.code === "некорректно_ответ"; }
    async function ordinaryAction(action, value, input) {
      if (command || privateReceipt?.phase === "unknown") { note("Сначала разберите результат предыдущей записи.", true); return; }
      let reason; try { reason = textInput(input.value, 500); input.setAttribute("aria-invalid", "false"); } catch (error) { formError(input, error.message); return; }
      const path = action === "submit" ? "lab/my/orders/" + id(value.id) + "/actions/submit" : action === "cancel" ? "lab/my/orders/" + id(value.id) + "/actions/cancel" : "lab/my/samples/" + id(value.id) + "/actions/answer";
      await executeCommand({ key: crypto.randomUUID(), path, body: { expectedRevision: value.revision, reason }, kind: action === "answer" ? "samples" : "orders", targetId: value.id, action, before: value, accountId: context.accountId, phase: "new" });
    }
    async function executeCommand(intent) {
      if (intent.accountId !== context.accountId) return;
      await run(async (ticket, signal) => {
        const wasUnknown = intent.phase === "unknown"; command = intent; let confirmed = intent.phase === "confirmed";
        try {
          if (!confirmed) {
            intent.phase = "sending";
            const raw = await request(intent.path, { method: "POST", body: intent.body, headers: { "Idempotency-Key": intent.key }, signal });
            const receipt = commandReceipt(raw, intent);
            if (!fresh(ticket)) return;
            intent.targetId = receipt.id; intent.phase = "confirmed"; intent.receipt = { id: receipt.id, revision: receipt.revision, state: receipt.state }; confirmed = true;
            state.form = null; formHost.replaceChildren(); renderCommand();
          }
          const value = await fetchCard(intent.kind, intent.targetId, signal); if (value.revision < intent.receipt.revision) throw invalid(); if (!fresh(ticket)) return;
          command = null; clearSelection(); state.selectedKind = intent.kind; state.selected = value; renderDetail(); renderCommand();
          note("Сохранено. Чтобы обновить список, нажмите «Обновить».");
        } catch (error) {
          if (!fresh(ticket)) return;
          if (confirmed) { intent.phase = "confirmed"; note("Сохранение подтверждено; актуальная карточка не загружена. " + errorText(error), true); }
          else if (uncertain(error) || wasUnknown) { intent.phase = "unknown"; note("Результат сохранения неизвестен. Повторите ту же операцию без изменений. " + errorText(error), true); }
          else { command = null; note(errorText(error), true); }
          if (onSessionError(error)) return;
          denied(error); renderCommand();
        }
      });
    }
    async function openCreate() {
      await run(async (ticket, signal) => { await ensureReference(ticket, signal); if (!fresh(ticket) || !canCreate()) return; closePrivate(); buildOrderForm(); note("После создания реквизиты проб не редактируются. Проверьте время UTC и место отбора."); });
    }
    function buildOrderForm() {
      formHost.replaceChildren(); const form = el("form", "lab-form", undefined, "lab-order-form"); form.noValidate = true;
      form.append(el("h3", "", "Новый заказ")); const fields = el("div", "lab-fields"); form.append(fields);
      const area = field(fields, "Участок", "lab-order-area", "select"), contact = field(fields, "Телефон или email", "lab-order-contact", "text", 128), collection = field(fields, "Способ отбора", "lab-order-collection", "select");
      contact.parentNode.append(el("p", "lab-muted", "Используйте латинские буквы, цифры и обычные знаки. Кириллица пока не поддерживается."));
      options(area, context.areas.filter(item => item.state === "Active" && context.canCreateAreaIds.includes(item.id)), item => item.name); options(collection, state.reference.collectionMethods, item => LABELS[item] || item);
      const samplesHost = el("div", "lab-samples"), cost = el("p", "lab-meta", "", "lab-order-cost"), rows = [];
      const add = button("Добавить пробу", "lab-sample-add", () => { captureRows(); rows.push(emptySample()); drawRows(); });
      const save = button("Создать черновик заказа", "lab-order-create", submit, "lab-primary");
      const actions = el("div", "lab-actions"); actions.append(add, save, button("Закрыть форму", "lab-order-close", () => { formHost.replaceChildren(); state.form = null; note(command ? "Форма закрыта. Результат прежней записи нужно проверить отдельно." : "Форма закрыта. Загрузите свои пробы или создайте заказ."); updateBusy(); (createOpen.disabled ? refresh : createOpen).focus(); })); form.append(samplesHost, cost, actions);
      form.addEventListener("submit", async event => { event.preventDefault(); if (!save.disabled) await submit(); }); formHost.append(form); state.form = form; rows.push(emptySample()); drawRows(); const title = form.querySelector("h3"); title.tabIndex = -1; title.focus();
      function emptySample() { return { lake: state.reference.lakes[0].code, water: state.reference.waterTypes[0], place: state.reference.places[0], source: "", location: "", collected: "", conditions: "", panel: state.reference.panels[0].code, inputs: null }; }
      function captureRows() { for (const row of rows) if (row.inputs) for (const key of Object.keys(row.inputs)) row[key] = row.inputs[key].value; }
      function drawRows() {
        samplesHost.replaceChildren(); rows.forEach((row, index) => {
          const box = el("fieldset", "lab-sample-editor"), legend = el("legend", "", "Проба " + (index + 1)), gridFields = el("div", "lab-fields"); box.append(legend, gridFields); row.inputs = {};
          for (const [key, label, type, max] of [["lake", "Озеро", "select"], ["water", "Тип воды", "select"], ["place", "Точка отбора", "select"], ["source", "Источник", "text", 250], ["location", "Место отбора", "text", 250], ["collected", "Дата и время отбора (UTC, ГГГГ-ММ-ДДTчч:мм:ссZ)", "text", 20], ["conditions", "Условия отбора", "textarea", 500], ["panel", "Панель исследования", "select"]]) {
            const input = field(gridFields, label, "lab-sample-" + (index + 1) + "-" + key, type, max); row.inputs[key] = input;
            if (key === "lake") options(input, state.reference.lakes, item => item.name);
            if (key === "water") options(input, state.reference.waterTypes, item => LABELS[item] || item);
            if (key === "place") options(input, state.reference.places, item => LABELS[item] || item);
            if (key === "panel") { options(input, state.reference.panels, item => (LABELS[item.code] || item.code) + " · " + item.estimatedCost + " руб."); input.addEventListener("change", updateCost); }
            input.value = row[key];
            if (key === "collected") {
              input.placeholder = "2026-10-21T12:00:00Z";
              const preview = el("p", "lab-muted", "Ввод в UTC. Зона браузера: " + Intl.DateTimeFormat().resolvedOptions().timeZone + "."); input.parentNode.append(preview);
              input.addEventListener("input", () => { try { preview.textContent = "UTC: " + dateLabel(input.value) + ". В зоне браузера: " + new Date(utcTimestamp(input.value)).toLocaleString("ru-RU") + "."; } catch (_) { preview.textContent = "Укажите дату и время в формате 2026-10-28T12:00:00Z (UTC)."; } });
            }
          }
          if (rows.length > 1) box.append(button("Убрать пробу " + (index + 1), "lab-sample-" + (index + 1) + "-remove", () => { captureRows(); rows.splice(index, 1); drawRows(); })); samplesHost.append(box);
        }); flag(add, rows.length >= 5); updateCost(); updateBusy();
      }
      function updateCost() { cost.textContent = "Предварительная стоимость: " + rows.reduce((sum, row) => sum + (state.reference.panels.find(panel => panel.code === row.inputs.panel.value)?.estimatedCost || 0), 0) + " руб. Итоговая стоимость — после подтверждения."; }
      function checked(input, fn) { try { const value = fn(input.value); input.setAttribute("aria-invalid", "false"); return value; } catch (error) { formError(input, error.message); throw error; } }
      async function submit() {
        if (command || privateReceipt?.phase === "unknown") { note("Сначала разберите результат предыдущей записи.", true); return; }
        let body;
        try {
          const contactValue = checked(contact, value => { textInput(value, 128); if (/[^\x20-\x7e]/.test(value)) throw new Error("Используйте латинские буквы, цифры и обычные знаки. Кириллица пока не поддерживается."); return value; });
          if (!context.canCreateAreaIds.includes(area.value)) throw new Error("Выбранная область недоступна для создания.");
          const member = (input, values) => checked(input, value => { if (!values.includes(value)) throw new Error("Выберите значение из справочника."); return value; });
          body = { workspaceId: id(context.workspaceId), areaId: id(area.value), contact: contactValue, collectionMethod: member(collection, state.reference.collectionMethods), samples: rows.map(row => ({ lakeCode: member(row.inputs.lake, state.reference.lakes.map(item => item.code)), waterType: member(row.inputs.water, state.reference.waterTypes), placeCode: member(row.inputs.place, state.reference.places), source: checked(row.inputs.source, value => textInput(value, 250)), location: checked(row.inputs.location, value => textInput(value, 250)), collectedAt: checked(row.inputs.collected, value => collectedAt(value)), conditions: checked(row.inputs.conditions, value => textInput(value, 500, true)), panel: member(row.inputs.panel, state.reference.panels.map(item => item.code)) })) };
        } catch (_) { note("Проверьте отмеченные поля формы.", true); return; }
        await executeCommand({ key: crypto.randomUUID(), path: "lab/my/orders", body, kind: "orders", targetId: "", accountId: context.accountId, phase: "new" });
      }
    }
    async function loadHistory(more, host) {
      await run(async (ticket, signal) => { const value = state.selected, selected = selection; if (!value || state.selectedKind !== "samples") return;
        const after = more ? state.historyCursor : 0;
        try {
          const raw = object(await get("lab/my/samples/" + id(value.id) + "/history?afterRevision=" + integer(after, 0, 200), signal));
          const items = array(raw.items, 100).map(item => { object(item); const before = object(item.before), out = { revision: integer(item.revision, 1, 200), operation: str(item.operation, 100), reason: str(item.reason, 500), changedAt: str(item.changedAt), before: Object.keys(before).length ? sampleDTO(before) : null, after: sampleDTO(item.after) }; utcTimestamp(out.changedAt); if (out.after.id !== value.id) throw invalid(); return out; });
          const next = integer(raw.nextRevision, 0, 200); if (typeof raw.hasMore !== "boolean" || (raw.hasMore && next <= after)) throw invalid();
          if (!fresh(ticket) || selected !== selection) return;
          state.history = more ? [...state.history, ...items] : items; state.historyCursor = next; state.historyMore = raw.hasMore; host.replaceChildren();
          if (!state.history.length) host.append(el("p", "lab-empty", "История пока пуста."));
          for (const item of state.history) { const entry = el("div", "lab-card"); entry.append(el("p", "", "Изменение " + item.revision + " · " + dateLabel(item.changedAt)), el("p", "lab-meta", (OPERATIONS[item.operation] || "Изменение пробы") + " · " + (item.before ? STATES[item.before.state] + " → " : "") + STATES[item.after.state]), el("p", "", item.reason)); host.append(entry); }
          if (state.historyMore) host.append(button("Следующая страница истории", "lab-history-more", () => loadHistory(true, host))); note("История загружена.");
        } catch (error) { if (fresh(ticket)) denied(error); throw error; }
      });
    }
    function knownVersionForm(parent, prefix, onLoad, privateVersion = false) {
      const history = el("details", "lab-meta", undefined, prefix + "-history-choice"), toggle = el("summary", "", privateVersion ? "Открыть версию по известному номеру" : "Открыть редакцию по известному номеру", prefix + "-history-toggle");
      const form = el("form", "", undefined, prefix + "-history-form"); form.noValidate = true;
      const input = field(form, privateVersion ? "Номер версии" : "Номер редакции", prefix + "-version"); input.inputMode = "numeric"; input.autocomplete = "off";
      const hint = el("p", "lab-muted", "Введите номер редакции от 1 до 20.", prefix + "-version-hint"), errors = el("div", "", undefined, prefix + "-version-errors");
      input.setAttribute("aria-describedby", hint.id);
      const actions = el("div", "lab-actions"), submit = el("button", "lab-button", privateVersion ? "Загрузить указанную версию" : "Загрузить указанную редакцию", prefix + "-history-load"); submit.type = "submit";
      actions.append(submit); form.append(hint, errors, actions); history.append(toggle, form); parent.append(history);
      function clearError() { errors.replaceChildren(); input.removeAttribute("aria-invalid"); input.setAttribute("aria-describedby", hint.id); }
      input.addEventListener("input", clearError);
      history.addEventListener("toggle", () => { if (root.contains(history)) { if (history.open && !input.disabled) input.focus(); else if (!history.open && history.contains(doc.activeElement)) toggle.focus(); } });
      form.addEventListener("submit", event => {
        event.preventDefault(); if (running || externalBusy || !context.accountId) return;
        if (!/^(?:[1-9]|1[0-9]|20)$/.test(input.value)) {
          const error = el("p", "lab-error", "Введите целый номер от 1 до 20.", prefix + "-version-error"); error.setAttribute("role", "alert"); errors.replaceChildren(error);
          input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", hint.id + " " + error.id); input.focus(); return;
        }
        clearError(); Promise.resolve(onLoad(Number(input.value))).catch(report);
      });
      return { input, reset() { input.value = ""; clearError(); history.open = false; } };
    }
    function buildProtocol(sample) {
      const box = el("div", "lab-protocol"), dataHost = el("div", "", undefined, "lab-protocol-data"); box.append(el("h4", "", "Утвержденный протокол"));
      if (!["Approved", "Archived"].includes(sample.state)) box.append(el("p", "lab-warning", "Идет исправление. Доступна предыдущая утвержденная редакция; она не является новым результатом."));
      const actions = el("div", "lab-actions"), exports = ["csv", "pdf"].map(format => button("Скачать " + format.toUpperCase(), "lab-protocol-" + format, () => {
        if (state.protocol?.sampleId === sample.id) return download(sample.id, state.protocol.version, format);
      }));
      function updateExports() { for (const control of exports) { flag(control, !state.protocol); control.textContent = "Скачать " + control.id.slice(-3).toUpperCase() + (state.protocol ? " · редакция " + state.protocol.version : " · сначала загрузите протокол"); } }
      async function load(version) {
        await run(async (ticket, signal) => { const selected = selection; dataHost.replaceChildren(); state.protocol = null; updateExports();
          try { const data = protocolDTO(await get("lab/my/samples/" + id(sample.id) + "/protocol?version=" + integer(version, 0, 20), signal), sample.id); if (version && data.version !== version) throw invalid(); if (!fresh(ticket) || selected !== selection) return; state.protocol = data; renderProtocol(data, dataHost); updateExports(); note("Загружена утвержденная редакция " + data.version + "."); }
          catch (error) { if (fresh(ticket)) { closePrivate(); denied(error); } if (error?.status === 404) error.labProtocolVersion = version; throw error; }
        });
      }
      const current = button("Загрузить текущую утвержденную редакцию", "lab-protocol-load", () => { history.reset(); return load(0); });
      actions.append(current, ...exports); box.append(actions, dataHost);
      const history = knownVersionForm(box, "lab-protocol", load); detailHost.append(box); updateExports();
    }
    function renderProtocol(data, host) {
      const title = el("h5", "", "Редакция " + data.version); title.tabIndex = -1;
      host.replaceChildren(title, el("p", "lab-meta", "Утверждённая редакция протокола")); meta(host, "Редакция", data.version); meta(host, "Утверждено", dateLabel(data.approvedAt)); meta(host, "Источник", data.source); meta(host, "Версия справочника", data.dictionaryVersion);
      const wrap = el("div", "lab-table-wrap"), table = el("table", "lab-table"), head = el("thead"), header = el("tr");
      wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "Результаты исследования, таблица с горизонтальной прокруткой");
      const hint = el("p", "lab-muted", "На узком экране прокручивайте таблицу по горизонтали. С клавиатуры: перейдите к таблице клавишей Tab, затем используйте стрелки.", "lab-protocol-scroll-hint");
      wrap.setAttribute("aria-describedby", hint.id); host.append(hint);
      for (const label of ["Показатель", "Значение", "Единица", "Методика"]) { const th = el("th", "", label); th.scope = "col"; header.append(th); } head.append(header); table.append(head); const body = el("tbody");
      for (const value of data.values) { const row = el("tr"); for (const text of [LABELS[value.indicatorCode] || value.indicatorCode, LABELS[value.value] || value.value, unitLabel(value), value.method]) row.append(el("td", "", text)); body.append(row); } table.append(body); wrap.append(table); host.append(wrap); title.focus();
    }
    async function download(sampleId, version, format) {
      await run(async (ticket, signal) => { const selected = selection;
        try {
          const blob = await requestBinary("lab/my/samples/" + id(sampleId) + "/protocol." + format + "?version=" + integer(version, 0, 20), format, signal);
          if (!fresh(ticket) || selected !== selection) return;
          if (!(blob instanceof Blob) || !blob.size || blob.size > 4 * 1024 * 1024) throw invalid();
          const url = URL.createObjectURL(blob); objectURLs.add(url); const anchor = el("a"); anchor.href = url; anchor.download = "lab-" + sampleId + "-" + (version === 0 ? "latest" : "v" + version) + "." + format; shell.append(anchor);
          try { anchor.click(); note("Файл передан браузеру. Проверьте его в загрузках; сохранение на диск зависит от браузера."); }
          finally { anchor.remove(); setTimeout(() => { if (objectURLs.delete(url)) URL.revokeObjectURL(url); }, 1000); }
        } catch (error) { if (fresh(ticket)) { closePrivate(); denied(error); } throw error; }
      });
    }
    async function digest(body) { const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))); return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join(""); }
    function privateMessage(panel, message, error = false) { panel.message.textContent = message; panel.message.className = error ? "lab-error" : "lab-status"; }
    async function ownerCheck(sampleId, signal) { const sample = await fetchCard("samples", sampleId, signal); if (sample.lakeCode !== "potaennoe") throw invalid(); return sample; }
    async function openPrivate(sampleId, host) {
      await run(async (ticket, signal) => {
        closePrivate(); const selected = selection;
        try {
          await ownerCheck(sampleId, signal); if (!fresh(ticket) || selected !== selection) return;
          const panel = buildPrivate(sampleId, host); await readPrivate(panel, 0, ticket, signal);
        } catch (error) { if (fresh(ticket)) { closePrivate(); denied(error); } throw error; }
      });
    }
    function buildPrivate(sampleId, host) {
      const box = el("section", "lab-private-panel"), message = el("p", "lab-status"); message.setAttribute("role", "status");
      box.append(el("h4", "", "Личное заключение · Потаённое"), el("p", "lab-warning", "Заключение видно только вам и не входит в протокол. Сохраните текст перед закрытием или сменой раздела."), message);
      const text = field(box, "Текст личного заключения (до 8192 символов)", "lab-private-text", "textarea", 8192); text.rows = 10; text.autocomplete = "off";
      const first = field(box, "Создать первую версию, если заключения ещё нет", "lab-private-first", "checkbox");
      const panel = { host, box, sampleId, message, text, first, head: null, readOnly: true, pending: null, firstAllowed: false };
      const load = button("Загрузить последнюю версию", "lab-private-load", () => { history.reset(); return run((ticket, signal) => readPrivate(panel, 0, ticket, signal)); });
      const save = button("Сохранить новую версию", "lab-private-save", () => savePrivate(panel), "lab-primary");
      const retry = button("Повторить исходное сохранение", "lab-private-retry", () => savePrivate(panel, true)); panel.save = save; panel.retry = retry;
      const actions = el("div", "lab-actions"); actions.append(load, save, retry, button("Закрыть и очистить текст", "lab-private-close", () => { closePrivate(); note(privateReceipt?.phase === "unknown" ? "Текст очищен. Результат сохранения неизвестен; откройте заключение этой пробы для точного повтора." : "Заключение закрыто. Несохранённый текст удалён."); updateBusy(); detailHost.querySelector("#lab-private-open")?.focus(); })); box.append(actions);
      const history = knownVersionForm(box, "lab-private", version => run((ticket, signal) => readPrivate(panel, version, ticket, signal)), true); host.replaceChildren(box); privatePanel = panel;
      first.addEventListener("change", () => { if (privatePanel === panel && panel.firstAllowed && !panel.pending) { panel.readOnly = !first.checked; updatePrivateControls(panel); } });
      const title = box.querySelector("h4"); title.tabIndex = -1; title.focus(); updatePrivateControls(panel); return panel;
    }
    function updatePrivateControls(panel) {
      if (privatePanel !== panel) return;
      const pending = privateReceipt?.accountId === context.accountId && privateReceipt.sampleId === panel.sampleId && privateReceipt.phase === "unknown";
      panel.retry.hidden = !pending;
      panel.first.parentNode.hidden = !panel.firstAllowed || pending;
      flag(panel.retry, !pending); flag(panel.save, pending || Boolean(command) || (privateReceipt?.phase === "unknown" && !pending) || (!panel.head && !panel.first.checked) || panel.readOnly || (panel.head?.version >= 20));
      flag(panel.first, !panel.firstAllowed || pending); panel.text.readOnly = panel.readOnly || Boolean(panel.pending);
      updateBusy();
    }
    async function readPrivate(panel, version, ticket, signal) {
      if (privatePanel !== panel) return;
      panel.text.value = ""; panel.pending = null; panel.readOnly = true; panel.first.checked = false; panel.firstAllowed = false;
      if (version === 0) panel.head = null;
      try {
        const data = privateDTO(await get("lab/my/samples/" + id(panel.sampleId) + "/private-conclusion?version=" + version, signal), panel.sampleId, true);
        if (!fresh(ticket) || privatePanel !== panel) return;
        if (version > 0 && data.version !== version) throw invalid();
        if (version === 0 && privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "confirmed" && (data.version < privateReceipt.version || (data.version === privateReceipt.version && data.versionId !== privateReceipt.versionId))) throw invalid();
        panel.text.value = data.text; if (version === 0) panel.head = { version: data.version, versionId: data.versionId };
        panel.readOnly = version !== 0;
        privateMessage(panel, "Версия " + data.version + " от " + dateLabel(data.createdAt) + (version === 0 ? ". Редактирование создаст новую версию." : ". Историческая версия доступна только для чтения."));
        if (privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "confirmed") privateReceipt = null;
        if (privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "unknown") { panel.text.value = ""; panel.readOnly = false; privateMessage(panel, "Результат сохранения неизвестен. Для повтора введите тот же текст.", true); }
      } catch (error) {
        if (!fresh(ticket) || privatePanel !== panel) return;
        panel.text.value = "";
        if (onSessionError(error)) return;
        if (error?.status === 404) {
          try { await ownerCheck(panel.sampleId, signal); }
          catch (ownerError) { if (fresh(ticket)) { closePrivate(); denied(ownerError); } throw ownerError; }
          if (!fresh(ticket) || privatePanel !== panel) return;
          const confirmed = privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "confirmed";
          panel.head = null; panel.firstAllowed = !confirmed; panel.readOnly = true;
          privateMessage(panel, confirmed ? "Сохранение версии " + privateReceipt.version + " подтверждено, но актуальная версия недоступна. Перечитайте ее позже; новый ввод пока заблокирован." : "Не удалось загрузить заключение. Если создаёте его впервые, отметьте «Создать первую версию».", true);
          if (privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "unknown") { panel.readOnly = false; privateMessage(panel, "Версия недоступна. Результат сохранения неизвестен. Для повтора введите тот же текст.", true); }
        } else if (error?.status === 403) { closePrivate(); throw error; }
        else { privateMessage(panel, (privateReceipt?.sampleId === panel.sampleId && privateReceipt.phase === "confirmed" ? "Сохранение версии " + privateReceipt.version + " подтверждено; актуальная версия не загружена. " : "") + errorText(error), true); }
      }
      if (fresh(ticket) && privatePanel === panel) updatePrivateControls(panel);
    }
    async function savePrivate(panel, retry = false) {
      if (privatePanel !== panel || command) return;
      await run(async (ticket, signal) => {
        const previous = privateReceipt?.sampleId === panel.sampleId && privateReceipt.accountId === context.accountId ? privateReceipt : null;
        if (privateReceipt?.phase === "unknown" && !previous) { privateMessage(panel, "Сначала разберите неизвестный результат записи другой пробы.", true); return; }
        let body, intent;
        try {
          if (retry) {
            if (!previous || previous.phase !== "unknown") return;
            body = panel.pending?.body || { expectedVersion: previous.expectedVersion, text: textInput(panel.text.value, 8192, true) };
            if (await digest(body) !== previous.digest) { privateMessage(panel, "Для повтора нужен исходный текст без изменений. Будет повторена прежняя операция.", true); return; }
            intent = previous;
          } else {
            if (previous?.phase === "unknown") return;
            if (panel.readOnly || (!panel.head && (!panel.firstAllowed || !panel.first.checked))) return;
            body = { expectedVersion: panel.head ? panel.head.version : 0, text: textInput(panel.text.value, 8192, true) };
            if (body.expectedVersion === 0) await ownerCheck(panel.sampleId, signal);
            if (!fresh(ticket) || privatePanel !== panel) return;
            intent = { accountId: context.accountId, sampleId: panel.sampleId, key: crypto.randomUUID(), expectedVersion: body.expectedVersion, digest: await digest(body), phase: "new" };
          }
          if (!fresh(ticket) || privatePanel !== panel) return;
        } catch (error) { if (fresh(ticket) && privatePanel === panel) { if (error?.status) { if (!onSessionError(error)) { closePrivate(); denied(error); note(errorText(error), true); } } else privateMessage(panel, "Введите текст до 8192 символов без служебных символов.", true); } return; }
        const wasUnknown = intent.phase === "unknown"; privateReceipt = intent; panel.pending = { body }; intent.phase = "sending"; updatePrivateControls(panel);
        let confirmed = false;
        try {
          const raw = await request("lab/my/samples/" + id(panel.sampleId) + "/private-conclusion", { method: "POST", body, headers: { "Idempotency-Key": intent.key }, signal });
          const receipt = privateDTO(raw, panel.sampleId, false);
          if (receipt.version !== intent.expectedVersion + 1) throw invalid();
          if (!fresh(ticket) || privatePanel !== panel) return;
          intent.phase = "confirmed"; intent.versionId = receipt.versionId; intent.version = receipt.version; confirmed = true; panel.pending = null;
          privateMessage(panel, "Сохранение версии " + receipt.version + " подтверждено. Загружается актуальная версия.");
          await readPrivate(panel, 0, ticket, signal);
        } catch (error) {
          if (!fresh(ticket) || privatePanel !== panel) return;
          if (confirmed) { intent.phase = "confirmed"; panel.pending = null; privateMessage(panel, "Сохранение подтверждено, но актуальная версия не загружена. " + errorText(error), true); }
          else if (uncertain(error) || wasUnknown) { intent.phase = "unknown"; privateMessage(panel, "Результат сохранения неизвестен. Можно только повторить прежнюю операцию с тем же текстом. " + errorText(error), true); }
          else { privateReceipt = null; panel.pending = null; privateMessage(panel, errorText(error), true); }
          if (onSessionError(error)) return;
          if (error?.status === 403 || error?.status === 404) { closePrivate(); note("Заключение недоступно. Несохранённый текст удалён. " + errorText(error), true); }
          else if (error?.status === 409 && !wasUnknown) { panel.head = null; panel.readOnly = true; panel.firstAllowed = false; panel.text.value = ""; }
        }
        if (fresh(ticket) && privatePanel === panel) updatePrivateControls(panel);
      });
    }
    function syncContext(next) {
      const accountId = UUID.test(next?.accountId || "") ? next.accountId : "";
      const workspaceId = UUID.test(next?.workspaceId || "") ? next.workspaceId : "";
      const areas = Array.isArray(next?.areas) ? next.areas.filter(area => UUID.test(area?.id || "") && typeof area.name === "string").map(area => ({ id: area.id, name: area.name, state: area.state })) : [];
      const canCreateAreaIds = Array.isArray(next?.canCreateAreaIds) ? next.canCreateAreaIds.filter(value => UUID.test(value)) : [];
      const key = JSON.stringify([accountId, workspaceId, areas, canCreateAreaIds]);
      const accountChanged = accountId !== context.accountId;
      if (key !== contextKey) {
        if (accountChanged) reset();
        else {
          generation += 1; invalidateTask(); abortAll(); closePrivate(); state.form = null; formHost.replaceChildren();
          if (command?.phase === "sending") command.phase = "unknown";
          if (privateReceipt?.phase === "sending") privateReceipt.phase = "unknown";
        }
        context = { accountId, workspaceId, areas, canCreateAreaIds }; contextKey = key;
        if (accountChanged && accountId) note("Загрузите свои пробы или создайте заказ.");
      }
      renderCommand(); renderList();
      if (!context.accountId) note("Войдите, чтобы открыть свои заказы и пробы."); updateBusy();
    }
    function reset() {
      generation += 1; selection += 1; invalidateTask(); abortAll(); closePrivate(); privateReceipt = null; command = null; state = initialState();
      context = { accountId: "", workspaceId: "", areas: [], canCreateAreaIds: [] }; contextKey = "";
      for (const url of objectURLs) URL.revokeObjectURL(url); objectURLs.clear();
      formHost.replaceChildren(); detailHost.replaceChildren(); commandHost.replaceChildren(); renderList(); note("Войдите, чтобы открыть свои заказы и пробы.");
    }
    function setExternalBusy(value) { busyEpoch += 1; externalBusy = Boolean(value); updateBusy(); }
    renderList(); updateBusy();
    return Object.freeze({ syncContext, setExternalBusy, reset });
  }
  globalThis.VodokanalLab = Object.freeze({ create, helpers: Object.freeze({ utcTimestamp, collectedAt, validateReference }) });
})();
