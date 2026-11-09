
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STATES = Object.freeze({ Draft: "Черновик", Submitted: "Подано", Registered: "Зарегистрировано", InAnalysis: "В работе", Review: "На утверждении", Approved: "Утверждено", Archived: "В архиве", NeedsInfo: "Нужно уточнение", Rejected: "Отклонено" });
  const LABELS = Object.freeze({ basic: "Базовая панель", extended: "Расширенная панель", ph: "pH", turbidity: "Мутность", appearance: "Внешний вид", temperature: "Температура", clear: "Прозрачная", turbid: "Мутная", customer: "Самостоятельный отбор", courier: "Отбор курьером" });
  const ACTIONS = Object.freeze({ register: "Зарегистрировать", "ask-info": "Запросить уточнение", reject: "Отклонить пробу", assign: "Назначить лаборанта", "start-analysis": "Начать исследование", results: "Передать результаты на проверку", approve: "Утвердить протокол", rework: "Вернуть на доработку", archive: "Архивировать", correct: "Начать исправление" });
  const EVENTS = Object.freeze({ "order.submit": "Заказ подан", "order.cancel": "Заказ отменен", "sample.create": "Проба создана", "sample.register": "Проба зарегистрирована", "sample.ask-info": "Запрошено уточнение", "sample.answer": "Получен ответ владельца", "sample.reject": "Проба отклонена", "sample.assign": "Назначен лаборант", "sample.start-analysis": "Исследование начато", "sample.results": "Результаты переданы на проверку", "sample.approve": "Протокол утвержден", "sample.rework": "Результаты возвращены на доработку", "sample.archive": "Проба отправлена в архив", "sample.correct": "Исправление начато" });
  const PATHS = Object.freeze({ register: "lab/technician/samples/{id}/actions/register", "ask-info": "lab/technician/samples/{id}/actions/ask-info", reject: "lab/technician/samples/{id}/actions/reject", assign: "lab/technician/samples/{id}/actions/assign", "start-analysis": "lab/technician/samples/{id}/actions/start-analysis", results: "lab/technician/samples/{id}/results", approve: "lab/approver/samples/{id}/actions/approve", rework: "lab/approver/samples/{id}/actions/rework", archive: "lab/technician/samples/{id}/actions/archive", correct: "lab/technician/samples/{id}/actions/correct" });
  const DESTINATIONS = Object.freeze({ register: "Registered", "ask-info": "NeedsInfo", reject: "Rejected", assign: "Registered", "start-analysis": "InAnalysis", results: "Review", approve: "Approved", rework: "InAnalysis", archive: "Archived", correct: "InAnalysis" });
  const BASES = Object.freeze({ technician: "lab/technician", approver: "lab/approver" });
  const SAMPLE_KEYS = "id,orderId,workspaceId,areaId,lakeCode,waterType,placeCode,source,location,collectedAt,conditions,panel,registrationNumber,clarification,lastReason,state,revision,createdAt,updatedAt,approvedVersion".split(",");
  function invalid() { const error = new Error("Некорректный ответ рабочего места лаборатории"); error.status = 200; error.code = "некорректно_ответ"; return error; }
  function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value; }
  function str(value, max = 8192) { if (typeof value !== "string" || value.length > max) throw invalid(); return value; }
  function id(value) { if (!UUID.test(str(value, 36))) throw invalid(); return value; }
  function optionalId(value) { return value === "" ? "" : id(value); }
  function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw invalid(); return value; }
  function array(value, max) { if (!Array.isArray(value) || value.length > max) throw invalid(); return value; }
  function pick(value, keys) { object(value); const out = {}; for (const key of keys) out[key] = value[key]; return out; }
  function utcTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value)) throw invalid();
    const wire = value.endsWith("Z") ? value : value + "Z", time = Date.parse(wire);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) + "Z" !== wire) throw invalid(); return time;
  }
  function dateLabel(value) { return new Date(utcTimestamp(value)).toISOString().slice(0, 19).replace("T", " ") + " UTC"; }
  function unitLabel(value) { return value.kind === "qualitative" && value.unit === "code" ? "Качественное значение" : value.unit; }
  function scaled(value) {
    if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(value)) throw new Error("Введите десятичное число с точкой, без пробелов, ведущих нулей и экспоненты; до 6 знаков после точки.");
    const negative = value.startsWith("-"), parts = (negative ? value.slice(1) : value).split(".");
    const result = BigInt(parts[0]) * 1000000n + BigInt((parts[1] || "").padEnd(6, "0"));
    if (negative && result === 0n) throw new Error("Отрицательный ноль не допускается."); return negative ? -result : result;
  }
  function decimal(value, min, max) { const result = scaled(value); if ((min !== undefined && result < scaled(min)) || (max !== undefined && result > scaled(max))) throw new Error("Значение должно быть от " + min + " до " + max + "."); return value; }
  function textInput(value, max, multiline = false) { if (typeof value !== "string" || !value.trim() || value.length > max || (multiline ? /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) throw new Error("Введите непустой текст до " + max + " символов без управляющих знаков."); return value; }
  function sampleDTO(value, kind = "common") {
    const out = pick(value, SAMPLE_KEYS);
    for (const key of ["id", "orderId", "workspaceId", "areaId"]) id(out[key]);
    for (const key of SAMPLE_KEYS.filter(key => !["revision", "approvedVersion"].includes(key))) str(out[key]);
    if (!STATES[out.state]) throw invalid(); integer(out.revision, 1, 200); integer(out.approvedVersion, 0, 20);
    for (const key of ["collectedAt", "createdAt", "updatedAt"]) utcTimestamp(out[key]);
    if (kind === "queue" || kind === "detail") out.technicianAccountId = optionalId(value.technicianAccountId);
    if (kind === "detail") out.currentProtocolId = optionalId(value.currentProtocolId);
    return out;
  }
  function orderDTO(value) {
    const out = pick(value, "id,workspaceId,areaId,contact,collectionMethod,estimatedCost,state,revision,createdAt,updatedAt".split(","));
    for (const key of ["id", "workspaceId", "areaId"]) id(out[key]);
    for (const key of ["contact", "collectionMethod", "state", "createdAt", "updatedAt"]) str(out[key]);
    if (!["Draft", "Submitted", "Cancelled"].includes(out.state)) throw invalid(); integer(out.revision, 1, 200); integer(out.estimatedCost, 0, 100000); utcTimestamp(out.createdAt); utcTimestamp(out.updatedAt);
    out.samples = array(value.samples, 5).map(item => sampleDTO(item));
    if (!out.samples.length || out.samples.some(sample => sample.orderId !== out.id || sample.workspaceId !== out.workspaceId || sample.areaId !== out.areaId)) throw invalid(); return out;
  }
  function referenceDTO(value) {
    object(value); const out = { dictionaryVersion: str(value.dictionaryVersion), source: str(value.source), warning: str(value.warning) };
    out.lakes = array(value.lakes, 10).map(item => ({ code: str(object(item).code, 32), name: str(item.name, 100) }));
    out.panels = array(value.panels, 10).map(item => ({ code: str(object(item).code, 32), indicatorCodes: array(item.indicatorCodes, 8).map(code => str(code, 32)) }));
    out.indicators = array(value.indicators, 8).map(item => {
      const indicator = { code: str(object(item).code, 32), kind: str(item.kind, 32), unit: str(item.unit, 32), method: str(item.method, 64) };
      if (!/^[a-z][a-z0-9-]*$/.test(indicator.code)) throw invalid();
      if (indicator.kind === "decimal") { indicator.min = str(item.min, 32); indicator.max = str(item.max, 32); try { if (scaled(indicator.min) > scaled(indicator.max)) throw invalid(); } catch (_) { throw invalid(); } }
      else if (indicator.kind === "qualitative") { indicator.allowed = array(item.allowed, 20).map(value => str(value, 32)); if (!indicator.allowed.length || new Set(indicator.allowed).size !== indicator.allowed.length) throw invalid(); }
      else throw invalid(); return indicator;
    });
    if (!out.panels.length || !out.indicators.length || new Set(out.indicators.map(item => item.code)).size !== out.indicators.length || new Set(out.panels.map(item => item.code)).size !== out.panels.length) throw invalid();
    for (const panel of out.panels) if (!panel.indicatorCodes.length || new Set(panel.indicatorCodes).size !== panel.indicatorCodes.length || panel.indicatorCodes.some(code => !out.indicators.some(item => item.code === code))) throw invalid(); return out;
  }
  function protocolDTO(value, sample) {
    const out = pick(value, "sampleId,protocolId,version,previousApprovedProtocolId,lakeCode,lakeName,collectedAt,approvedAt,state,dictionaryVersion,source,warning,registrationNumber,location,collectionSource,conditions,correctionReason,comment,enteredBy,approvedBy".split(","));
    if (id(out.sampleId) !== sample.id || !["Review", "Reworked", "Approved"].includes(out.state)) throw invalid();
    id(out.protocolId); optionalId(out.previousApprovedProtocolId); id(out.enteredBy); optionalId(out.approvedBy); integer(out.version, 1, 20);
    for (const key of Object.keys(out).filter(key => key !== "version")) str(out[key]);
    utcTimestamp(out.collectedAt);
    if (out.lakeCode !== sample.lakeCode || utcTimestamp(out.collectedAt) !== utcTimestamp(sample.collectedAt)) throw invalid();
    if (out.state === "Approved") { utcTimestamp(out.approvedAt); id(out.approvedBy); if (out.approvedBy === out.enteredBy) throw invalid(); }
    else if (out.approvedAt !== "" || out.approvedBy !== "") throw invalid();
    out.values = array(value.values, 8).map(item => ({ indicatorCode: str(object(item).indicatorCode, 32), value: str(item.value, 32), kind: str(item.kind, 32), unit: str(item.unit, 32), method: str(item.method, 64) }));
    if (!out.values.length || new Set(out.values.map(item => item.indicatorCode)).size !== out.values.length) throw invalid(); return out;
  }
  function freeze(value) { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
  function receiptDTO(raw, intent) {
    const value = sampleDTO(raw), before = intent.before;
    if (value.id !== before.id || value.revision !== intent.body.expectedRevision + 1 || value.state !== DESTINATIONS[intent.action]) throw invalid();
    const changing = ["state", "revision", "updatedAt", "lastReason", "approvedVersion"];
    if (SAMPLE_KEYS.filter(key => !changing.includes(key)).some(key => value[key] !== before[key])) throw invalid();
    const reason = intent.action === "results" ? before.lastReason : intent.body.reason;
    if (value.lastReason !== reason || value.approvedVersion !== (intent.action === "approve" ? intent.protocolVersion : before.approvedVersion)) throw invalid();
    return { id: value.id, revision: value.revision, state: value.state, approvedVersion: value.approvedVersion };
  }
  function create({ root, request, requestBinary, setGlobalBusy = () => {}, onSessionError = () => false }) {
    if (!root || typeof request !== "function" || typeof requestBinary !== "function") throw new Error("Не подключены зависимости рабочего места лаборатории");
    const doc = root.ownerDocument;
    const el = (tag, className, text, elementId) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; if (elementId) node.id = elementId; return node; };
    let context = emptyContext(), contextKey = "", generation = 0, selection = 0, externalBusy = false, busyEpoch = 0, running = false, activeTask = null;
    let state = emptyState(), command = null, lostOutcome = false;
    const controllers = new Set(), urls = new Set();
    const shell = el("div", "lab-content"), heading = el("h2", "", "Рабочее место лаборатории", "lab-staff-heading");
    const warning = el("p", "lab-warning", "Исследования и утверждение протоколов.");
    const status = el("p", "lab-status", "Выберите рабочее место и участок.", "lab-staff-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const lostHost = el("p", "lab-warning", "", "lab-staff-unconfirmed"), commandHost = el("div", "lab-actions"), diagnosticHost = el("div", "", undefined, "lab-staff-diagnostic"), controls = el("div", "lab-fields");
    const mode = field(controls, "Рабочее место", "lab-staff-mode", "select"), area = field(controls, "Участок", "lab-staff-area", "select"), filter = field(controls, "Состояние проб", "lab-staff-state", "select");
    options(filter, [{ value: "", label: "Все состояния" }, ...Object.entries(STATES).map(([value, label]) => ({ value, label }))]);
    const load = button("Загрузить очередь", "lab-staff-load", () => loadQueue(false), true), next = button("Следующая страница", "lab-staff-next", () => loadQueue(true));
    const toolbar = el("div", "lab-toolbar"); toolbar.append(load);
    const list = el("div", "lab-list-panel", undefined, "lab-staff-list"), detail = el("div", "lab-detail-panel", undefined, "lab-staff-detail"), grid = el("div", "lab-grid");
    const listPanel = el("div", "lab-list-panel"); listPanel.append(list, next); grid.append(listPanel, detail); shell.append(heading, controls, toolbar, status, diagnosticHost, lostHost, commandHost, grid); root.replaceChildren(shell);
    mode.addEventListener("change", () => { if (blocked()) return; changeView(mode.value); });
    area.addEventListener("change", () => { if (blocked()) return; const chosen = area.value; invalidateScope(true); state.areaId = permittedAreas(state.mode).some(item => item.id === chosen) ? chosen : ""; renderControls(); note("Участок изменен. Загрузите очередь заново."); });
    filter.addEventListener("change", () => { if (blocked()) return; state.filter = filter.value in STATES || filter.value === "" ? filter.value : ""; clearSelection(); state.items = []; state.loaded = false; state.cursor = ""; state.hasMore = false; renderList(); note("Фильтр изменен. Загрузите очередь заново."); });
    function emptyContext() { return { accountId: "", actorId: "", workspaceId: "", areas: [], technicianAreaIds: [], approverAreaIds: [] }; }
    function emptyState() { return { mode: "technician", areaId: "", filter: "Submitted", reference: null, items: [], loaded: false, cursor: "", hasMore: false, selected: null, protocol: null, protocolChoice: 0, roster: [], rosterLoaded: false, rosterCursor: "", rosterMore: false, history: [], historyCursor: 0, historyMore: false, reason: null, actionsHost: null, protocolHost: null, rosterSelect: null }; }
    function button(text, elementId, fn, primary = false) { const node = el("button", "lab-button" + (primary ? " lab-primary" : ""), text, elementId); node.type = "button"; node.addEventListener("click", async event => { event.preventDefault(); if (node.disabled) return; try { await fn(); } catch (error) { report(error); } }); return node; }
    function field(parent, label, inputId, type = "text", max = 0) { const wrap = el("div", "lab-field"), caption = el("label", "", label), input = el(["select", "textarea"].includes(type) ? type : "input", "", undefined, inputId); caption.htmlFor = inputId; if (!["select", "textarea"].includes(type)) input.type = type; if (max) input.maxLength = max; wrap.append(caption, input); parent.append(wrap); return input; }
    function options(select, values) { select.replaceChildren(...values.map(item => { const option = el("option", "", item.label); option.value = item.value; return option; })); }
    function note(message, error = false, diagnostic = null) {
      status.textContent = message; status.className = error ? "lab-status lab-error" : "lab-status"; diagnosticHost.replaceChildren();
      if (diagnostic) {
        const support = el("details", "lab-meta"); support.append(el("summary", "", "Сведения для поддержки"));
        for (const [key, label] of [["code", "Код ошибки"], ["requestId", "Код запроса"]]) if (/^[a-zA-ZА-Яа-яЁё0-9_-]{1,160}$/.test(diagnostic[key] || "")) meta(support, label, diagnostic[key]);
        if (support.children.length > 1) diagnosticHost.append(support);
      }
    }
    function errorText(error) {
      return error?.code === "кабинет_лаборатория_независимый_утверждение_требуется" ? "Нужен другой участник: автор ввода не может проверять свои результаты." : error?.status === 403 ? "Доступ к этому участку или действию не подтвержден." : error?.status === 404 ? (Number.isInteger(error.labProtocolVersion) ? "Редакция недоступна. Это не подтверждает отсутствие других редакций." : "Проба, назначение или выбранная редакция недоступны.") : error?.status === 409 ? "Данные или состояние изменились. Перечитайте карточку; автоматического повтора не будет." : error?.status === 429 ? "Достигнут лимит операций. Повторите позже." : error?.status === 400 ? "Сервер отклонил параметры. Проверьте поля." : error?.code === "некорректно_ответ" ? "Получен некорректный ответ сервера." : "Не удалось получить ответ сервера.";
    }
    function report(error) { if (onSessionError(error)) return true; note(errorText(error), true, error); return false; }
    function permittedAreas(view = state.mode) { const ids = view === "technician" ? context.technicianAreaIds : context.approverAreaIds; return context.areas.filter(item => item.state === "Active" && ids.includes(item.id)); }
    function scopeReady() { return UUID.test(context.accountId) && UUID.test(context.workspaceId) && Boolean(BASES[state.mode]) && permittedAreas().some(item => item.id === state.areaId); }
    function blocked() { return running || externalBusy || !context.accountId; }
    function fresh(ticket) { return ticket === generation && scopeReady(); }
    function inScope(value) { if (value.workspaceId !== context.workspaceId || value.areaId !== state.areaId) throw invalid(); return value; }
    function flag(node, value) { node.dataset.labDisabled = String(Boolean(value)); node.disabled = Boolean(value) || blocked(); }
    function updateBusy() {
      for (const node of shell.querySelectorAll("button,input,select,textarea")) node.disabled = blocked() || node.dataset.labDisabled === "true" || (Boolean(command) && (node.id === "lab-staff-reason" || Boolean(node.closest("#lab-staff-results-form"))));
      mode.disabled = blocked() || mode.options.length === 0; area.disabled = blocked() || area.options.length === 0; filter.disabled = blocked() || !scopeReady(); load.disabled = blocked() || !scopeReady(); next.disabled = blocked() || !state.hasMore;
      for (const node of shell.querySelectorAll(".lab-primary")) node.classList.remove("lab-primary");
      const priorities = command ? ["command-retry"] : state.selected ? ["results-submit", "approve", "register", "start-analysis", "assign", "technicians-load", "protocol-load", "detail-refresh"] : ["load"];
      const primary = priorities.map(suffix => shell.querySelector("#lab-staff-" + suffix)).find(node => node && node.dataset.labDisabled !== "true" && !node.hidden);
      if (primary) primary.classList.add("lab-primary");
      shell.setAttribute("aria-busy", String(running));
    }
    function invalidateTask() { const task = activeTask; activeTask = null; running = false; if (task && task.busyEpoch === busyEpoch) setGlobalBusy(false); }
    function abortAll() { for (const controller of controllers) controller.abort(); controllers.clear(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
    async function run(fn) {
      if (blocked() || !scopeReady()) return;
      const ticket = generation, task = {}, controller = new AbortController(); activeTask = task; running = true; controllers.add(controller); setGlobalBusy(true); task.busyEpoch = busyEpoch; updateBusy();
      try { await fn(ticket, controller.signal); } catch (error) { if (fresh(ticket)) { if (!onSessionError(error)) { readFailure(error); note(errorText(error), true, error); } } }
      finally { controllers.delete(controller); if (activeTask === task) { activeTask = null; running = false; if (task.busyEpoch === busyEpoch) setGlobalBusy(false); updateBusy(); } }
    }
    function clearSelection() { selection += 1; state.selected = null; state.protocol = null; state.reason = null; state.actionsHost = null; state.protocolHost = null; state.rosterSelect = null; state.roster = []; state.rosterLoaded = false; state.rosterCursor = ""; state.rosterMore = false; state.history = []; state.historyCursor = 0; state.historyMore = false; detail.replaceChildren(); updateQueueSelection(); }
    function invalidateScope(keepView = false) {
      const view = state.mode, areaId = state.areaId, stateFilter = state.filter;
      if (command && ["sending", "unknown"].includes(command.phase)) lostOutcome = true;
      generation += 1; invalidateTask(); abortAll(); clearSelection(); command = null; state = emptyState();
      if (keepView) { state.mode = view; state.areaId = areaId; state.filter = stateFilter; }
      renderCommand(); renderList();
    }
    function readFailure(error) {
      clearSelection(); state.items = []; state.loaded = false; state.hasMore = false; state.cursor = ""; state.reference = null;
      if ([401, 403, 404].includes(error?.status)) { if (command?.phase === "unknown" || command?.phase === "sending") lostOutcome = true; command = null; }
      renderCommand(); renderList();
    }
    function renderCommand() {
      lostHost.hidden = !lostOutcome; lostHost.textContent = lostOutcome ? "Результат отправки неизвестен, черновик удалён. Проверьте историю перед повторным вводом." : "";
      commandHost.replaceChildren(); if (!command) return;
      const message = el("p", "lab-warning", command.phase === "confirmed" ? "Запись подтверждена; актуальная служебная карточка еще не загружена." : command.phase === "sending" ? "Отправляем действие. Подтверждение еще не получено." : "Результат сохранения неизвестен. Повторите ту же операцию кнопкой ниже, не меняя данные.", "lab-staff-command-message");
      message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite"); commandHost.append(message);
      if (command.phase !== "sending") {
        const retry = button(command.phase === "confirmed" ? "Перечитать подтвержденную запись" : "Повторить прежнюю операцию", "lab-staff-command-retry", () => execute(command));
        retry.setAttribute("aria-describedby", message.id); commandHost.append(retry);
      }
      updateBusy();
    }
    async function loadOrder() {
      const sample = state.selected, selected = selection; if (!sample) return;
      await run(async (ticket, signal) => {
        const value = inScope(orderDTO(await get(BASES[state.mode] + "/orders/" + sample.orderId, signal)));
        if (value.id !== sample.orderId || !value.samples.some(item => item.id === sample.id)) throw invalid();
        if (!fresh(ticket) || selection !== selected) return;
        const host = detail.querySelector("#lab-staff-order-data"); host.replaceChildren(el("h4", "", "Заказ"));
        meta(host, "Контакт владельца", value.contact); meta(host, "Отбор", LABELS[value.collectionMethod] || value.collectionMethod);
        meta(host, "Расчётная стоимость, ₽", value.estimatedCost);
        meta(host, "Состояние", value.state === "Cancelled" ? "Отменен" : STATES[value.state]);
        const links = el("div", "lab-actions");
        for (const item of value.samples) links.append(button(lakeName(item.lakeCode) + " · " + item.registrationNumber, "lab-staff-order-sample-" + item.id, () => openSample(item.id)));
        host.append(links); focusHeading(host, "h4"); updateBusy(); note("Заказ загружен в служебном представлении.");
      });
    }
    function buildRoster() {
      const host = el("div", "lab-form", undefined, "lab-staff-technicians"); host.append(el("h4", "", "Назначение лаборанта"), el("p", "lab-muted", "Загрузите список лаборантов участка и выберите исполнителя."));
      state.rosterSelect = field(host, "Лаборант", "lab-staff-technicians-select", "select");
      const actions = el("div", "lab-actions");
      actions.append(button("Загрузить лаборантов", "lab-staff-technicians-load", () => loadRoster(false)),
        button("Следующая страница лаборантов", "lab-staff-technicians-next", () => loadRoster(true)),
        button("Выбрать себя", "lab-staff-technicians-self", () => { if (state.roster.some(item => item.accountId === context.accountId)) state.rosterSelect.value = context.accountId; renderRoster(); }),
        button(ACTIONS.assign, "lab-staff-assign", () => mutate("assign")));
      state.rosterSelect.addEventListener("change", renderRoster); host.append(actions, el("p", "lab-meta", "", "lab-staff-technicians-count")); detail.append(host); renderRoster();
    }
    function renderRoster() {
      const select = state.rosterSelect; if (!select) return; const chosen = select.value;
      options(select, [{ value: "", label: "Выберите из загруженных лаборантов" }, ...state.roster.map(item => ({ value: item.accountId, label: item.displayName + (item.accountId === context.accountId ? " (вы)" : "") }))]);
      select.value = state.roster.some(item => item.accountId === chosen) ? chosen : "";
      flag(select, Boolean(command) || !state.rosterLoaded);
      const host = detail.querySelector("#lab-staff-technicians"); if (!host) return;
      const nextButton = host.querySelector("#lab-staff-technicians-next"); nextButton.hidden = !state.rosterMore; flag(nextButton, !state.rosterMore);
      flag(host.querySelector("#lab-staff-technicians-self"), Boolean(command) || !state.roster.some(item => item.accountId === context.accountId));
      flag(host.querySelector("#lab-staff-assign"), Boolean(command) || !state.roster.some(item => item.accountId === select.value));
      host.querySelector("#lab-staff-technicians-count").textContent = state.rosterLoaded ? "Загружено лаборантов: " + state.roster.length + (state.rosterMore ? ". Есть следующая страница." : ". Других доступных лаборантов нет.") : "Список еще не загружен.";
      updateBusy();
    }
    async function loadRoster(more) {
      const sample = state.selected, selected = selection; if (!sample || state.mode !== "technician" || sample.state !== "Registered") return;
      await run(async (ticket, signal) => {
        const cursor = more ? state.rosterCursor : "", raw = object(await get("lab/technician/technicians?" + queryScope() + (cursor ? "&afterId=" + id(cursor) : ""), signal));
        const items = array(raw.items, 100).map(item => ({ accountId: id(object(item).accountId), displayName: str(item.displayName, 200) }));
        const nextCursor = str(raw.nextCursor, 36);
        if (new Set(items.map(item => item.accountId)).size !== items.length || typeof raw.hasMore !== "boolean" || (raw.hasMore && (!items.length || id(nextCursor) === cursor || nextCursor !== items.at(-1).accountId)) || (!raw.hasMore && nextCursor !== "")) throw invalid();
        if (!fresh(ticket) || selection !== selected) return;
        state.roster = more ? [...state.roster, ...items.filter(item => !state.roster.some(previous => previous.accountId === item.accountId))] : items;
        state.rosterLoaded = true; state.rosterCursor = nextCursor; state.rosterMore = raw.hasMore; renderRoster(); note("Доступная страница лаборантов загружена.");
      });
    }
    function panelIndicators() {
      const panel = state.reference?.panels.find(item => item.code === state.selected?.panel); if (!panel) throw invalid();
      return panel.indicatorCodes.map(code => state.reference.indicators.find(item => item.code === code));
    }
    function buildResults() {
      const form = el("form", "lab-form", undefined, "lab-staff-results-form"); form.noValidate = true; form.append(el("h4", "", "Результаты исследования"), el("p", "lab-muted", "Заполните все показатели. Дробную часть отделяйте точкой, без пробелов."));
      const fields = el("div", "lab-fields");
      for (const indicator of panelIndicators()) {
        const input = field(fields, LABELS[indicator.code] || indicator.code, "lab-staff-value-" + indicator.code, indicator.kind === "qualitative" ? "select" : "text", 32);
        if (indicator.kind === "qualitative") options(input, [{ value: "", label: "Выберите результат" }, ...indicator.allowed.map(value => ({ value, label: LABELS[value] || value }))]);
        else input.inputMode = "decimal";
        const hint = el("p", "lab-muted", (indicator.kind === "qualitative" ? unitLabel(indicator) : "Единица: " + unitLabel(indicator)) + ". Метод: " + indicator.method + (indicator.kind === "decimal" ? ". Допустимо от " + indicator.min + " до " + indicator.max + "." : "."), input.id + "-hint");
        input.setAttribute("aria-describedby", hint.id); input.parentNode.append(hint);
      }
      form.append(fields); field(form, "Комментарий к результатам (виден сотрудникам, обязателен)", "lab-staff-results-comment", "textarea", 500);
      form.append(button(ACTIONS.results, "lab-staff-results-submit", () => mutate("results", form), true));
      form.addEventListener("submit", event => { event.preventDefault(); if (!blocked()) mutate("results", form).catch(report); }); detail.append(form);
    }
    function showFieldError(input, message) {
      for (const node of detail.querySelectorAll('[aria-invalid="true"]')) { node.removeAttribute("aria-invalid"); const old = node.getAttribute("aria-describedby") || ""; const remaining = old.split(" ").filter(value => !value.endsWith("-error")); if (remaining.length) node.setAttribute("aria-describedby", remaining.join(" ")); else node.removeAttribute("aria-describedby"); }
      for (const node of detail.querySelectorAll(".lab-error-summary")) node.remove();
      const error = el("div", "lab-error-summary", undefined, input.id + "-error"); error.tabIndex = -1; error.setAttribute("role", "alert"); error.append(el("p", "", message), button("Перейти к полю", "", () => input.focus()));
      input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" ")); input.parentNode.append(error); error.focus(); note("Проверьте отмеченное поле.", true);
    }
    function checked(input, validate) { try { return validate(input.value); } catch (error) { showFieldError(input, error.message); const failure = new Error("Проверка на стороне клиента"); failure.clientValidation = true; throw failure; } }
    function actionAllowed(action) {
      const sample = state.selected; if (!sample || command || !scopeReady()) return false;
      if (state.mode === "approver") return ["approve", "rework"].includes(action) && canDecide();
      if (action === "register") return sample.state === "Submitted";
      if (["ask-info", "reject"].includes(action)) return ["Submitted", "Registered"].includes(sample.state);
      if (action === "assign") return sample.state === "Registered" && state.rosterLoaded && state.roster.some(item => item.accountId === state.rosterSelect?.value);
      if (action === "start-analysis") return sample.state === "Registered" && sample.technicianAccountId === context.accountId;
      if (action === "results") return sample.state === "InAnalysis" && sample.technicianAccountId === context.accountId;
      if (action === "archive") return sample.state === "Approved";
      return action === "correct" && ["Approved", "Archived"].includes(sample.state);
    }
    async function mutate(action, form) {
      if (blocked() || !actionAllowed(action)) return;
      try {
        const sample = state.selected, body = { expectedRevision: sample.revision };
        if (action === "results") {
          body.comment = checked(form.querySelector("#lab-staff-results-comment"), value => textInput(value, 500, true));
          body.values = panelIndicators().map(indicator => ({ indicatorCode: indicator.code, value: checked(form.querySelector("#lab-staff-value-" + indicator.code), value => indicator.kind === "decimal" ? decimal(value, indicator.min, indicator.max) : indicator.allowed.includes(value) ? value : (() => { throw new Error("Выберите допустимый результат."); })()) }));
        } else {
          body.reason = checked(state.reason, value => textInput(value, 500));
          if (action === "assign") body.technicianAccountId = id(state.rosterSelect.value);
        }
        const intent = { action, body: freeze(body), before: freeze({ ...sample }), key: crypto.randomUUID(), path: PATHS[action].replace("{id}", sample.id), accountId: context.accountId, workspaceId: context.workspaceId, areaId: state.areaId, view: state.mode, protocolVersion: state.protocol?.version || 0, phase: "new", receipt: null };
        await execute(intent);
      } catch (error) { if (!error.clientValidation) report(error); }
    }
    function uncertain(error) { return !Number.isInteger(error?.status) || error.status >= 500 || error.status === 0 || error.code === "некорректно_ответ" || ["сеть_ошибка", "таймаут_ошибка"].includes(error.code); }
    async function execute(intent) {
      if (!intent || intent.accountId !== context.accountId || intent.workspaceId !== context.workspaceId || intent.areaId !== state.areaId || intent.view !== state.mode) return;
      await run(async (ticket, signal) => {
        command = intent; const wasUnknown = intent.phase === "unknown";
        try {
          if (intent.phase !== "confirmed") {
            intent.phase = "sending"; renderCommand();
            const raw = await request(intent.path, { method: "POST", body: intent.body, headers: { "Idempotency-Key": intent.key }, signal });
            const receipt = receiptDTO(raw, intent); if (!fresh(ticket)) return;
            intent.receipt = receipt; intent.phase = "confirmed"; clearSelection(); renderCommand();
          }
          const value = await fetchSample(intent.before.id, intent.view, signal);
          if (!fresh(ticket)) return;
          if (value.revision < intent.receipt.revision || (value.revision === intent.receipt.revision && (value.state !== intent.receipt.state || value.approvedVersion !== intent.receipt.approvedVersion ||
            (intent.action === "assign" && value.technicianAccountId !== intent.body.technicianAccountId) || (intent.action === "correct" && value.technicianAccountId !== context.accountId)))) throw invalid();
          command = null; clearSelection(); state.selected = value; updateQueueSample(value); renderCommand(); renderDetail(); note("Изменение сохранено.");
        } catch (error) {
          if (!fresh(ticket) || onSessionError(error)) return;
          if (intent.phase === "confirmed") { clearSelection(); note("Изменение подтверждено, но актуальную карточку загрузить не удалось. " + errorText(error), true, error); }
          else if (wasUnknown || uncertain(error)) { intent.phase = "unknown"; note(errorText(error), false, error); status.className = "lab-muted"; }
          else { command = null; clearSelection(); note(errorText(error), true, error); }
          if ([401, 403, 404].includes(error?.status)) readFailure(error);
          renderCommand(); renderActions(); renderRoster();
          const submit = detail.querySelector("#lab-staff-results-submit"); if (submit) flag(submit, Boolean(command));
        }
      });
    }
    async function loadHistory(more) {
      const sample = state.selected, selected = selection; if (!sample) return;
      await run(async (ticket, signal) => {
        const cursor = more ? state.historyCursor : 0, raw = object(await get(BASES[state.mode] + "/samples/" + sample.id + "/history?afterRevision=" + cursor, signal));
        const items = array(raw.items, 100).map(item => {
          object(item); const entry = { revision: integer(item.revision, 1, 200), operation: str(item.operation, 100), reason: str(item.reason, 1000), changedAt: str(item.changedAt, 32), actorAccountId: id(item.actorAccountId), before: Object.keys(object(item.before)).length ? inScope(sampleDTO(item.before)) : null, after: inScope(sampleDTO(item.after)) };
          utcTimestamp(entry.changedAt); if (entry.after.id !== sample.id || (entry.before && entry.before.id !== sample.id) || entry.revision <= cursor || entry.after.revision !== entry.revision) throw invalid(); return entry;
        });
        if (typeof raw.hasMore !== "boolean") throw invalid(); const nextRevision = integer(raw.nextRevision, 0, 200);
        if (items.some((item, index) => index > 0 && item.revision <= items[index - 1].revision) || nextRevision !== (items.at(-1)?.revision ?? cursor) || (raw.hasMore && (!items.length || nextRevision <= cursor))) throw invalid();
        if (!fresh(ticket) || selection !== selected) return;
        state.history = more ? [...state.history, ...items.filter(item => !state.history.some(previous => previous.revision === item.revision))] : items;
        state.historyCursor = nextRevision; state.historyMore = raw.hasMore;
        const host = detail.querySelector("#lab-staff-history"); host.replaceChildren();
        for (const entry of state.history) {
          const row = el("div", "lab-card"); row.append(el("p", "", (EVENTS[entry.operation] || "Изменение пробы") + " · " + dateLabel(entry.changedAt)));
          meta(row, "Состояние", (entry.before ? STATES[entry.before.state] + " → " : "") + STATES[entry.after.state]); meta(row, "Комментарий", entry.reason);
          const support = el("details", "lab-meta"); support.append(el("summary", "", "Сведения для поддержки")); meta(support, "Версия записи", entry.revision); meta(support, "Учетная запись участника", entry.actorAccountId); row.append(support); host.append(row);
        }
        if (!state.history.length) host.append(el("p", "lab-empty", "На этой странице истории нет."));
        if (state.historyMore) host.append(button("Следующая страница истории", "lab-staff-history-more", () => loadHistory(true)));
        updateBusy(); note("История пробы загружена.");
      });
    }
    function buildProtocol() {
      const host = el("div", "lab-protocol"); state.protocolHost = host; host.append(el("h4", "", "Протокол исследования"));
      const actions = el("div", "lab-actions"); actions.append(button("Загрузить текущую редакцию", "lab-staff-protocol-load", () => { version.value = ""; clearError(); history.open = false; return loadProtocol(0); }), button("Скачать CSV", "lab-staff-protocol-csv", () => download("csv")), button("Скачать PDF", "lab-staff-protocol-pdf", () => download("pdf")));
      host.append(el("p", "lab-muted", "Текущая редакция может находиться на проверке." + (state.selected.approvedVersion ? " Ранее утвержденная редакция: " + state.selected.approvedVersion + "." : "")), actions, el("div", "", undefined, "lab-staff-protocol-data"));
      const history = el("details", "lab-meta", undefined, "lab-staff-protocol-history-choice"), toggle = el("summary", "", "Открыть редакцию по известному номеру", "lab-staff-protocol-history-toggle"), form = el("form", "", undefined, "lab-staff-protocol-history-form"); form.noValidate = true;
      const version = field(form, "Номер редакции", "lab-staff-protocol-version"); version.inputMode = "numeric"; version.autocomplete = "off";
      const hint = el("p", "lab-muted", "Введите номер редакции от 1 до 20. Старые редакции доступны только для чтения.", "lab-staff-protocol-version-hint"), errors = el("div", "", undefined, "lab-staff-protocol-version-errors");
      version.setAttribute("aria-describedby", hint.id);
      const historyActions = el("div", "lab-actions"), submit = el("button", "lab-button", "Загрузить указанную редакцию", "lab-staff-protocol-history-load"); submit.type = "submit";
      historyActions.append(submit); form.append(hint, errors, historyActions); history.append(toggle, form); host.append(history); detail.append(host);
      function clearError() { errors.replaceChildren(); version.removeAttribute("aria-invalid"); version.setAttribute("aria-describedby", hint.id); }
      version.addEventListener("input", clearError);
      history.addEventListener("toggle", () => { if (root.contains(history)) { if (history.open && !version.disabled) version.focus(); else if (!history.open && history.contains(doc.activeElement)) toggle.focus(); } });
      form.addEventListener("submit", event => {
        event.preventDefault(); if (blocked() || !scopeReady()) return;
        if (!/^(?:[1-9]|1[0-9]|20)$/.test(version.value)) {
          const error = el("p", "lab-error", "Введите целый номер от 1 до 20.", "lab-staff-protocol-version-error"); error.setAttribute("role", "alert"); errors.replaceChildren(error);
          version.setAttribute("aria-invalid", "true"); version.setAttribute("aria-describedby", hint.id + " " + error.id); version.focus(); return;
        }
        clearError(); loadProtocol(Number(version.value)).catch(report);
      });
      updateExports();
    }
    function updateExports() {
      if (!state.protocolHost) return;
      for (const format of ["csv", "pdf"]) { const control = state.protocolHost.querySelector("#lab-staff-protocol-" + format); flag(control, state.protocol?.state !== "Approved"); control.textContent = "Скачать " + format.toUpperCase() + (state.protocol?.state === "Approved" ? " · редакция " + state.protocol.version : " · только утвержденное"); }
    }
    async function loadProtocol(version = 0) {
      const sample = state.selected, selected = selection; if (!sample) return;
      await run(async (ticket, signal) => {
        state.protocolChoice = integer(version, 0, 20); state.protocol = null; state.protocolHost.querySelector("#lab-staff-protocol-data").replaceChildren(); renderActions(); updateExports();
        let raw; try { raw = await get(BASES[state.mode] + "/samples/" + sample.id + "/protocol?version=" + version, signal); }
        catch (error) { if (error?.status === 404) error.labProtocolVersion = version; throw error; }
        const value = protocolDTO(raw, sample);
        if ((version && value.version !== version) || (!version && value.protocolId !== sample.currentProtocolId)) throw invalid();
        const indicators = panelIndicators(); if (value.values.length !== indicators.length) throw invalid();
        for (const item of value.values) { const descriptor = indicators.find(indicator => indicator.code === item.indicatorCode); if (!descriptor || descriptor.kind !== item.kind || descriptor.unit !== item.unit || descriptor.method !== item.method) throw invalid(); try { if (descriptor.kind === "decimal") decimal(item.value, descriptor.min, descriptor.max); else if (!descriptor.allowed.includes(item.value)) throw invalid(); } catch (_) { throw invalid(); } }
        if (!fresh(ticket) || selected !== selection) return;
        state.protocol = value; renderProtocol(); renderActions(); updateExports(); note("Редакция протокола загружена.");
      });
    }
    function renderProtocol() {
      const protocol = state.protocol; if (!protocol || !state.protocolHost) return;
      const host = state.protocolHost.querySelector("#lab-staff-protocol-data"); host.replaceChildren(el("h5", "", "Редакция " + protocol.version), el("p", "lab-meta", "Утверждённая редакция протокола"));
      meta(host, "Состояние", protocol.state === "Reworked" ? "Возвращено на доработку" : STATES[protocol.state]);
      meta(host, "Отбор", dateLabel(protocol.collectedAt)); meta(host, "Утверждение", protocol.approvedAt ? dateLabel(protocol.approvedAt) : "Еще не утверждено");
      meta(host, "Комментарий сотрудника", protocol.comment); if (protocol.correctionReason) meta(host, "Причина исправления", protocol.correctionReason);
      meta(host, "Источник справочника", protocol.source); meta(host, "Версия справочника", protocol.dictionaryVersion);
      const support = el("details", "lab-meta"); support.append(el("summary", "", "Сведения для поддержки")); meta(support, "Автор ввода", protocol.enteredBy); meta(support, "Утвердивший", protocol.approvedBy || "Не назначен"); host.append(support);
      const hint = el("p", "lab-muted", "Таблица прокручивается по горизонтали. С клавиатуры: перейдите к таблице и используйте стрелки.", "lab-staff-protocol-scroll-hint");
      const wrap = el("div", "lab-table-wrap"); wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", "Результаты исследования"); wrap.setAttribute("aria-describedby", hint.id);
      const table = el("table", "lab-table"), head = el("thead"), headings = el("tr"), body = el("tbody");
      for (const text of ["Показатель", "Результат", "Единица", "Метод"]) { const cell = el("th", "", text); cell.scope = "col"; headings.append(cell); } head.append(headings);
      for (const value of protocol.values) { const row = el("tr"); for (const text of [LABELS[value.indicatorCode] || value.indicatorCode, LABELS[value.value] || value.value, unitLabel(value), value.method]) row.append(el("td", "", text)); body.append(row); }
      table.append(head, body); wrap.append(table); host.append(hint, wrap); focusHeading(host, "h5"); updateBusy();
    }
    async function download(format) {
      const sample = state.selected, protocol = state.protocol, selected = selection; if (!sample || protocol?.state !== "Approved" || !["csv", "pdf"].includes(format)) return;
      await run(async (ticket, signal) => {
        const blob = await requestBinary(BASES[state.mode] + "/samples/" + sample.id + "/protocol." + format + "?version=" + protocol.version, format, signal);
        if (!(blob instanceof Blob) || blob.size < 1 || blob.size > 4 * 1024 * 1024) throw invalid();
        if (!fresh(ticket) || selected !== selection) return;
        const url = URL.createObjectURL(blob), anchor = el("a"); urls.add(url); anchor.href = url; anchor.download = "lab-protocol-" + sample.id + "-v" + protocol.version + "." + format; root.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { if (urls.delete(url)) URL.revokeObjectURL(url); }, 1000); note("Проверьте файл в загрузках браузера.");
      });
    }
    function syncContext(value) {
      const source = value || {}, nextContext = emptyContext();
      for (const key of ["accountId", "actorId", "workspaceId"]) nextContext[key] = UUID.test(source[key] || "") ? source[key] : "";
      nextContext.areas = Array.isArray(source.areas) ? source.areas.filter(item => item && UUID.test(item.id) && typeof item.name === "string" && typeof item.state === "string").map(item => ({ id: item.id, name: item.name, state: item.state })) : [];
      for (const key of ["technicianAreaIds", "approverAreaIds"]) nextContext[key] = Array.isArray(source[key]) ? [...new Set(source[key].filter(value => typeof value === "string" && UUID.test(value)))] : [];
      const key = JSON.stringify(nextContext);
      if (key !== contextKey) {
        const previous = context, previousView = state.mode; invalidateScope();
        if (previous.accountId !== nextContext.accountId || previous.actorId !== nextContext.actorId) lostOutcome = false;
        context = nextContext; contextKey = key;
        state.mode = permittedAreas(previousView).length ? previousView : permittedAreas("technician").length ? "technician" : "approver";
        state.filter = state.mode === "technician" ? "Submitted" : "Review"; renderControls();
        note(!context.accountId ? "Войдите, чтобы открыть рабочее место лаборатории." : !scopeReady() ? "Нет доступного участка для лабораторной роли." : "Выберите режим и участок, затем загрузите очередь.");
      } else updateBusy();
    }
    function reset() { generation += 1; invalidateTask(); abortAll(); clearSelection(); context = emptyContext(); contextKey = ""; state = emptyState(); command = null; lostOutcome = false; renderControls(); note("Войдите, чтобы открыть рабочее место лаборатории."); }
    function setExternalBusy(value) { busyEpoch += 1; externalBusy = Boolean(value); updateBusy(); }
    function renderControls() {
      const modes = ["technician", "approver"].filter(view => permittedAreas(view).length);
      if (!modes.includes(state.mode)) state.mode = modes[0] || "technician";
      options(mode, modes.map(value => ({ value, label: value === "technician" ? "Лаборант" : "Утверждающий" }))); mode.value = state.mode;
      const available = permittedAreas(); if (!available.some(item => item.id === state.areaId)) state.areaId = available[0]?.id || "";
      options(area, available.map(item => ({ value: item.id, label: item.name }))); area.value = state.areaId; filter.value = state.filter; renderList(); renderCommand(); updateBusy();
    }
    function changeView(view) { if (!BASES[view] || !permittedAreas(view).length) { renderControls(); return; } invalidateScope(); state.mode = view; state.filter = view === "technician" ? "Submitted" : "Review"; renderControls(); note("Рабочее место изменено. Загрузите очередь заново."); }
    function lakeName(code) { return state.reference?.lakes.find(item => item.code === code)?.name || ({ danilovo: "Данилово", lenyovo: "Ленёво", shchuchye: "Щучье", shaitan: "Шайтан", potaennoe: "Потаённое" })[code] || code; }
    function updateQueueSample(sample) { state.items = state.items.flatMap(item => item.id !== sample.id ? [item] : state.filter && sample.state !== state.filter ? [] : [{ ...sampleDTO(sample), technicianAccountId: sample.technicianAccountId }]); renderList(); }
    function updateQueueSelection() {
      for (const open of list.querySelectorAll("button[data-sample-id]")) {
        const sampleId = open.dataset.sampleId, selected = sampleId === state.selected?.id, markerId = "lab-staff-row-current-" + sampleId;
        open.parentNode.querySelector("#" + markerId)?.remove();
        open.setAttribute("aria-describedby", "lab-staff-row-meta-" + sampleId);
        if (selected) {
          open.setAttribute("aria-current", "true");
          open.parentNode.insertBefore(el("span", "lab-badge", "Открыта", markerId), open.nextSibling);
          open.setAttribute("aria-describedby", "lab-staff-row-meta-" + sampleId + " " + markerId);
        } else open.removeAttribute("aria-current");
      }
    }
    function renderList() {
      list.replaceChildren(el("p", "lab-muted", state.loaded ? "Загружено проб участка: " + state.items.length + ". Это не полный счетчик записей." : "Очередь еще не загружена."));
      if (state.loaded && !state.items.length) list.append(el("p", "lab-empty", "На этой странице проб нет."));
      for (const sample of state.items) {
        const row = el("div", "lab-card"), open = button(lakeName(sample.lakeCode) + " · " + (sample.registrationNumber || "Без регистрационного номера"), "lab-staff-open-sample-" + sample.id, () => openSample(sample.id));
        const description = el("p", "lab-meta", "Отбор: " + dateLabel(sample.collectedAt) + " · Место: " + sample.location + " · " + (LABELS[sample.panel] || sample.panel), "lab-staff-row-meta-" + sample.id); open.dataset.sampleId = sample.id; open.setAttribute("aria-describedby", description.id); row.append(open, el("span", "lab-badge", STATES[sample.state]), description); list.append(row);
      }
      next.hidden = !state.hasMore; updateQueueSelection(); updateBusy();
    }
    function queryScope() { return "workspaceId=" + id(context.workspaceId) + "&areaId=" + id(state.areaId); }
    async function get(path, signal) { return request(path, { signal }); }
    async function ensureReference(ticket, signal) { if (!state.reference) { const value = referenceDTO(await get("lab/reference", signal)); if (!fresh(ticket)) return; state.reference = value; warning.textContent = value.warning; } }
    async function loadQueue(more) {
      await run(async (ticket, signal) => { await ensureReference(ticket, signal); if (!fresh(ticket)) return;
        const cursor = more ? state.cursor : "", raw = object(await get(BASES[state.mode] + "/queue?" + queryScope() + "&state=" + encodeURIComponent(state.filter) + (cursor ? "&afterId=" + id(cursor) : ""), signal));
        const items = array(raw.items, 100).map(item => inScope(sampleDTO(item, "queue"))); if (state.filter && items.some(item => item.state !== state.filter)) throw invalid();
        const nextCursor = str(raw.nextCursor, 36); if (new Set(items.map(item => item.id)).size !== items.length || typeof raw.hasMore !== "boolean" || (raw.hasMore && (!items.length || id(nextCursor) === cursor || nextCursor !== items.at(-1).id)) || (!raw.hasMore && nextCursor !== "")) throw invalid();
        if (!fresh(ticket)) return; state.items = more ? [...state.items, ...items.filter(item => !state.items.some(previous => previous.id === item.id))] : items; state.cursor = nextCursor; state.hasMore = raw.hasMore; state.loaded = true; renderList(); note("Очередь загружена. Выберите пробу, чтобы получить свежую карточку.");
      });
    }
    async function fetchSample(sampleId, view, signal) { const value = inScope(sampleDTO(await get(BASES[view] + "/samples/" + id(sampleId), signal), "detail")); if (value.id !== sampleId) throw invalid(); return value; }
    async function openSample(sampleId) { await run(async (ticket, signal) => { clearSelection(); const selected = selection; await ensureReference(ticket, signal); if (!fresh(ticket)) return; const value = await fetchSample(sampleId, state.mode, signal); if (!fresh(ticket) || selected !== selection) return; state.selected = value; updateQueueSample(value); renderDetail(); note("Служебная карточка загружена."); }); }
    function meta(parent, label, value) { parent.append(el("p", "lab-meta", label + ": " + value)); }
    function focusHeading(host, selector) { const title = host.querySelector(selector); if (title) { title.tabIndex = -1; title.focus(); } }
    function renderDetail() {
      detail.replaceChildren(); const sample = state.selected; if (!sample) return;
      state.protocol = null; state.protocolChoice = 0; state.history = []; state.historyCursor = 0; state.historyMore = false; state.roster = []; state.rosterLoaded = false; state.rosterCursor = ""; state.rosterMore = false;
      detail.append(el("h3", "", "Проба · " + lakeName(sample.lakeCode)), el("span", "lab-badge", STATES[sample.state]));
      const support = el("details", "lab-meta"); support.append(el("summary", "", "Сведения для поддержки")); meta(support, "Служебный код", sample.id); meta(support, "Версия записи", sample.revision); detail.append(support);
      for (const [label, value] of [["Регистрационный номер", sample.registrationNumber || "Не присвоен"], ["Источник", sample.source], ["Место", sample.location], ["Отбор", dateLabel(sample.collectedAt)], ["Условия", sample.conditions], ["Панель", LABELS[sample.panel] || sample.panel], ["Последний комментарий", sample.lastReason || "Нет"], ["Уточнение владельца", sample.clarification || "Нет"], ["Назначение", sample.technicianAccountId === context.accountId ? "Вы" : sample.technicianAccountId ? "Другой лаборант" : "Не назначен"]]) meta(detail, label, value);
      const links = el("div", "lab-actions"); links.append(button("Обновить карточку", "lab-staff-detail-refresh", () => openSample(sample.id)), button("Открыть заказ", "lab-staff-order", loadOrder)); detail.append(links, el("div", "", undefined, "lab-staff-order-data"));
      state.reason = field(detail, "Комментарий к действию (виден участникам процесса, обязателен)", "lab-staff-reason", "text", 500);
      state.actionsHost = el("div", "lab-actions"); detail.append(state.actionsHost);
      if (state.mode === "technician" && sample.state === "Registered") buildRoster();
      if (state.mode === "technician" && sample.state === "InAnalysis" && sample.technicianAccountId === context.accountId) buildResults();
      const history = el("div", "lab-history", undefined, "lab-staff-history"); detail.append(el("h4", "", "История пробы"), button("Загрузить историю", "lab-staff-history-load", () => loadHistory(false)), history);
      buildProtocol(); renderActions(); focusHeading(detail, "h3"); updateBusy();
    }
    function canDecide() { const sample = state.selected, protocol = state.protocol; return state.mode === "approver" && sample?.state === "Review" && protocol?.state === "Review" && state.protocolChoice === 0 && protocol.protocolId === sample.currentProtocolId && protocol.enteredBy !== context.accountId; }
    function renderActions() {
      if (!state.actionsHost || !state.selected) return; const sample = state.selected; state.actionsHost.replaceChildren();
      let actions = [];
      if (state.mode === "technician") {
        if (sample.state === "Submitted") actions = ["register", "ask-info", "reject"];
        else if (sample.state === "Registered") actions = ["ask-info", "reject", ...(sample.technicianAccountId === context.accountId ? ["start-analysis"] : [])];
        else if (sample.state === "Approved") actions = ["archive", "correct"];
        else if (sample.state === "Archived") actions = ["correct"];
      } else if (sample.state === "Review") actions = ["approve", "rework"];
      actions.forEach((action, index) => { const control = button(ACTIONS[action], "lab-staff-" + action, () => mutate(action), index === 0); flag(control, Boolean(command) || (["approve", "rework"].includes(action) && !canDecide())); state.actionsHost.append(control); });
      if (state.mode === "approver" && sample.state === "Review") state.actionsHost.append(el("p", "lab-muted", state.protocol?.enteredBy === context.accountId ? "Вы вводили эти результаты. Для утверждения или возврата нужен другой участник." : "Для решения загрузите текущую редакцию протокола. Исторические редакции доступны только для чтения."));
      state.reason.parentNode.hidden = !actions.length && !(state.mode === "technician" && sample.state === "Registered");
      if (sample.state === "NeedsInfo") state.actionsHost.append(el("p", "lab-muted", "Ожидается ответ владельца в его кабинете. Сотрудник не отвечает за владельца."));
      if (["Approved", "Archived"].includes(sample.state) && state.mode === "technician") state.actionsHost.append(el("p", "lab-muted", "Прежняя редакция остаётся действующей до утверждения исправления."));
      if (state.mode === "technician" && sample.state === "InAnalysis" && sample.technicianAccountId !== context.accountId) state.actionsHost.append(el("p", "lab-muted", "Результаты вводит только назначенный лаборант."));
      updateBusy();
    }
    renderControls();
    return Object.freeze({ syncContext, setExternalBusy, reset });
  }
  globalThis.VodokanalLabStaff = Object.freeze({ create, helpers: Object.freeze({ decimal, utcTimestamp, referenceDTO }) });
})();
