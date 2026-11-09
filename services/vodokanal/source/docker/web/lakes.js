
(() => {
  "use strict";
  const BASE = "/public/hs/lab/v1/";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LAKES = Object.freeze({ danilovo: "Данилово", lenyovo: "Ленёво", shchuchye: "Щучье", shaitan: "Шайтан", potaennoe: "Потаённое" });
  const PUBLIC = Object.freeze(["danilovo", "lenyovo", "shchuchye", "shaitan"]);
  const INDICATORS = Object.freeze({ ph: "pH", turbidity: "Мутность", appearance: "Внешний вид", temperature: "Температура" });
  const QUALITATIVE = Object.freeze({ clear: "Прозрачная", turbid: "Мутная" });
  const PROTOCOL_KEYS = "sampleId,protocolId,version,previousApprovedProtocolId,lakeCode,lakeName,collectedAt,approvedAt,state,dictionaryVersion,source,warning,values".split(",");
  const TRAINING = "Результаты лабораторных исследований.";
  const JSON_LIMIT = 2 * 1024 * 1024, FILE_LIMIT = 4 * 1024 * 1024, DAY = 86400000;
  function fault(code = "некорректно_ответ", status = 0, requestId = "", retryAfter = 0) { return Object.assign(new Error(code), { code, status, requestId, retryAfter }); }
  function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw fault(); return value; }
  function text(value, max = 1000, nonempty = false) { if (typeof value !== "string" || value.length > max || (nonempty && !value.trim())) throw fault(); return value; }
  function integer(value, min, max) { if (!Number.isInteger(value) || value < min || value > max) throw fault(); return value; }
  function array(value, max) { if (!Array.isArray(value) || value.length > max) throw fault(); return value; }
  function id(value) { if (!UUID.test(text(value, 36))) throw fault(); return value; }
  function keys(value, allowed) { object(value); if (Object.keys(value).some(key => !allowed.includes(key))) throw fault(); }
  function utc(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text(value, 20))) throw fault();
    const wire = value, number = Date.parse(wire);
    if (!Number.isFinite(number) || new Date(number).toISOString().slice(0, 19) + "Z" !== wire) throw fault(); return number;
  }
  function utcLabel(value) { return new Date(utc(value)).toISOString().slice(0, 19).replace("T", " ") + " UTC"; }
  function utcWire(number) { return new Date(number).toISOString().slice(0, 19) + "Z"; }
  function dateOnly(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw fault("некорректно_период"); const number = utc(value + "T00:00:00Z"); if (number < Date.UTC(2000, 0, 1)) throw fault("некорректно_период"); return number; }
  function decimal(value, digits = 9) {
    if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)) throw fault();
    const negative = value.startsWith("-"), parts = (negative ? value.slice(1) : value).split(".");
    if (parts[0].length > digits) throw fault();
    const number = BigInt(parts[0]) * 1000000n + BigInt((parts[1] || "").padEnd(6, "0"));
    if (negative && number === 0n) throw fault(); return negative ? -number : number;
  }
  function unitLabel(value) { return value.kind === "qualitative" && value.unit === "code" ? "Качественное значение" : value.unit === "C" ? "°C" : value.unit; }
  function referenceDTO(raw) {
    object(raw);
    const result = { dictionaryVersion: text(raw.dictionaryVersion, 100, true), source: text(raw.source, 200, true), warning: text(raw.warning, 1000, true) };
    result.lakes = array(raw.lakes, 5).map(item => {
      object(item); const code = text(item.code, 32);
      if (!Object.hasOwn(LAKES, code) || item.public !== PUBLIC.includes(code)) throw fault();
      return { code, name: text(item.name, 100, true), public: item.public };
    });
    if (result.lakes.length !== 5 || new Set(result.lakes.map(item => item.code)).size !== 5) throw fault();
    result.indicators = array(raw.indicators, 4).map(item => {
      object(item); const value = { code: text(item.code, 32), kind: text(item.kind, 32), unit: text(item.unit, 32), method: text(item.method, 100, true) };
      if (!Object.hasOwn(INDICATORS, value.code)) throw fault();
      if (value.kind === "decimal") { value.min = text(item.min, 32); value.max = text(item.max, 32); if (decimal(value.min) > decimal(value.max)) throw fault(); }
      else if (value.kind === "qualitative") { value.allowed = array(item.allowed, 10).map(item => text(item, 32)); if (!value.allowed.length || value.allowed.some(item => !Object.hasOwn(QUALITATIVE, item)) || new Set(value.allowed).size !== value.allowed.length) throw fault(); }
      else throw fault(); return value;
    });
    if (result.indicators.length !== 4 || new Set(result.indicators.map(item => item.code)).size !== 4) throw fault(); return result;
  }
  function measurementDTO(raw, reference) {
    keys(raw, ["indicatorCode", "value", "kind", "unit", "method"]);
    const descriptor = reference.indicators.find(item => item.code === raw.indicatorCode);
    if (!descriptor || raw.kind !== descriptor.kind || raw.unit !== descriptor.unit || raw.method !== descriptor.method) throw fault();
    const value = text(raw.value, 32);
    if (descriptor.kind === "decimal") { const number = decimal(value); if (number < decimal(descriptor.min) || number > decimal(descriptor.max)) throw fault(); }
    else if (!descriptor.allowed.includes(value)) throw fault();
    return { indicatorCode: descriptor.code, value, kind: descriptor.kind, unit: descriptor.unit, method: descriptor.method };
  }
  function protocolDTO(raw, reference) {
    keys(raw, PROTOCOL_KEYS);
    const result = { sampleId: id(raw.sampleId), protocolId: id(raw.protocolId), version: integer(raw.version, 1, 20),
      previousApprovedProtocolId: raw.previousApprovedProtocolId === "" ? "" : id(raw.previousApprovedProtocolId),
      lakeCode: text(raw.lakeCode, 32), lakeName: text(raw.lakeName, 100, true), collectedAt: text(raw.collectedAt, 20),
      approvedAt: text(raw.approvedAt, 20), state: text(raw.state, 32), dictionaryVersion: text(raw.dictionaryVersion, 100, true),
      source: text(raw.source, 200, true), warning: text(raw.warning, 1000, true) };
    if (!PUBLIC.includes(result.lakeCode) || result.state !== "Approved" || result.dictionaryVersion !== reference.dictionaryVersion) throw fault();
    utc(result.collectedAt); utc(result.approvedAt);
    result.values = array(raw.values, 4).map(item => measurementDTO(item, reference));
    if (!result.values.length || new Set(result.values.map(item => item.indicatorCode)).size !== result.values.length) throw fault(); return result;
  }
  function withinQuery(protocol, query) { return protocol.lakeCode === query.lakeCode && utc(protocol.collectedAt) >= utc(query.from) && utc(protocol.collectedAt) < utc(query.to) && (!query.indicatorCode || protocol.values.some(item => item.indicatorCode === query.indicatorCode)); }
  function listDTO(raw, reference, query, cursor) {
    keys(raw, ["items", "hasMore", "nextCursor", "limit", "warning", "source"]);
    const limit = integer(raw.limit, 1, 100);
    if (limit !== 25) throw fault();
    const items = array(raw.items, limit).map(item => protocolDTO(item, reference)), nextCursor = text(raw.nextCursor, 36);
    if (items.some(item => !withinQuery(item, query)) || new Set(items.map(item => item.sampleId)).size !== items.length || typeof raw.hasMore !== "boolean") throw fault();
    if (raw.hasMore ? !items.length || id(nextCursor) !== items.at(-1).sampleId || nextCursor === cursor : nextCursor !== "") throw fault();
    return { items, hasMore: raw.hasMore, nextCursor, limit, warning: text(raw.warning, 1000, true), source: text(raw.source, 200, true) };
  }
  function summaryDTO(raw, reference, query) {
    keys(raw, "lakeCode,from,to,timeBasis,sampleCount,indicators,source,dictionaryVersion,status,generatedAt,warning".split(","));
    const result = { lakeCode: text(raw.lakeCode, 32), from: text(raw.from, 20), to: text(raw.to, 20), timeBasis: text(raw.timeBasis, 32),
      sampleCount: integer(raw.sampleCount, 0, 1000), source: text(raw.source, 200, true), dictionaryVersion: text(raw.dictionaryVersion, 100, true),
      status: text(raw.status, 32), generatedAt: text(raw.generatedAt, 20), warning: text(raw.warning, 1000, true) };
    if (result.lakeCode !== query.lakeCode || result.status !== "Approved" || result.timeBasis !== "collectedAt" || utc(result.from) !== utc(query.from) || utc(result.to) !== utc(query.to) || result.dictionaryVersion !== reference.dictionaryVersion) throw fault();
    utc(result.generatedAt);
    result.indicators = array(raw.indicators, 4).map(item => {
      object(item); const descriptor = reference.indicators.find(value => value.code === item.indicatorCode);
      if (!descriptor || item.kind !== descriptor.kind || item.unit !== descriptor.unit || item.method !== descriptor.method || (query.indicatorCode && item.indicatorCode !== query.indicatorCode)) throw fault();
      const value = { indicatorCode: descriptor.code, kind: descriptor.kind, unit: descriptor.unit, method: descriptor.method, count: integer(item.count, 1, result.sampleCount) };
      if (value.kind === "decimal") {
        keys(item, ["indicatorCode", "kind", "unit", "method", "count", "sum", "min", "max"]);
        value.sum = text(item.sum, 40); value.min = text(item.min, 32); value.max = text(item.max, 32);
        const sum = decimal(value.sum, 15), min = decimal(value.min), max = decimal(value.max), count = BigInt(value.count);
        if (min > max || min < decimal(descriptor.min) || max > decimal(descriptor.max) || sum < min * count || sum > max * count) throw fault();
      } else {
        keys(item, ["indicatorCode", "kind", "unit", "method", "count", "counts"]); keys(item.counts, ["clear", "turbid"]);
        value.counts = { clear: integer(item.counts.clear, 0, value.count), turbid: integer(item.counts.turbid, 0, value.count) };
        if (value.counts.clear + value.counts.turbid !== value.count) throw fault();
      } return value;
    });
    if (new Set(result.indicators.map(item => item.indicatorCode)).size !== result.indicators.length || (result.sampleCount === 0) !== (result.indicators.length === 0)) throw fault();
    if (query.indicatorCode && result.sampleCount && (result.indicators.length !== 1 || result.indicators[0].count !== result.sampleCount)) throw fault(); return result;
  }
  function create({ root, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    if (!root || typeof fetchImpl !== "function") throw new Error("Не подключены зависимости публичной лаборатории");
    const doc = root.ownerDocument, node = (tag, className, content, elementId) => { const value = doc.createElement(tag); if (className) value.className = className; if (content !== undefined) value.textContent = content; if (elementId) value.id = elementId; return value; };
    let generation = 0, task = null, lakeCode = "danilovo", reference = null, items = [], query = null, hasMore = false, cursor = "", loaded = false, listSource = "", loadedAt = "", selected = null, protocol = null, version = 0, summary = null;
    let historyOpen = false, historyDraft = "";
    const urls = new Set();
    const title = node("h1", "", "Исследования озёр", "lakes-heading");
    const intro = node("p", "intro", "Выберите озеро и период отбора проб.");
    const training = node("p", "notice warning", TRAINING, "lakes-training");
    const navigation = node("nav", "lake-nav"); navigation.setAttribute("aria-label", "Озёра");
    for (const [code, name] of Object.entries(LAKES)) { const control = button(name + (code === "potaennoe" ? " · закрыто" : ""), "lakes-lake-" + code, () => chooseLake(code), false); control.dataset.lake = code; navigation.append(control); }
    const heading = node("h2", "", LAKES[lakeCode], "lakes-lake-heading"), publicSection = node("section"), closed = node("section", "notice", undefined, "lakes-closed");
    closed.append(node("h3", "", "Результаты Потаённого закрыты"), node("p", "", "Исследования этого озера доступны в личном кабинете."));
    const login = node("a", "", "Перейти в личный кабинет"); login.href = "/login#lab"; closed.append(login);
    const form = node("form", "filters"); form.noValidate = true;
    const fields = node("div", "fields"), from = field(fields, "С даты отбора (UTC)", "lakes-from", "date"), to = field(fields, "По дату включительно (UTC)", "lakes-to", "date"), indicator = field(fields, "Показатель", "lakes-indicator", "select");
    from.min = to.min = "2000-01-01"; from.max = to.max = "9999-12-30";
    const today = Date.now(), midnight = Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), new Date(today).getUTCDate());
    from.value = new Date(midnight - 29 * DAY).toISOString().slice(0, 10); to.value = new Date(midnight).toISOString().slice(0, 10);
    fillOptions(indicator, [{ value: "", label: "Все показатели" }, ...Object.entries(INDICATORS).map(([value, label]) => ({ value, label }))]);
    const filterHint = node("p", "muted", "До 366 суток, по времени отбора в UTC. Последняя дата включена. Протокол всегда показывается целиком.", "lakes-filter-hint");
    from.setAttribute("aria-describedby", filterHint.id); to.setAttribute("aria-describedby", filterHint.id); indicator.setAttribute("aria-describedby", filterHint.id);
    const actions = node("div", "actions"), refresh = button("Показать исследования", "lakes-refresh", () => loadList(false)), summarize = button("Сформировать сводку по озеру", "lakes-summary-load", loadSummary);
    refresh.classList.add("primary"); actions.append(refresh, summarize); form.append(fields, filterHint, actions);
    const status = node("p", "notice", "Выберите период и нажмите «Показать исследования».", "lakes-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const diagnostic = node("div", "", undefined, "lakes-diagnostic"), errors = node("div", "", undefined, "lakes-errors");
    const workspace = node("div", "workspace"), listPanel = node("section"), list = node("ol", "record-list", undefined, "lakes-list"), listMeta = node("p", "muted", "", "lakes-list-meta"), next = button("Следующая страница исследований", "lakes-next", () => loadList(true));
    listPanel.append(node("h3", "", "История исследований"), listMeta, list, next);
    const detail = node("section", "protocol-panel", undefined, "lakes-protocol"); detail.setAttribute("aria-label", "Публичный протокол");
    workspace.append(listPanel, detail);
    const summaryHost = node("section", "summary-panel", undefined, "lakes-summary"); summaryHost.setAttribute("aria-label", "Сводка по озеру");
    publicSection.append(form, errors, workspace, summaryHost); root.replaceChildren(title, intro, navigation, heading, closed, status, diagnostic, publicSection);
    form.addEventListener("submit", event => { event.preventDefault(); loadList(false).catch(showError); });
    form.addEventListener("change", () => { invalidate(); clearResults(); clearFieldErrors(); setStatus("Фильтры изменены. Загрузите исследования или сводку заново."); });
    function button(label, elementId, handler, read = true) {
      const value = node("button", "", label, elementId); value.type = "button"; if (read) value.dataset.readAction = "true";
      value.addEventListener("click", event => { event.preventDefault(); if (!value.disabled) Promise.resolve().then(handler).catch(showError); }); return value;
    }
    function field(parent, label, elementId, type) { const wrap = node("div", "field"), caption = node("label", "", label), value = node(type === "select" ? "select" : "input", "", undefined, elementId); if (type !== "select") value.type = type; caption.htmlFor = elementId; wrap.append(caption, value); parent.append(wrap); return value; }
    function fillOptions(select, values) { select.replaceChildren(...values.map(item => { const option = node("option", "", item.label); option.value = item.value; return option; })); }
    function isPublic() { return PUBLIC.includes(lakeCode); }
    function current(ticket) { return task === ticket && ticket.generation === generation && isPublic(); }
    function busy() { for (const control of root.querySelectorAll("button[data-read-action],input[data-read-action]")) control.disabled = Boolean(task) || !isPublic(); next.disabled = Boolean(task) || !hasMore; next.hidden = !hasMore; root.setAttribute("aria-busy", String(Boolean(task))); }
    function invalidate() { generation += 1; const previous = task; task = null; if (previous) { clearTimeout(previous.timer); previous.controller.abort(); } for (const url of urls) URL.revokeObjectURL(url); urls.clear(); busy(); }
    function clearResults() { items = []; query = null; hasMore = false; cursor = ""; loaded = false; listSource = ""; loadedAt = ""; selected = null; protocol = null; version = 0; historyOpen = false; historyDraft = ""; summary = null; renderList(); renderDetail(); renderSummary(); }
    function setStatus(message, error = false) { status.textContent = message; status.className = error ? "notice error" : "notice"; diagnostic.replaceChildren(); }
    function showError(error, knownVersion = 0) {
      const message = error?.status === 429 ? "Слишком много запросов." + (error.retryAfter ? " Подождите " + error.retryAfter + " с." : " Подождите перед повтором.") + " Автоматического повтора не будет."
        : error?.code === "некорректно_период" ? "Проверьте даты: допустим период от 1 до 366 суток, начиная с 2000 года."
        : error?.code === "кабинет_лаборатория_сводка_лимит" ? "Слишком много исследований для сводки. Сократите период или выберите показатель."
        : error?.status === 404 ? (knownVersion > 0 ? "Редакция " + knownVersion + " недоступна для публичного просмотра." : "Публичные данные или выбранная редакция недоступны.") + " Это не подтверждает отсутствие других редакций."
        : [401, 403].includes(error?.status) ? "Публичный сервис недоступен без входа. Эта страница не запрашивает учётные данные."
        : error?.code === "некорректно_ответ" ? "Ответ публичного сервиса не прошёл проверку. Результаты этого запроса не показаны."
        : error?.code === "ответ_слишком_большое" ? "Ответ превышает допустимый размер. Данные не загружены."
        : error?.code === "таймаут_ошибка" ? "Публичный сервис не ответил за 20 секунд. Повторите загрузку вручную."
        : "Не удалось загрузить публичные данные. Проверьте соединение или повторите позже.";
      setStatus(message, true);
      const support = node("details"); support.append(node("summary", "", "Сведения для поддержки"));
      for (const [key, label] of [["code", "Код ошибки"], ["requestId", "Код запроса"]]) if (/^[a-zA-ZА-Яа-яЁё0-9_-]{1,160}$/.test(error?.[key] || "")) support.append(node("p", "meta", label + ": " + error[key]));
      if (support.children.length > 1) diagnostic.append(support);
    }
    function chooseLake(code) {
      if (!Object.hasOwn(LAKES, code) || code === lakeCode) return;
      invalidate(); lakeCode = code; clearResults(); clearFieldErrors(); renderLake();
      setStatus(isPublic() ? "Озеро изменено. Загрузите исследования или сводку." : "Закрытое озеро: запросов результатов нет.");
      heading.tabIndex = -1; heading.focus();
    }
    function renderLake() { heading.textContent = LAKES[lakeCode]; closed.hidden = isPublic(); publicSection.hidden = !isPublic(); for (const control of navigation.querySelectorAll("button")) control.setAttribute("aria-pressed", String(control.dataset.lake === lakeCode)); busy(); }
    function clearFieldErrors() { errors.replaceChildren(); for (const input of [from, to, indicator]) { input.removeAttribute("aria-invalid"); input.setAttribute("aria-describedby", filterHint.id); } }
    function fieldError(input, message) { clearFieldErrors(); const error = node("div", "field-error", undefined, "lakes-field-error"); error.tabIndex = -1; error.setAttribute("role", "alert"); const link = node("a", "", "Перейти к полю"); link.href = "#" + input.id; link.addEventListener("click", event => { event.preventDefault(); input.focus(); }); error.append(node("p", "", message), link); errors.append(error); input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", filterHint.id + " " + error.id); error.focus(); }
    function filters() {
      clearFieldErrors(); let start, end;
      try { start = dateOnly(from.value); } catch (_) { fieldError(from, "Введите существующую начальную дату не ранее 2000 года."); return null; }
      try { end = dateOnly(to.value) + DAY; utc(utcWire(end)); } catch (_) { fieldError(to, "Введите существующую конечную дату."); return null; }
      if (end <= start || end - start > 366 * DAY) { fieldError(to, "Выберите конечную дату не раньше начальной. Период не может превышать 366 суток."); return null; }
      if (indicator.value && !Object.hasOwn(INDICATORS, indicator.value)) { fieldError(indicator, "Выберите показатель из списка."); return null; }
      return Object.freeze({ lakeCode, from: utcWire(start), to: utcWire(end), indicatorCode: indicator.value });
    }
    function params(value, afterId = "") { const result = new URLSearchParams({ lakeCode: value.lakeCode, from: value.from, to: value.to }); if (value.indicatorCode) result.set("indicatorCode", value.indicatorCode); if (afterId) result.set("afterId", id(afterId)); return result; }
    function allowedPath(path, parameters) {
      const allowed = path === "reference" ? [] : path === "protocols" ? ["lakeCode", "from", "to", "indicatorCode", "afterId"] : path === "summary" ? ["lakeCode", "from", "to", "indicatorCode"] : /^samples\/[0-9a-f-]{36}\/protocol(?:\.csv|\.pdf)?$/i.test(path) ? ["version"] : null;
      if (!allowed || [...parameters.keys()].some(key => !allowed.includes(key))) throw fault();
      if (allowed.includes("version")) { id(path.split("/")[1]); if (!/^(?:[0-9]|1[0-9]|20)$/.test(parameters.get("version") || "")) throw fault(); }
      else if (path !== "reference") { if (!PUBLIC.includes(parameters.get("lakeCode"))) throw fault(); utc(parameters.get("from")); utc(parameters.get("to")); if (parameters.has("indicatorCode") && !Object.hasOwn(INDICATORS, parameters.get("indicatorCode"))) throw fault(); if (parameters.has("afterId")) id(parameters.get("afterId")); }
      return BASE + path + (parameters.size ? "?" + parameters.toString() : "");
    }
    async function bytes(response, limit) {
      const declared = response.headers.get("Content-Length"); if (declared && /^[0-9]+$/.test(declared) && Number(declared) > limit) throw fault("ответ_слишком_большое");
      if (!response.body?.getReader) throw fault();
      const reader = response.body.getReader(), chunks = []; let total = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) { await reader.cancel(); throw fault("ответ_слишком_большое"); } chunks.push(value); } } finally { reader.releaseLock(); }
      const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
    }
    async function request(path, parameters, ticket, format = "json") {
      const response = await fetchImpl(allowedPath(path, parameters), { method: "GET", credentials: "omit", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: format === "json" ? "application/json" : format === "pdf" ? "application/pdf" : "text/csv" }, signal: ticket.controller.signal });
      if (!response.ok) {
        let data = null; try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(response, 16384))); } catch (_) {  }
        const retry = response.headers.get("Retry-After"), retryAfter = /^[0-9]{1,4}$/.test(retry || "") ? Math.min(3600, Number(retry)) : 0;
        throw fault(typeof data?.error?.code === "string" ? data.error.code : "хттп_ошибка", response.status, typeof data?.requestId === "string" ? data.requestId : response.headers.get("X-Request-ID") || "", retryAfter);
      }
      if (response.status !== 200 || response.headers.get("X-API-Contract") !== "1.0") throw fault();
      const contentType = response.headers.get("Content-Type") || "", expected = format === "json" ? /^application\/json(?:;|$)/i : format === "pdf" ? /^application\/pdf(?:;|$)/i : /^text\/csv(?:;|$)/i;
      if (!expected.test(contentType)) throw fault();
      const data = await bytes(response, format === "json" ? JSON_LIMIT : FILE_LIMIT); if (!data.length) throw fault();
      if (format === "pdf") { if (new TextDecoder("ascii").decode(data.subarray(0, 5)) !== "%PDF-") throw fault(); return new Blob([data], { type: "application/pdf" }); }
      let decoded; try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch (_) { throw fault(); }
      if (format === "csv") { if (decoded.includes("\0") || !decoded.includes("indicatorCode;")) { if (!decoded.includes('"indicatorCode";') || decoded.includes("\0")) throw fault(); } return new Blob([data], { type: "text/csv;charset=utf-8" }); }
      try { return JSON.parse(decoded); } catch (_) { throw fault(); }
    }
    async function run(kind, handler) {
      if (task || !isPublic()) return;
      const ticket = { generation, controller: new AbortController(), timedOut: false, timer: null };
      task = ticket; ticket.timer = setTimeout(() => { ticket.timedOut = true; ticket.controller.abort(); }, 20000);
      busy(); setStatus("Загрузка публичных данных…");
      try { await handler(ticket); } catch (error) {
        if (current(ticket)) {
          if (kind === "list") { items = []; loaded = false; cursor = ""; hasMore = false; selected = null; protocol = null; renderList(); renderDetail(); }
          if (kind === "summary") { summary = null; renderSummary(); }
          if (kind === "detail") { protocol = null; renderDetail(); }
          showError(ticket.timedOut ? fault("таймаут_ошибка") : error instanceof TypeError ? fault("сеть_ошибка") : error, kind === "detail" ? version : 0);
          if (kind === "detail" && error?.status === 404 && version > 0 && !ticket.timedOut) {
            focus(detail, "h3");
          }
        }
      } finally { clearTimeout(ticket.timer); ticket.controller.abort(); if (task === ticket) { task = null; busy(); } }
    }
    async function ensureReference(ticket) { if (reference) return; const value = referenceDTO(await request("reference", new URLSearchParams(), ticket)); if (current(ticket)) { reference = value; training.textContent = value.warning; } }
    async function loadList(more) {
      if (task || !isPublic()) return; const chosen = filters(); if (!chosen) return;
      if (more && (!query || JSON.stringify(chosen) !== JSON.stringify(query) || !hasMore)) return;
      const afterId = more ? cursor : "";
      await run("list", async ticket => {
        if (!more) { items = []; loaded = false; hasMore = false; cursor = ""; selected = null; protocol = null; renderList(); renderDetail(); }
        await ensureReference(ticket); if (!current(ticket)) return;
        const value = listDTO(await request("protocols", params(chosen, afterId), ticket), reference, chosen, afterId);
        if (!current(ticket)) return;
        items = more ? [...items, ...value.items.filter(item => !items.some(previous => previous.sampleId === item.sampleId))] : value.items;
        query = chosen; hasMore = value.hasMore; cursor = value.nextCursor; listSource = value.source; loadedAt = utcWire(Date.now()); loaded = true; renderList();
        setStatus(items.length ? "Публичная страница исследований загружена." : "По выбранному озеру, периоду и показателю утвержденных исследований не найдено.");
      });
    }
    async function loadSummary() {
      if (task || !isPublic()) return; const chosen = filters(); if (!chosen) return;
      await run("summary", async ticket => {
        summary = null; renderSummary(); await ensureReference(ticket); if (!current(ticket)) return;
        const value = summaryDTO(await request("summary", params(chosen), ticket), reference, chosen);
        if (!current(ticket)) return; summary = value; renderSummary(); setStatus("Сводка по озеру за выбранный период.");
        focus(summaryHost, "h3");
      });
    }
    function focus(host, selector) { const element = host.querySelector(selector); if (element) { element.tabIndex = -1; element.focus(); } }
    function metadata(host, pairs) { const block = node("dl", "metadata"); for (const [label, value] of pairs) block.append(node("dt", "", label), node("dd", "", String(value))); host.append(block); }
    function renderList() {
      list.replaceChildren(); listMeta.textContent = loaded ? "Загружено записей: " + items.length + ". Источник: " + listSource + ". Загружено: " + utcLabel(loadedAt) + "." : "Исследования ещё не загружены.";
      for (const item of items) {
        const row = node("li", "record"), open = button("Отбор: " + utcLabel(item.collectedAt), "lakes-open-" + item.sampleId, () => openProtocol(item));
        const info = node("p", "meta", "Редакция " + item.version + " · Утверждено: " + utcLabel(item.approvedAt), "lakes-row-meta-" + item.sampleId);
        open.setAttribute("aria-describedby", info.id); if (selected?.sampleId === item.sampleId) { open.setAttribute("aria-current", "true"); row.append(node("p", "current", "Открыто")); }
        row.append(open, info);
        const values = query?.indicatorCode ? item.values.filter(value => value.indicatorCode === query.indicatorCode) : item.values;
        row.append(node("p", "", values.map(value => INDICATORS[value.indicatorCode] + ": " + (QUALITATIVE[value.value] || value.value) + (value.kind === "decimal" ? " " + unitLabel(value) : "")).join(" · ")));
        list.append(row);
      }
      if (loaded && !items.length) list.append(node("li", "muted", "Утвержденных исследований для этого отбора нет."));
      busy();
    }
    async function openProtocol(item) {
      if (task || !isPublic()) return; selected = item; protocol = null; version = 0; historyOpen = false; historyDraft = ""; renderList(); renderDetail(); await loadProtocol();
    }
    async function loadProtocol() {
      const item = selected, chosenVersion = version; if (!item || task || !isPublic()) return;
      await run("detail", async ticket => {
        protocol = null; renderDetail(); await ensureReference(ticket); if (!current(ticket)) return;
        const value = protocolDTO(await request("samples/" + id(item.sampleId) + "/protocol", new URLSearchParams({ version: String(chosenVersion) }), ticket), reference);
        if (value.sampleId !== item.sampleId || value.lakeCode !== lakeCode || utc(value.collectedAt) !== utc(item.collectedAt) || (chosenVersion && value.version !== chosenVersion)) throw fault();
        if (!current(ticket)) return; protocol = value; renderDetail(); setStatus("Загружена утверждённая редакция " + value.version + "."); focus(detail, "h3");
      });
    }
    function table(host, caption, headings, rows, prefix) {
      const hint = node("p", "muted", "Таблица прокручивается по горизонтали. С клавиатуры: перейдите к таблице и используйте стрелки.", prefix + "-scroll-hint");
      const wrap = node("div", "table-wrap"); wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", caption); wrap.setAttribute("aria-describedby", hint.id);
      const value = node("table"), header = node("thead"), headingRow = node("tr"), body = node("tbody"); value.append(node("caption", "", caption));
      for (const label of headings) { const cell = node("th", "", label); cell.scope = "col"; headingRow.append(cell); } header.append(headingRow);
      for (const cells of rows) { const row = node("tr"); for (const content of cells) row.append(node("td", "", String(content))); body.append(row); }
      value.append(header, body); wrap.append(value); host.append(hint, wrap);
    }
    function renderDetail() {
      detail.replaceChildren(node("h3", "", "Публичный протокол"));
      if (!selected) { detail.append(node("p", "muted", "Выберите исследование из загруженного списка.")); return; }
      if (protocol) {
        detail.append(node("span", "badge", "Утверждено"), node("h4", "", LAKES[protocol.lakeCode] + " · редакция " + protocol.version),
          node("p", "meta", "Результаты утверждённой редакции.", "lakes-protocol-training"));
        metadata(detail, [["Отбор пробы", utcLabel(protocol.collectedAt)], ["Утверждение", utcLabel(protocol.approvedAt)], ["Источник", protocol.source]]);
        table(detail, "Результаты исследования", ["Показатель", "Результат", "Единица", "Метод"], protocol.values.map(value => [INDICATORS[value.indicatorCode], QUALITATIVE[value.value] || value.value, unitLabel(value), value.method]), "lakes-protocol");
      }
      const controls = node("div", "actions"); controls.append(button("Загрузить текущую утверждённую редакцию", "lakes-protocol-current", () => {
        if (task || !isPublic()) return; version = 0; historyOpen = false; historyDraft = ""; return loadProtocol();
      }));
      if (protocol) for (const format of ["csv", "pdf"]) controls.append(button("Скачать " + format.toUpperCase() + " · редакция " + protocol.version, "lakes-download-" + format, () => download(format)));
      detail.append(controls);
      const history = node("details", "", undefined, "lakes-history-choice"), disclosure = node("summary", "", "Открыть редакцию по известному номеру", "lakes-history-toggle");
      history.open = historyOpen; history.append(disclosure);
      const historyForm = node("form"); historyForm.noValidate = true;
      const choice = field(historyForm, "Номер редакции", "lakes-version", "text");
      choice.inputMode = "numeric"; choice.autocomplete = "off"; choice.value = historyDraft; choice.dataset.readAction = "true";
      const hint = node("p", "muted", "Введите номер редакции от 1 до 20.", "lakes-version-hint");
      choice.setAttribute("aria-describedby", hint.id);
      const validation = node("div", "", undefined, "lakes-version-errors"), historyActions = node("div", "actions");
      const submit = node("button", "", "Загрузить указанную редакцию", "lakes-protocol-load"); submit.type = "submit"; submit.dataset.readAction = "true";
      historyActions.append(submit); historyForm.append(hint, validation, historyActions); history.append(historyForm); detail.append(history);
      choice.addEventListener("input", () => { historyDraft = choice.value; validation.replaceChildren(); choice.removeAttribute("aria-invalid"); choice.setAttribute("aria-describedby", hint.id); });
      history.addEventListener("toggle", () => {
        if (!detail.contains(history) || historyOpen === history.open) return;
        historyOpen = history.open; if (historyOpen) choice.focus(); else disclosure.focus();
      });
      historyForm.addEventListener("submit", event => {
        event.preventDefault(); if (task || !isPublic()) return;
        historyDraft = choice.value;
        if (!/^(?:[1-9]|1[0-9]|20)$/.test(historyDraft)) {
          const error = node("p", "field-error", "Введите целый номер от 1 до 20.", "lakes-version-error"); error.setAttribute("role", "alert");
          validation.replaceChildren(error); choice.setAttribute("aria-invalid", "true"); choice.setAttribute("aria-describedby", hint.id + " " + error.id); choice.focus(); return;
        }
        version = Number(historyDraft); loadProtocol().catch(showError);
      });
      if (!protocol) { detail.append(node("p", "muted", "Выбранная редакция ещё не загружена.")); busy(); return; }
      const support = node("details", "", undefined, "lakes-protocol-info"); support.append(node("summary", "", "Сведения о документе"));
      support.append(node("p", "muted", "Фильтр показателя не сокращает содержимое протокола и скачиваемых файлов."));
      metadata(support, [["Версия справочника", protocol.dictionaryVersion], ["Код пробы", protocol.sampleId], ["Код редакции", protocol.protocolId]]);
      detail.append(support); busy();
    }
    function renderSummary() {
      summaryHost.replaceChildren(node("h3", "", "Сводка по озеру"));
      if (!summary) { summaryHost.append(node("p", "muted", "Загрузите сводку за выбранный период, не более 366 суток и 1000 исследований.")); return; }
      summaryHost.append(node("span", "badge", "Только утвержденные исследования"), node("p", "meta", "Сводка по выбранному периоду.", "lakes-summary-training"));
      metadata(summaryHost, [["Озеро", LAKES[summary.lakeCode]], ["Начало периода, включительно", utcLabel(summary.from)], ["Конец периода, не включён", utcLabel(summary.to)],
        ["Подходящих исследований", summary.sampleCount], ["Сформировано", utcLabel(summary.generatedAt)], ["Источник", summary.source]]);
      if (!summary.sampleCount) summaryHost.append(node("p", "muted", "В выбранном периоде подходящих утвержденных исследований нет. Отсутствие измерений не означает нулевое значение."));
      else table(summaryHost, "Сводные измерения", ["Показатель", "Измерений", "Результаты", "Единица"], summary.indicators.map(value => [INDICATORS[value.indicatorCode], value.count,
        value.kind === "decimal" ? "Минимум: " + value.min + "; максимум: " + value.max + "; сумма: " + value.sum : "Прозрачная: " + value.counts.clear + "; мутная: " + value.counts.turbid, unitLabel(value)]), "lakes-summary");
      const info = node("details", "", undefined, "lakes-summary-info"); info.append(node("summary", "", "Как сформирована сводка"));
      info.append(node("p", "muted", "Сводка охватывает весь выбранный период, до 366 суток и 1000 исследований. Даты отбора проб — в UTC."));
      metadata(info, [["Версия справочника", summary.dictionaryVersion]]); summaryHost.append(info);
    }
    async function download(format) {
      const value = protocol; if (!value || !["csv", "pdf"].includes(format) || task || !isPublic()) return;
      await run("export", async ticket => {
        const blob = await request("samples/" + id(value.sampleId) + "/protocol." + format, new URLSearchParams({ version: String(value.version) }), ticket, format);
        if (!current(ticket)) return; const url = URL.createObjectURL(blob), link = node("a"); urls.add(url); link.href = url; link.download = "public-lab-" + value.sampleId + "-v" + value.version + "." + format; root.append(link); link.click(); link.remove();
        setTimeout(() => { if (urls.delete(url)) URL.revokeObjectURL(url); }, 1000); setStatus("Проверьте файл в загрузках браузера.");
      });
    }
    function reset() { invalidate(); reference = null; lakeCode = "danilovo"; clearResults(); clearFieldErrors(); training.textContent = TRAINING; renderLake(); setStatus("Данные очищены. Загрузите исследования заново."); }
    function destroy() { reset(); globalThis.removeEventListener("pagehide", reset); root.replaceChildren(); }
    globalThis.addEventListener("pagehide", reset);
    const initial = new URLSearchParams(root.ownerDocument.defaultView?.location?.search || "");
    if (["lakeCode", "from", "to"].some(key => initial.has(key))) {
      try {
        if (["lakeCode", "from", "to"].some(key => initial.getAll(key).length !== 1) || !PUBLIC.includes(initial.get("lakeCode"))) throw fault("некорректно_период");
        const start = utc(initial.get("from")), end = utc(initial.get("to"));
        if (start < Date.UTC(2000, 0, 1) || start % DAY || end % DAY || end <= start || end - start > 366 * DAY) throw fault("некорректно_период");
        lakeCode = initial.get("lakeCode"); from.value = new Date(start).toISOString().slice(0, 10); to.value = new Date(end - DAY).toISOString().slice(0, 10);
        const indicatorCode = initial.get("indicatorCode") || "";
        if (indicatorCode && Object.hasOwn(INDICATORS, indicatorCode)) indicator.value = indicatorCode;
        setStatus("Озеро и период перенесены из публичной сводки. Нажмите «Показать исследования».");
      } catch (_) { setStatus("Параметры ссылки не приняты. Выберите озеро и период вручную.", true); }
    }
    renderLake(); renderList(); renderDetail(); renderSummary();
    return Object.freeze({ reset, destroy });
  }
  globalThis.VodokanalLakes = Object.freeze({ create, helpers: Object.freeze({ utc, decimal, referenceDTO, protocolDTO, summaryDTO }) });
  if (typeof document !== "undefined") { const root = document.getElementById("lakes-app"); if (root) create({ root }); }
})();
