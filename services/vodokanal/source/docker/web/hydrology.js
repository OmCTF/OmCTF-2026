
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PAGE_LIMIT = 25;
  const displayPostName = value => value.replace(/^Учебный (?:HTTP )?пост /u, "Гидропост ");
  const displayObservationText = value => value.replace(/^Учебн(?:ый|ая|ое|ые) (.)/u, (_, letter) => letter.toUpperCase()).replace(/^Синтетический участок, проверка интерфейса$/u, "Участок наблюдений");
  const RIVERS = Object.freeze({ irtysh: "Иртыш", om: "Омь" });
  const CONDITIONS = Object.freeze({ missing: "Измерений нет", stale: "Данные устарели", low: "Ниже нижнего порога", normal: "Между порогами", high: "Выше верхнего порога" });
  const LABELS = Object.freeze({ create: "Создать гидропост", configure: "Изменить настройки", measure: "Добавить измерение", correct: "Исправить измерение", import: "Загрузить CSV", generate: "Создать ряд" });
  const POST_KEYS = "id,name,riverCode,riverName,referenceVersion,location,unit,datum,lowThreshold,highThreshold,staleAfterSeconds,published,revision,training,warning";
  const MEASUREMENT_KEYS = "id,postId,measuredAt,level,unit,source,revision,published,training";
  const RECEIPT_KEYS = "commandId,operation,postId,workspaceId,areaId,postRevision,measurementCount,measurements,algorithmVersion,seed,committedAt";
  const invalid = () => Object.assign(new Error("Некорректный ответ гидрологии"), { status: 200, code: "некорректно_ответ" });
  function object(v) { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v; }
  function exact(v, names) { object(v); const wanted = names.split(",").sort(); if (Object.keys(v).sort().join(",") !== wanted.join(",")) throw invalid(); return v; }
  function text(v, max = 2000, required = false) { if (typeof v !== "string" || v.length > max || required && !v.trim()) throw invalid(); return v; }
  function id(v) { if (!UUID.test(text(v, 36))) throw invalid(); return v; }
  function integer(v, min, max) { if (!Number.isSafeInteger(v) || v < min || v > max) throw invalid(); return v; }
  function boolean(v) { if (typeof v !== "boolean") throw invalid(); return v; }
  function level(v) { if (typeof v !== "number" || !Number.isFinite(v) || v < -10000 || v > 10000 || Math.round(v * 10) / 10 !== v) throw invalid(); return v; }
  function array(v, max) { if (!Array.isArray(v) || v.length > max) throw invalid(); return v; }
  function unique(rows, key = "id") { if (new Set(rows.map(r => r[key])).size !== rows.length) throw invalid(); return rows; }
  function freeze(v) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
  function utc(v) {
    text(v, 20);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) throw invalid();
    const d = new Date(v);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 19) + "Z" !== v) throw invalid();
    return v;
  }
  const nowUTC = () => new Date().toISOString().slice(0, 19) + "Z";
  const displayTime = value => { const s = utc(value); return s.slice(8, 10) + "." + s.slice(5, 7) + "." + s.slice(0, 4) + " " + s.slice(11, 19) + " UTC"; };
  const displayLevel = value => level(value).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " см";
  function dateParts(value) { utc(value); return { date: value.slice(8, 10) + "." + value.slice(5, 7) + "." + value.slice(0, 4), time: value.slice(11, 19) }; }
  function enteredUTC(date, time) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new Error("Введите дату ДД.ММ.ГГГГ и время ЧЧ:ММ:СС (UTC).");
    const s = date.slice(6) + "-" + date.slice(3, 5) + "-" + date.slice(0, 2) + "T" + time + "Z";
    try { return utc(s); } catch { throw new Error("Проверьте дату и время: такого значения в календаре нет."); }
  }
  function enteredLevel(value) {
    if (!/^-?(?:0|[1-9]\d{0,4})(?:[.,]\d)?$/.test(value)) throw new Error("Введите уровень от −10000 до 10000 см, не более одного знака после запятой или точки.");
    try { return level(Number(value.replace(",", "."))); } catch { throw new Error("Уровень должен быть от −10000 до 10000 см, без округления."); }
  }
  function enteredInteger(value, min, max) {
    if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error("Введите целое число от " + min + " до " + max + ".");
    return Number(value);
  }
  function referenceDTO(v) {
    exact(v, "referenceVersion,rivers,warning");
    if (v.referenceVersion !== "hydrology-rivers-v1") throw invalid();
    text(v.warning, 2000, true);
    unique(array(v.rivers, 2), "code");
    if (v.rivers.length !== 2) throw invalid();
    for (const r of v.rivers) {
      exact(r, "code,name,unit,datum");
      if (!Object.hasOwn(RIVERS, r.code) || r.name !== RIVERS[r.code] || r.unit !== "cm") throw invalid();
      text(r.datum, 500, true);
    }
    return v;
  }
  function postDTO(v, privateView, scope) {
    exact(v, POST_KEYS + (privateView ? ",workspaceId,areaId" : ""));
    id(v.id); text(v.name, 150, true); text(v.location, 250, true);
    if (!Object.hasOwn(RIVERS, v.riverCode) || v.riverName !== RIVERS[v.riverCode] || v.referenceVersion !== "hydrology-rivers-v1" || v.unit !== "cm" || v.training !== true) throw invalid();
    text(v.datum, 500, true); text(v.warning, 2000, true); level(v.lowThreshold); level(v.highThreshold);
    if (v.lowThreshold >= v.highThreshold) throw invalid();
    integer(v.staleAfterSeconds, 300, 604800); boolean(v.published); integer(v.revision, 1, 1000000000);
    if (privateView) { if (id(v.workspaceId) !== scope.workspaceId || id(v.areaId) !== scope.areaId) throw invalid(); }
    else if (!v.published) throw invalid();
    return v;
  }
  function measurementDTO(v, postId, history = false, publicView = false) {
    exact(v, MEASUREMENT_KEYS + (history ? ",previousId,reason,authorId,recordedAt,commandId,algorithmVersion,seed" : ""));
    id(v.id); if (id(v.postId) !== postId || v.unit !== "cm" || v.training !== true) throw invalid();
    utc(v.measuredAt); level(v.level); text(v.source, 120, true); integer(v.revision, 1, 100); boolean(v.published);
    if (publicView && !v.published) throw invalid();
    if (history) {
      if (v.previousId) id(v.previousId); else text(v.previousId, 0); text(v.reason, 500, true); id(v.authorId); utc(v.recordedAt); id(v.commandId);
      if (!["", "hydrology-lcg-v1"].includes(v.algorithmVersion)) throw invalid();
      integer(v.seed, 0, 2147483646); if (!v.algorithmVersion && v.seed !== 0) throw invalid();
    }
    return v;
  }
  function postsDTO(v, privateView, scope, expectedRiver = "", after = "") {
    exact(v, "items,limit,hasMore,snapshotAt,nextCursor");
    const limit = PAGE_LIMIT;
    if (v.limit !== limit) throw invalid();
    boolean(v.hasMore); utc(v.snapshotAt);
    unique(array(v.items, limit).map(row => postDTO(row, privateView, scope)));
    if (v.hasMore && v.items.length !== limit) throw invalid();
    if (v.items.some(row => row.id === after || expectedRiver && row.riverCode !== expectedRiver)) throw invalid();
    if (v.hasMore) { if (id(v.nextCursor) !== v.items.at(-1).id || v.nextCursor === after) throw invalid(); }
    else if (v.nextCursor !== "") throw invalid();
    return v;
  }
  function seriesDTO(v, privateView, scope, selectedId, period, after = "") {
    exact(v, "post,current,condition,stale,hasData,from,to,items,limit,hasMore,nextCursor,nextAfterTime,snapshotAt");
    postDTO(v.post, privateView, scope); if (v.post.id !== selectedId) throw invalid();
    if (v.limit !== PAGE_LIMIT || utc(v.from) !== period.from || utc(v.to) !== period.to) throw invalid();
    utc(v.snapshotAt); boolean(v.hasMore); boolean(v.stale); boolean(v.hasData);
    if (!Object.hasOwn(CONDITIONS, v.condition)) throw invalid();
    const items = unique(array(v.items, PAGE_LIMIT).map(row => measurementDTO(row, selectedId, false, !privateView)), "measuredAt");
    let last = after ? after.split("|").at(-1) : "";
    for (const row of items) { if (row.measuredAt < v.from || row.measuredAt > v.to || last && row.measuredAt <= last || row.measuredAt > v.snapshotAt) throw invalid(); last = row.measuredAt; }
    if (v.hasMore) {
      if (items.length !== PAGE_LIMIT || utc(v.nextAfterTime) !== last || v.nextCursor !== ["h1", selectedId, period.from, period.to, last].join("|") || v.nextCursor === after) throw invalid();
    } else if (v.nextAfterTime !== "" || v.nextCursor !== "") throw invalid();
    if (v.current === null) {
      if (v.hasData || v.stale || v.condition !== "missing" || items.length) throw invalid();
    } else {
      const c = measurementDTO(v.current, selectedId, false, !privateView);
      if (!v.hasData || c.measuredAt > v.snapshotAt || items.some(row => row.measuredAt > c.measuredAt)) throw invalid();
      const stale = Date.parse(v.snapshotAt) - Date.parse(c.measuredAt) > v.post.staleAfterSeconds * 1000;
      const condition = stale ? "stale" : c.level < v.post.lowThreshold ? "low" : c.level > v.post.highThreshold ? "high" : "normal";
      if (v.stale !== stale || v.condition !== condition) throw invalid();
    }
    return v;
  }
  function historyPage(v, kind, postId, measuredAt, cursor = "") {
    exact(v, "items,limit,hasMore,nextCursor,snapshotAt"); if (v.limit !== PAGE_LIMIT) throw invalid();
    boolean(v.hasMore); utc(v.snapshotAt); unique(array(v.items, PAGE_LIMIT));
    let before = cursor ? Number(cursor.split("|").at(-1)) : 10001;
    for (const row of v.items) { integer(row.revision, 1, 10000); if (row.revision >= before) throw invalid(); before = row.revision; }
    if (v.hasMore) {
      if (v.items.length !== PAGE_LIMIT || v.nextCursor !== ["hh1", kind, postId, measuredAt, before].join("|") || v.nextCursor === cursor) throw invalid();
    } else if (v.nextCursor !== "") throw invalid();
    return v;
  }
  function historyDTO(v, postId, measuredAt, cursor = "") {
    historyPage(v, "measurement", postId, measuredAt, cursor);
    for (const row of v.items) { measurementDTO(row, postId, true); if (row.measuredAt !== measuredAt) throw invalid(); }
    return v;
  }
  function settingsDTO(v, postId, scope, cursor = "") {
    historyPage(v, "settings", postId, "", cursor);
    for (const row of v.items) {
      exact(row, "id,postId,revision,operation,authorId,recordedAt,reason,commandId,before,after");
      if (id(row.postId) !== postId || id(row.id) !== id(row.commandId) || row.operation !== (row.revision === 1 ? "create" : "configure")) throw invalid();
      id(row.authorId); utc(row.recordedAt); text(row.reason, 500, true);
      postDTO(row.after, true, scope);
      if (row.after.id !== postId || row.after.revision !== row.revision) throw invalid();
      if (row.revision === 1) { if (row.before !== null) throw invalid(); }
      else { postDTO(row.before, true, scope); if (row.before.id !== postId || row.before.revision !== row.revision - 1) throw invalid(); }
    }
    return v;
  }
  function parseCSV(csv) {
    if (typeof csv !== "string" || csv.length > 12000 || csv.includes("\uFFFD") || csv.includes('"') || csv.startsWith("\uFEFF")) throw new Error("Нужен UTF-8 CSV без BOM и кавычек, до 12000 символов.");
    const lines = csv.replace(/\r\n/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (lines[0] !== "measuredAt,level,source") throw new Error("Первая строка должна быть measuredAt,level,source.");
    if (lines.length < 2 || lines.length > 101) throw new Error("CSV должен содержать от 1 до 100 измерений.");
    const rows = lines.slice(1).map((line, index) => {
      const parts = line.split(",");
      try {
        if (parts.length !== 3 || !/^-?(?:0|[1-9]\d{0,4})(?:\.\d)?$/.test(parts[1]) || !parts[2].trim() || parts[2].length > 120 || /[\r\n\t]/.test(parts[2])) throw new Error();
        return { measuredAt: utc(parts[0]), level: level(Number(parts[1])), source: parts[2] };
      } catch { throw new Error("Проверьте строку " + (index + 2) + ": UTC с Z, уровень с точкой и источник без запятых."); }
    });
    if (new Set(rows.map(r => r.measuredAt)).size !== rows.length) throw new Error("В CSV повторяется время измерения. Объедините или исправьте строки до отправки.");
    return rows;
  }
  function receiptDTO(v, intent) {
    exact(v, RECEIPT_KEYS); id(v.commandId); id(v.postId); utc(v.committedAt);
    const b = intent.body;
    if (v.commandId !== intent.key || v.operation !== intent.operation || id(v.workspaceId) !== b.workspaceId || id(v.areaId) !== b.areaId || intent.postId && v.postId !== intent.postId) throw invalid();
    integer(v.postRevision, 1, 1000000000); integer(v.measurementCount, 0, 100);
    if (v.measurementCount !== intent.times.length) throw invalid();
    if (intent.operation === "create" && v.postRevision !== 1 || intent.operation === "configure" && v.postRevision !== b.expectedRevision + 1) throw invalid();
    if (intent.operation === "generate") { if (v.algorithmVersion !== "hydrology-lcg-v1" || v.seed !== b.seed) throw invalid(); }
    else if (v.algorithmVersion !== "" || v.seed !== 0) throw invalid();
    const rows = unique(array(v.measurements, 100));
    if (rows.length !== intent.times.length) throw invalid();
    const times = new Set();
    for (const row of rows) {
      exact(row, "id,measuredAt,revision"); id(row.id); utc(row.measuredAt);
      if (!intent.times.includes(row.measuredAt) || times.has(row.measuredAt) || row.revision !== (intent.operation === "correct" ? b.expectedRevision + 1 : 1)) throw invalid();
      times.add(row.measuredAt);
    }
    return v;
  }
  const rawSession = error => [400, 404].includes(error?.status) && error?.code === "хттп_ошибка";
  const accessLost = error => [401, 403, 404].includes(error?.status) || rawSession(error);
  const unknownWrite = error => !Number.isInteger(error?.status) || error.status <= 0 || error.status >= 500 || error.code === "некорректно_ответ";
  function errorLabel(error) {
    if (error.code === "некорректно_ответ") return "Ответ сервера не прошёл проверку. Данные не обновлены.";
    if (error.status === 409) return "Данные изменились или запись конфликтует с существующей. Обновите пост и проверьте ввод.";
    if (error.status === 429) return "Слишком много запросов. Повторите загрузку позже.";
    if (error.status === 413) return "Размер отправляемого набора превышает лимит.";
    if (error.status === 400) return "Сервер отклонил ввод. Проверьте параметры и формат CSV.";
    if (accessLost(error)) return "Доступ прекращён. Закрытые данные очищены.";
    return "Не удалось получить подтверждённый ответ сервера.";
  }

  function createView({ root, request, operator = false, setGlobalBusy = () => {}, onSessionError = () => false, onMutationLock = () => {} }) {
    if (!root || typeof request !== "function") throw new Error("Нужны корневой элемент гидрологии и обработчик запроса");
    const doc = root.ownerDocument, prefix = operator ? "hyd-operator" : "hyd-public";
    let context = emptyContext(), generation = 0, busy = false, externalBusy = false, externalLock = false, lastLock = false, controller = null;
    let reference = null, posts = null, selectedId = "", data = null, history = null, historyTime = "", settingsHistory = null, form = null, intent = null, receipt = null, phase = "idle", readFailed = false, retained = "", retryRejected = false;
    let areaId = "", riverCode = "", queryPeriod = null, pageCount = 0, statusMessage = "", chartObserver = null;
    const el = (tag, cls = "", value, identifier) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; if (identifier) n.id = prefix + "-" + identifier; return n; };
    const shell = el("section", "hyd-app"), heading = el(operator ? "h2" : "h1", "", operator ? "Гидрология: рабочее место" : "Уровни рек", "heading"); heading.tabIndex = -1;
    const notice = el("p", "hyd-notice", "Измерения уровней воды в Иртыше и Оми.");
    const status = el("p", "hyd-status", "", "status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const errors = el("div", "hyd-error", undefined, "errors"); errors.tabIndex = -1; errors.hidden = true;
    const diagnostics = el("div"), scopeHost = el("div", "hyd-grid"), selectionHost = el("div", "hyd-grid"), fullLabels = el("div", "hyd-context", undefined, "selection-labels");
    const area = operator ? field(scopeHost, "Участок", "area", "select") : null;
    const river = field(selectionHost, "Река", "river", "select"), post = field(selectionHost, "Гидропост", "post", "select");
    const loadButton = button("Загрузить посты", "load", () => load(), true);
    scopeHost.append(loadButton);
    const catalogActions = el("div", "hyd-actions"), postsMore = button("Загрузить ещё посты", "posts-more", () => loadPublicPosts(true));
    postsMore.setAttribute("aria-controls", post.id); catalogActions.append(postsMore);
    const periodForm = el("form", "hyd-grid", undefined, "period"); periodForm.noValidate = true;
    const fromFields = dateFields(periodForm, "Начало периода", "from"), toFields = dateFields(periodForm, "Конец периода", "to");
    const initialTo = nowUTC(), initialFrom = new Date(Date.parse(initialTo) - 7 * 86400000).toISOString().slice(0, 19) + "Z";
    setDate(fromFields, initialFrom); setDate(toFields, initialTo);
    const periodHelp = el("p", "hyd-muted hyd-full", "Период до 365 суток, включая обе даты. Время — UTC. Последнее измерение может быть вне выбранного периода.");
    const periodButton = el("button", "hyd-primary", "Показать период", "period-submit"); periodButton.type = "submit"; periodForm.append(periodHelp, periodButton);
    const commandHost = el("section", "hyd-command", undefined, "command"), outcome = el("section", "", undefined, "outcome"); outcome.setAttribute("aria-live", "polite");
    const currentHost = el("section", "hyd-section", undefined, "current"), seriesHost = el("section", "hyd-section", undefined, "series"), historyHost = el("section", "hyd-section", undefined, "history"), settingsHost = el("section", "hyd-section", undefined, "settings-history");
    shell.append(heading, scopeHost, status, errors, diagnostics, selectionHost, fullLabels, catalogActions, periodForm, outcome, commandHost, currentHost, seriesHost, historyHost, settingsHost);
    root.replaceChildren(shell);
    periodForm.addEventListener("submit", event => { event.preventDefault(); if (!blocked()) showPeriod(); });
    if (area) area.addEventListener("change", () => { if (blocked()) return; const next = area.value, fact = outcomeFact(); clearData(); retained = fact; areaId = allowedAreas().some(r => r.id === next) ? next : ""; render(); note("Участок изменён. Загрузите посты."); });
    river.addEventListener("change", () => {
      if (operator ? blocked() : externalBusy) return;
      riverCode = river.value; clearSelection();
      posts = null; render(); loadPublicPosts();
    });
    post.addEventListener("change", () => { if (blocked()) return; clearSelection(); selectedId = posts?.items.some(r => r.id === post.value && (!riverCode || r.riverCode === riverCode)) ? post.value : ""; render(); note("Пост выбран. Покажите измерения за период."); });
    function emptyContext() { return { accountId: "", actorId: "", workspaceId: "", areas: [], dispatcherAreaIds: [] }; }
    function allowedAreas() { return context.areas.filter(r => r.state === "Active" && context.dispatcherAreaIds.includes(r.id)); }
    function scope() { return { workspaceId: context.workspaceId, areaId }; }
    function ready() { return !operator || !!(context.accountId && context.actorId && context.workspaceId && allowedAreas().some(r => r.id === areaId)); }
    function ownLock() { return ["sending", "unknown"].includes(phase) || phase === "confirmed" && readFailed; }
    function blocked() { return busy || externalBusy || ownLock(); }
    function mutateBlocked() { return blocked() || externalLock || !operator || !ready(); }
    function cancelPendingRead() { generation++; controller?.abort(); controller = null; busy = false; setGlobalBusy(false); }
    function outcomeFact() { return ["sending", "unknown"].includes(phase) ? "Результат отправки неизвестен. Проверьте журнал перед новой отправкой." : phase === "confirmed" ? "Изменение сохранено. Выберите участок и обновите данные." : ""; }
    function clearChartObserver() { chartObserver?.disconnect(); chartObserver = null; }
    function clearSelection() { clearChartObserver(); cancelPendingRead(); selectedId = ""; data = null; history = null; historyTime = ""; settingsHistory = null; form = null; intent = null; receipt = null; phase = "idle"; readFailed = false; retryRejected = false; queryPeriod = null; pageCount = 0; clearErrors(); }
    function clearData() { clearSelection(); reference = null; posts = null; riverCode = ""; retained = ""; }
    function reset() { const fact = outcomeFact() || retained; clearData(); context = emptyContext(); areaId = ""; retained = fact; render(); note(operator ? "Войдите в кабинет и выберите доступный участок." : "Данные очищены."); }
    function syncContext(value) {
      if (!operator) return;
      let next;
      try {
        next = { accountId: value?.accountId || "", actorId: value?.actorId || "", workspaceId: value?.workspaceId || "", areas: [], dispatcherAreaIds: [] };
        for (const name of ["accountId", "actorId", "workspaceId"]) if (next[name]) id(next[name]);
        next.areas = unique(array(value?.areas || [], 100).map(r => ({ id: id(r.id), name: text(r.name, 150, true), state: text(r.state, 32) })));
        next.dispatcherAreaIds = array(value?.dispatcherAreaIds || [], 100).map(id);
        if (next.dispatcherAreaIds.some(key => !next.areas.some(r => r.id === key && r.state === "Active"))) throw invalid();
      } catch { reset(); note("Не удалось проверить доступные участки. Обновите кабинет.", true); return; }
      if (JSON.stringify(next) !== JSON.stringify(context)) {
        const fact = outcomeFact(); clearData(); context = next; areaId = allowedAreas()[0]?.id || ""; retained = fact;
        render(); note(allowedAreas().length ? "Загрузите гидропосты выбранного участка." : "Нет действующей роли диспетчера в доступных участках.");
      } else update();
    }
    function setExternalBusy(value) { externalBusy = !!value; update(); }
    function setExternalMutationLock(value) { externalLock = !!value; update(); }
    function field(parent, label, identifier, type = "text", hint = "", max = 0) {
      const wrap = el("div", "hyd-field"), caption = el("label", "", label), input = el(["select", "textarea"].includes(type) ? type : "input", "", undefined, identifier);
      caption.htmlFor = input.id; if (!["select", "textarea"].includes(type)) input.type = type;
      if (max) input.maxLength = max;
      if (type === "textarea") input.rows = 3;
      wrap.append(caption, input);
      if (hint) { const help = el("p", "hyd-muted", hint, identifier + "-hint"); input.setAttribute("aria-describedby", help.id); wrap.append(help); }
      parent.append(wrap); return input;
    }
    function button(label, identifier, handler, primary = false) {
      const n = el("button", primary ? "hyd-primary" : "", label, identifier); n.type = "button";
      n.addEventListener("click", () => { if (!n.disabled) Promise.resolve(handler()).catch(error => note(error.message || "Не удалось выполнить действие.", true)); }); return n;
    }
    function options(select, rows, value, blank) {
      select.replaceChildren(); const first = el("option", "", blank); first.value = ""; select.append(first);
      for (const row of rows) { const option = el("option", "", row.name); option.value = row.id; select.append(option); }
      select.value = value;
    }
    function definition(parent, rows) { const list = el("dl", "hyd-context"); for (const [name, value] of rows) list.append(el("dt", "", name), el("dd", "", value)); parent.append(list); return list; }
    function dateFields(parent, label, identifier) {
      const date = field(parent, label + ": дата", identifier + "-date", "text", "ДД.ММ.ГГГГ", 10), time = field(parent, label + ": время (UTC)", identifier + "-time", "text", "ЧЧ:ММ:СС", 8);
      date.inputMode = "numeric"; time.inputMode = "numeric"; date.placeholder = "ДД.ММ.ГГГГ"; time.placeholder = "ЧЧ:ММ:СС"; return { date, time };
    }
    function setDate(fields, value) { const parts = dateParts(value); fields.date.value = parts.date; fields.time.value = parts.time; }
    function inputDate(fields) {
      const date = fields.date.value.trim(), time = fields.time.value.trim();
      checked(fields.date, () => { if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) throw new Error("Введите дату ДД.ММ.ГГГГ."); });
      checked(fields.time, () => { if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) throw new Error("Введите время ЧЧ:ММ:СС (UTC), от 00:00:00 до 23:59:59."); });
      return checked(fields.date, () => enteredUTC(date, time));
    }
    function checked(input, fn) { try { return fn(); } catch (e) { e.field = input; throw e; } }
    function required(input, max) { return checked(input, () => { const s = input.value.trim(); if (!s || s.length > max) throw new Error("Заполните поле, не более " + max + " символов."); return s; }); }
    function clearErrors() {
      errors.replaceChildren(); errors.hidden = true;
      for (const input of shell.querySelectorAll('[aria-invalid="true"]')) {
        input.removeAttribute("aria-invalid");
        const ids = (input.getAttribute("aria-describedby") || "").split(" ").filter(id => id && id !== errors.id);
        if (ids.length) input.setAttribute("aria-describedby", ids.join(" ")); else input.removeAttribute("aria-describedby");
      }
    }
    function localError(error) {
      clearErrors(); errors.append(el("h3", "", "Проверьте ввод"));
      if (error.field) {
        error.field.setAttribute("aria-invalid", "true");
        error.field.setAttribute("aria-describedby", [error.field.getAttribute("aria-describedby"), errors.id].filter(Boolean).join(" "));
        const link = el("a", "", error.message); link.href = "#" + error.field.id; link.addEventListener("click", event => { event.preventDefault(); error.field.focus(); }); errors.append(link);
      } else errors.append(el("p", "", error.message));
      errors.hidden = false; errors.focus();
    }
    function note(message, isError = false, error = null) {
      statusMessage = message; status.textContent = message; status.className = isError ? "hyd-error" : "hyd-status";
      status.hidden = ownLock() || !message; diagnostics.replaceChildren();
      if (error) { const details = el("details"), summary = el("summary", "", "Сведения для поддержки"); details.append(summary, el("p", "hyd-muted", "Код: " + String(error.code || "транспорт_ошибка") + (error.requestId ? ". Запрос: " + String(error.requestId) : ""))); diagnostics.append(details); }
    }
    function lose(error) {
      const fact = outcomeFact() || retained; clearData(); context = emptyContext(); areaId = ""; retained = fact;
      render(); note("Доступ прекращён. Закрытые данные очищены.", true, error); onSessionError(error, fact);
    }
    async function readTask(body, message) {
      if (blocked() || !ready()) return;
      const ticket = generation; controller = new AbortController(); busy = true; setGlobalBusy(true); clearErrors(); note(message); update();
      try { await body(ticket, controller.signal); }
      catch (error) {
        if (ticket !== generation) return;
        if (operator && accessLost(error)) lose(error);
        else { readFailed = true; renderData(); renderOutcome(); note(errorLabel(error), true, error); }
      } finally { if (ticket === generation) { busy = false; controller = null; setGlobalBusy(false); update(); } }
    }
    const apiPath = suffix => operator ? "hydrology/" + suffix : suffix;
    async function fetchReference(signal) { return referenceDTO(await request(apiPath("reference"), { signal })); }
    async function fetchPosts(signal, expectedScope = scope(), expectedRiver = riverCode, cursor = "") {
      const params = { ...(operator ? expectedScope : {}), limit: String(PAGE_LIMIT), ...(expectedRiver ? { riverCode: expectedRiver } : {}), ...(cursor ? { cursor } : {}) };
      return postsDTO(await request(apiPath("posts") + "?" + new URLSearchParams(params), { signal }), operator, expectedScope, expectedRiver, cursor);
    }
    function selectedPost() { return data?.post?.id === selectedId ? data.post : posts?.items.find(r => r.id === selectedId); }
    function periodValue() {
      const from = inputDate(fromFields), to = inputDate(toFields), ms = Date.parse(to) - Date.parse(from);
      if (ms < 0 || ms > 365 * 86400000) throw Object.assign(new Error("Конец должен быть не раньше начала; период не более 365 суток."), { field: toFields.date });
      return { from, to };
    }
    async function fetchSeries(signal, target = selectedId, after = "", expectedPeriod = queryPeriod, expectedScope = scope()) {
      const query = new URLSearchParams({ ...expectedPeriod, limit: String(PAGE_LIMIT), ...(after ? { cursor: after } : {}) });
      return seriesDTO(await request(apiPath("posts/" + id(target) + "/series") + "?" + query, { signal }), operator, expectedScope, target, expectedPeriod, after);
    }
    async function load() {
      if (blocked() || !ready()) return;
      clearSelection(); posts = null; render();
      await readTask(async (ticket, signal) => {
        const expectedScope = scope(), expectedRiver = riverCode, ref = await fetchReference(signal);
        if (ticket !== generation) return;
        const list = await fetchPosts(signal, expectedScope, expectedRiver);
        if (ticket !== generation) return;
        reference = ref; posts = list; render(); note(list.items.length ? "Выберите реку и гидропост." : "В полученной выборке гидропостов нет.");
      }, "Загружаем гидропосты…");
    }
    async function loadPublicPosts(more = false) {
      if (blocked() || !ready() || !reference || more && !posts?.hasMore) return;
      const previous = posts, cursor = more ? posts.nextCursor : "", expectedRiver = riverCode, focusMore = doc.activeElement === postsMore;
      if (!more) { clearSelection(); posts = null; render(); }
      const expectedGeneration = generation; let loaded = false;
      await readTask(async (ticket, signal) => {
        const next = await fetchPosts(signal, scope(), expectedRiver, cursor);
        if (ticket !== generation) return;
        if (more) next.items = unique([...previous.items, ...next.items]);
        posts = next; loaded = true; render();
        note(next.items.length ? "Загружено постов: " + next.items.length + (next.hasMore ? ". Можно загрузить следующую страницу." : ". Продолжения списка нет.") : operator ? "В выбранной реке и участке гидропостов нет." : "В выбранной реке опубликованных постов нет.");
      }, more ? "Загружаем следующую страницу постов…" : "Загружаем посты выбранной реки…");
      if (loaded && expectedGeneration === generation && more && !posts.hasMore && focusMore) post.focus();
    }
    async function showPeriod(more = false) {
      if (!selectedId) { localError(Object.assign(new Error("Выберите гидропост."), { field: post })); return; }
      if (!more) { try { queryPeriod = periodValue(); } catch (e) { localError(e); return; } }
      const after = more ? data?.nextCursor : "";
      if (more && !after) return;
      await readTask(async (ticket, signal) => {
        const next = await fetchSeries(signal, selectedId, after);
        if (ticket !== generation) return;
        if (more) { const combined = [...data.items, ...next.items]; if (new Set(combined.map(r => r.measuredAt)).size !== combined.length) throw invalid(); next.items = combined; }
        data = next; pageCount = more ? pageCount + 1 : 1; history = null; historyTime = ""; readFailed = false; renderData(); renderOperator(); renderOutcome(); note("Обновлено: " + displayTime(next.snapshotAt) + ".");
      }, "Загружаем измерения…");
    }
    function render() {
      if (area) options(area, allowedAreas(), areaId, "Выберите участок");
      options(river, reference?.rivers.map(r => ({ id: r.code, name: r.name })) || [], riverCode, "Все реки");
      const visiblePosts = (posts?.items || []).filter(r => !riverCode || r.riverCode === riverCode);
      if (data?.post?.id === selectedId && !visiblePosts.some(r => r.id === selectedId) && (!riverCode || data.post.riverCode === riverCode)) visiblePosts.push(data.post);
      options(post, visiblePosts.map(row => ({ ...row, name: displayPostName(row.name) })), selectedId, "Выберите гидропост");
      fullLabels.replaceChildren();
      const p = selectedPost();
      if (operator && areaId) definition(fullLabels, [["Участок", allowedAreas().find(r => r.id === areaId)?.name || ""]]);
      if (p) definition(fullLabels, [["Выбранный гидропост", displayPostName(p.name)], ["Река и место", p.riverName + ". " + displayObservationText(p.location)]]);
      if (posts) fullLabels.append(el("p", "hyd-muted", "Загружено постов: " + posts.items.length + (posts.hasMore ? ". Продолжение — ниже." : ". Продолжения списка нет.") + " Для обновления нажмите «Загрузить посты»."));
      renderData(); renderOperator(); renderOutcome(); renderSettingsHistory(); update();
    }
    function update() {
      shell.setAttribute("aria-busy", String(busy));
      const lock = ownLock(); if (lock !== lastLock) { lastLock = lock; onMutationLock(lock); }
      if (area) area.disabled = blocked() || !allowedAreas().length;
      loadButton.disabled = blocked() || !ready(); river.disabled = (operator ? blocked() : externalBusy) || !reference; post.disabled = blocked() || !posts;
      catalogActions.hidden = !posts?.hasMore;
      postsMore.disabled = blocked() || !posts?.hasMore;
      for (const input of periodForm.querySelectorAll("input,button")) input.disabled = blocked() || !selectedId;
      for (const input of commandHost.querySelectorAll("input,select,textarea,button")) input.disabled = mutateBlocked() || phase === "preview";
      for (const input of seriesHost.querySelectorAll("button")) input.disabled = input.dataset.mutation ? mutateBlocked() : blocked();
      for (const input of historyHost.querySelectorAll("button")) input.disabled = mutateBlocked();
      for (const input of settingsHost.querySelectorAll("button")) input.disabled = blocked();
      const confirm = outcome.querySelector('[data-command="confirm"]'), retry = outcome.querySelector('[data-command="retry"]'), refresh = outcome.querySelector('[data-command="refresh"]'), cancel = outcome.querySelector('[data-command="cancel"]');
      if (confirm) confirm.disabled = busy || externalBusy || externalLock || !ready();
      if (retry) retry.disabled = busy || externalBusy || externalLock || !ready();
      if (refresh) refresh.disabled = busy || externalBusy || !ready();
      if (cancel) cancel.disabled = busy || externalBusy;
      status.hidden = lock || !statusMessage;
    }
    function table(parent, title, columns, rows, rowBuilder, identifier) {
      const hint = el("p", "hyd-muted", "Таблица прокручивается по горизонтали, в том числе стрелками с клавиатуры.", identifier + "-hint");
      const wrap = el("div", "hyd-table-wrap", undefined, identifier); wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", title); wrap.setAttribute("aria-describedby", hint.id);
      const t = el("table"), caption = el("caption", "", title), head = el("thead"), hr = el("tr"), body = el("tbody");
      for (const label of columns) { const th = el("th", "", label); th.scope = "col"; hr.append(th); }
      head.append(hr); for (const row of rows) body.append(rowBuilder(row)); t.append(caption, head, body); wrap.append(t); parent.append(hint, wrap);
    }
    function chart(parent, value) {
      const items = value.items, box = el("div", "", undefined, "chart-block");
      box.append(el("h3", "", "Изменение уровня"));
      if (!items.length) { box.append(el("p", "", "За выбранный период измерений нет. Линия и нулевые значения не строятся.")); parent.append(box); return; }
      const ns = "http://www.w3.org/2000/svg", svg = doc.createElementNS(ns, "svg");
      svg.classList.add("hyd-chart"); svg.setAttribute("role", "img");
      const title = doc.createElementNS(ns, "title"), description = doc.createElementNS(ns, "desc");
      title.textContent = "Уровень воды в ряду"; description.textContent = "Значения, даты и источники измерений — в таблице под графиком.";
      svg.append(title, description);
      const minValue = Math.min(...items.map(r => r.level), value.post.lowThreshold), maxValue = Math.max(...items.map(r => r.level), value.post.highThreshold);
      const from = Date.parse(value.from), to = Date.parse(value.to), span = Math.max(to - from, 1000), range = Math.max(maxValue - minValue, 1);
      const shape = (tag, attributes, cls) => { const node = doc.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); if (cls) node.setAttribute("class", cls); svg.append(node); return node; };
      const axis = shape("line", {}, "hyd-axis"), thresholds = [value.post.lowThreshold, value.post.highThreshold].map(level => ({ level, node: shape("line", {}, "hyd-threshold") }));
      const line = items.length > 1 ? shape("polyline", {}, "hyd-series") : null, points = items.map(item => ({ item, node: shape("circle", { r: 3.5 }, "hyd-point") }));
      const resize = () => {
        if (!svg.isConnected || svg.clientWidth < 40 || svg.clientHeight < 40) return;
        const width = svg.clientWidth, height = svg.clientHeight, left = 16, right = width - 16, top = 20, bottom = height - 20;
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        const x = r => left + (Date.parse(r.measuredAt) - from) / span * (right - left), y = n => bottom - (n - minValue) / range * (bottom - top);
        const set = (node, attributes) => { for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); };
        set(axis, { x1: left, y1: bottom, x2: right, y2: bottom });
        for (const threshold of thresholds) set(threshold.node, { x1: left, x2: right, y1: y(threshold.level), y2: y(threshold.level) });
        if (line) line.setAttribute("points", items.map(r => x(r).toFixed(2) + "," + y(r.level).toFixed(2)).join(" "));
        for (const point of points) set(point.node, { cx: x(point.item), cy: y(point.item.level) });
      };
      box.append(svg, el("p", "hyd-muted", "Шкала: " + displayLevel(minValue) + " — " + displayLevel(maxValue) + ". Слева: " + displayTime(value.from) + ". Справа: " + displayTime(value.to) + "."));
      box.append(el("p", "hyd-muted", "Пунктир: пороги. Линия только соединяет известные измерения; значения между ними не вычисляются."));
      if (value.hasMore) box.append(el("p", "hyd-warning", "График показывает только загруженную часть периода. Загрузите продолжение, чтобы дополнить его."));
      parent.append(box);
      resize();
      if (typeof ResizeObserver === "function") { chartObserver = new ResizeObserver(resize); chartObserver.observe(svg); }
    }
    function renderData() {
      clearChartObserver();
      currentHost.replaceChildren(); seriesHost.replaceChildren(); historyHost.replaceChildren();
      currentHost.hidden = !selectedId; seriesHost.hidden = !selectedId; historyHost.hidden = true;
      if (!selectedId) return;
      currentHost.append(el("h3", "", "Текущее измерение"));
      if (!data) { currentHost.append(el("p", "", "Данные ещё не загружены. Текущее значение не определено.")); return; }
      if (readFailed) currentHost.append(el("p", "hyd-warning", "Показан ранее загруженный снимок. Обновление не выполнено."));
      if (data.current) {
        currentHost.append(el("p", "hyd-current-value", displayLevel(data.current.level), "current-value"));
        definition(currentHost, [["Измерено", displayTime(data.current.measuredAt)], ["Источник", displayObservationText(data.current.source)], ["Состояние данных", CONDITIONS[data.condition]]]);
        if (data.stale) currentHost.append(el("p", "hyd-warning", "Измерение устарело и может не отражать текущий уровень воды."));
        else if (["low", "high"].includes(data.condition)) currentHost.append(el("p", "hyd-warning", "Уровень воды вышел за установленный порог."));
      } else currentHost.append(el("p", "hyd-warning", "Измерений нет. Нормальный уровень не подтверждён."));
      definition(currentHost, [["Пороги", "Нижний: " + displayLevel(data.post.lowThreshold) + "; верхний: " + displayLevel(data.post.highThreshold)], ["Срок актуальности", String(data.post.staleAfterSeconds) + " секунд"], ["Условная отметка", "Условный ноль; не абсолютная отметка"], ["Снимок данных", displayTime(data.snapshotAt)]]);
      seriesHost.append(el("h3", "", "Ряд за выбранный период"), el("p", "", displayTime(data.from) + " — " + displayTime(data.to)), el("p", "hyd-muted", "Загружено измерений: " + data.items.length + (data.hasMore ? ". Есть продолжение." : ". Продолжения в ответе нет.")));
      if (pageCount > 1) seriesHost.append(el("p", "hyd-muted", "Данные могли измениться во время загрузки. Для обновления нажмите «Показать период»."));
      chart(seriesHost, data);
      if (data.items.length) table(seriesHost, "Измерения за период", operator ? ["Измерено, UTC", "Уровень, см", "Источник", "Публикация", "Действия"] : ["Измерено, UTC", "Уровень, см", "Источник"], data.items, row => {
        const tr = el("tr"); tr.append(el("td", "", displayTime(row.measuredAt)), el("td", "", displayLevel(row.level)), el("td", "", displayObservationText(row.source)));
        if (operator) {
          tr.append(el("td", "", row.published ? "Опубликовано" : "Не опубликовано"));
          const actions = el("td"), historyButton = button("История", "history-" + row.id, () => loadHistory(row.measuredAt)), correctButton = button("Исправить", "correct-" + row.id, () => openForm("correct", row));
          correctButton.dataset.mutation = "true"; correctButton.disabled = mutateBlocked(); actions.append(historyButton, correctButton); tr.append(actions);
        }
        return tr;
      }, "series-table");
      if (data.hasMore) seriesHost.append(button("Загрузить следующие измерения", "more", () => showPeriod(true)));
      renderHistory();
    }
    async function loadHistory(measuredAt, more = false) {
      if (!operator || blocked() || more && (!history?.hasMore || historyTime !== measuredAt)) return;
      const previous = history, cursor = more ? history.nextCursor : "";
      if (!more) { history = null; historyTime = measuredAt; renderHistory(); }
      await readTask(async (ticket, signal) => {
        const value = historyDTO(await request(apiPath("posts/" + id(selectedId) + "/history") + "?" + new URLSearchParams({ measuredAt, limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) }), { signal }), selectedId, measuredAt, cursor);
        if (ticket !== generation) return;
        if (more) { value.items = unique([...previous.items, ...value.items]); unique(value.items, "revision"); }
        history = value; historyTime = measuredAt; renderHistory(); note("История загружена.");
        if (!more || !value.hasMore) historyHost.querySelector("h3")?.focus();
      }, "Загружаем историю исправлений…");
    }
    function renderHistory() {
      historyHost.replaceChildren(); historyHost.hidden = !operator || !history;
      if (!history) return;
      const title = el("h3", "", "История измерения " + displayTime(historyTime)); title.tabIndex = -1; historyHost.append(title);
      historyHost.append(el("p", "hyd-muted", "Загружено редакций: " + history.items.length + (history.hasMore ? ". Доступно продолжение." : ". Продолжения на момент чтения нет.")));
      if (!history.items.length) historyHost.append(el("p", "", "Нет доступных редакций измерения."));
      for (const row of [...history.items].sort((a, b) => b.revision - a.revision)) {
        const item = el("article", "hyd-row"); item.append(el("h3", "", "Редакция " + row.revision));
        definition(item, [["Действие", row.revision > 1 ? "Измерение исправлено" : row.algorithmVersion ? "Создано генератором" : "Измерение добавлено"], ["Автор", authorLabel(row.authorId)], ["Уровень", displayLevel(row.level)], ["Источник", displayObservationText(row.source)], ["Основание", row.reason], ["Записано", displayTime(row.recordedAt)], ["Публикация", row.published ? "Опубликовано" : "Не опубликовано"]]);
        if (row.algorithmVersion) definition(item, [["Алгоритм", row.algorithmVersion], ["Начальное число генератора", String(row.seed)]]);
        const support = el("details"); support.append(el("summary", "", "Сведения для поддержки"), el("p", "hyd-muted", "Автор: " + row.authorId + ". Команда: " + row.commandId + ". Запись: " + row.id + ". Предыдущая запись: " + (row.previousId || "нет") + ".")); item.append(support); historyHost.append(item);
      }
      if (history.hasMore) historyHost.append(button("Загрузить предыдущие редакции", "history-more", () => loadHistory(historyTime, true)));
    }
    function authorLabel(authorId) { return authorId === context.accountId ? "Вы" : "Учётная запись " + authorId; }
    async function loadSettingsHistory(more = false) {
      if (!operator || blocked() || !selectedId || more && !settingsHistory?.hasMore) return;
      const previous = settingsHistory, cursor = more ? previous.nextCursor : "", target = selectedId, expectedScope = scope();
      if (!more) { settingsHistory = null; renderSettingsHistory(); }
      await readTask(async (ticket, signal) => {
        const value = settingsDTO(await request(apiPath("posts/" + id(target) + "/settings/history") + "?" + new URLSearchParams({ limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) }), { signal }), target, expectedScope, cursor);
        if (ticket !== generation || target !== selectedId) return;
        if (more) { value.items = unique([...previous.items, ...value.items]); unique(value.items, "revision"); }
        settingsHistory = value; renderSettingsHistory(); note("История настроек загружена.");
        if (!more || !value.hasMore) settingsHost.querySelector("h3")?.focus();
      }, "Загружаем историю настроек…");
    }
    function renderSettingsHistory() {
      settingsHost.replaceChildren(); settingsHost.hidden = !operator || !settingsHistory;
      if (!settingsHistory) return;
      const title = el("h3", "", "История настроек гидропоста"); title.tabIndex = -1; settingsHost.append(title);
      settingsHost.append(el("p", "hyd-muted", "Загружено редакций: " + settingsHistory.items.length + (settingsHistory.hasMore ? ". Доступно продолжение." : ". Продолжения на момент чтения нет.")));
      if (!settingsHistory.items.length) settingsHost.append(el("p", "", "Записей о настройке гидропоста нет."));
      const fields = [["name", "Название"], ["location", "Место наблюдения"], ["lowThreshold", "Нижний порог, см"], ["highThreshold", "Верхний порог, см"], ["staleAfterSeconds", "Срок актуальности, секунд"], ["published", "Публикация"]];
      const display = (value, name) => name === "published" ? value ? "Опубликован" : "Не опубликован" : String(value);
      for (const row of settingsHistory.items) {
        const item = el("article", "hyd-row"); item.append(el("h4", "", "Редакция " + row.revision));
        definition(item, [["Действие", row.operation === "create" ? "Гидропост создан" : "Настройки изменены"], ["Автор", authorLabel(row.authorId)], ["Записано", displayTime(row.recordedAt)], ["Основание", row.reason]]);
        const changes = fields.filter(([name]) => !row.before || row.before[name] !== row.after[name]);
        if (!changes.length) item.append(el("p", "", "Значения настроек не изменились; основание операции сохранено."));
        else definition(item, changes.map(([name, label]) => [label, row.before ? display(row.before[name], name) + " → " + display(row.after[name], name) : display(row.after[name], name)]));
        settingsHost.append(item);
      }
      if (settingsHistory.hasMore) settingsHost.append(button("Загрузить предыдущие настройки", "settings-history-more", () => loadSettingsHistory(true)));
    }
    function renderOperator() {
      commandHost.replaceChildren(); commandHost.hidden = !operator || !ready() || !reference;
      if (!operator || !ready() || !reference) return;
      const actions = el("div", "hyd-actions"), operations = [["create", LABELS.create]];
      if (data?.post) operations.push(["measure", LABELS.measure], ["configure", LABELS.configure], ["import", LABELS.import], ["generate", LABELS.generate]);
      for (const [operation, label] of operations) actions.append(button(label, "action-" + operation, () => openForm(operation), operation === "measure"));
      if (data?.post) actions.append(button("История настроек", "settings-history-load", () => loadSettingsHistory()));
      commandHost.append(el("h3", "", "Служебные операции"), actions);
      if (form) commandHost.append(form.node);
    }
    function openForm(operation, measurement = null) {
      if (mutateBlocked() || !reference || operation !== "create" && !data?.post) return;
      if (operation === "correct" && (!measurement || !data.items.some(r => r.id === measurement.id))) return;
      clearErrors(); retained = ""; intent = null; receipt = null; phase = "idle"; readFailed = false; retryRejected = false;
      const node = el("form", "hyd-grid", undefined, "operation-form"); node.noValidate = true;
      const title = el("h3", "hyd-full", LABELS[operation], "operation-heading"); title.tabIndex = -1; node.append(title);
      const p = data?.post, fields = {};
      const contextBlock = el("div", "hyd-full");
      definition(contextBlock, [["Участок", allowedAreas().find(r => r.id === areaId)?.name || ""], ["Гидропост", operation === "create" ? "Новый пост" : displayPostName(p.name) + ". " + p.riverName + ", " + displayObservationText(p.location)]]);
      node.append(contextBlock);
      if (["create", "configure"].includes(operation)) {
        fields.name = field(node, "Название гидропоста", "name", "text", "", 150); fields.name.value = operation === "configure" ? p.name : "";
        fields.location = field(node, "Место наблюдения", "location", "text", "", 250); fields.location.value = operation === "configure" ? p.location : "";
        if (operation === "create") { fields.river = field(node, "Река", "new-river", "select"); options(fields.river, reference.rivers.map(r => ({ id: r.code, name: r.name })), riverCode, "Выберите реку"); }
        fields.low = field(node, "Нижний порог, см", "low", "text", "От −10000 до 10000, не более одного дробного знака.");
        fields.high = field(node, "Верхний порог, см", "high", "text", "Должен быть выше нижнего порога.");
        fields.low.inputMode = "decimal"; fields.high.inputMode = "decimal";
        fields.stale = field(node, "Срок актуальности, секунд", "stale", "text", "От 300 до 604800 секунд."); fields.stale.inputMode = "numeric";
        if (operation === "configure") { fields.low.value = String(p.lowThreshold); fields.high.value = String(p.highThreshold); fields.stale.value = String(p.staleAfterSeconds); }
        else node.append(el("p", "hyd-muted hyd-full", "Единица: сантиметры. Условный ноль. Реку и единицу после создания изменить нельзя."));
      }
      if (["measure", "correct"].includes(operation)) {
        fields.measured = dateFields(node, "Измерено", "measured"); setDate(fields.measured, operation === "correct" ? measurement.measuredAt : nowUTC());
        if (operation === "correct") { fields.measured.date.readOnly = true; fields.measured.time.readOnly = true; }
        fields.level = field(node, "Уровень, см", "level", "text", "От −10000 до 10000, не более одного дробного знака."); fields.level.inputMode = "decimal";
        fields.source = field(node, "Источник измерения", "source", "text", "Название источника, до 120 символов.", 120);
        if (measurement) { fields.level.value = String(measurement.level); fields.source.value = measurement.source; }
      }
      if (operation === "generate") {
        fields.start = dateFields(node, "Первое измерение", "start");
        fields.seed = field(node, "Начальное число генератора", "seed", "text", "Целое число от 0 до 2147483646.");
        fields.count = field(node, "Количество измерений", "count", "text", "От 1 до 100.");
        fields.interval = field(node, "Шаг времени, секунд", "interval", "text", "От 300 до 86400. Последнее измерение не должно быть в будущем.");
        for (const name of ["seed", "count", "interval"]) fields[name].inputMode = "numeric";
        node.append(el("p", "hyd-notice hyd-full", "Генератор добавляет измерения, не заменяя существующие. Одинаковые параметры дают одинаковые значения."));
      }
      if (operation === "import") {
        fields.file = field(node, "Файл CSV (UTF-8 без BOM)", "file", "file"); fields.file.accept = ".csv,text/csv";
        fields.csv = field(node, "Содержимое CSV", "csv", "textarea", "Заголовок: measuredAt,level,source. До 100 строк, 12000 символов. UTC с Z, десятичная точка, без кавычек и запятых в источнике.", 12000);
        fields.csv.rows = 6;
        fields.file.addEventListener("change", async () => {
          if (mutateBlocked() || intent) return;
          const selected = fields.file.files?.[0], ticket = generation;
          if (!selected) return;
          try {
            if (selected.size > 16384) throw new Error("Файл слишком большой: выберите CSV до 16 КиБ.");
            const bytes = await selected.arrayBuffer(), value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            if (ticket !== generation || form?.node !== node || ownLock()) return;
            if (value.length > 12000) throw new Error("CSV содержит больше 12000 символов.");
            fields.csv.value = value; clearErrors();
          } catch (error) { if (ticket === generation) localError(Object.assign(new Error("Не удалось прочитать CSV. " + error.message), { field: fields.file })); }
        });
        node.append(el("p", "hyd-muted hyd-full", "При ошибке строки или повторе времени импорт не выполнится. Для замены измерения используйте «Исправить»."));
      }
      fields.published = field(node, "Публичная видимость", "published", "select");
      options(fields.published, [{ id: "no", name: "Не публиковать" }, { id: "yes", name: "Опубликовать данные" }], operation === "configure" ? p.published ? "yes" : "no" : measurement?.published ? "yes" : "no", "Выберите видимость");
      fields.reason = field(node, operation === "correct" ? "Причина исправления" : "Основание операции", "reason", "textarea", "Обязательно, до 500 символов.", 500); fields.reason.rows = 2;
      const preview = el("button", "hyd-primary", "Проверить данные", "preview"); preview.type = "submit";
      const buttons = el("div", "hyd-actions hyd-full"); buttons.append(preview, button("Закрыть форму", "close-form", () => { if (mutateBlocked()) return; form = null; intent = null; renderOperator(); renderOutcome(); heading.focus(); }));
      node.append(buttons);
      form = { operation, fields, measurement, node };
      node.addEventListener("submit", event => { event.preventDefault(); if (!mutateBlocked()) prepare(); });
      renderOperator(); renderOutcome(); update(); title.focus();
    }
    function prepare() {
      clearErrors();
      try {
        const { operation, fields: f, measurement } = form, p = data?.post;
        const b = { ...scope() }, times = [], pairs = [];
        if (["create", "configure"].includes(operation)) {
          b.name = required(f.name, 150); b.location = required(f.location, 250);
          if (operation === "create") {
            if (!Object.hasOwn(RIVERS, f.river.value)) throw Object.assign(new Error("Выберите реку."), { field: f.river });
            b.riverCode = f.river.value;
          } else b.expectedRevision = p.revision;
          b.lowThreshold = checked(f.low, () => enteredLevel(f.low.value.trim()));
          b.highThreshold = checked(f.high, () => enteredLevel(f.high.value.trim()));
          if (b.lowThreshold >= b.highThreshold) throw Object.assign(new Error("Верхний порог должен быть выше нижнего."), { field: f.high });
          b.staleAfterSeconds = checked(f.stale, () => enteredInteger(f.stale.value.trim(), 300, 604800));
          pairs.push(["Название", b.name], ["Место", b.location], ["Река", RIVERS[b.riverCode || p.riverCode]], ["Пороги", displayLevel(b.lowThreshold) + " / " + displayLevel(b.highThreshold)], ["Актуальность", b.staleAfterSeconds + " секунд"]);
        }
        if (["measure", "correct"].includes(operation)) {
          b.measuredAt = inputDate(f.measured); b.level = checked(f.level, () => enteredLevel(f.level.value.trim())); b.source = required(f.source, 120);
          if (operation === "correct") { if (b.measuredAt !== measurement.measuredAt) throw invalid(); b.expectedRevision = measurement.revision; }
          times.push(b.measuredAt); pairs.push(["Измерено", displayTime(b.measuredAt)], ["Уровень", displayLevel(b.level)], ["Источник", b.source]);
        }
        if (operation === "generate") {
          b.startAt = inputDate(f.start); b.seed = checked(f.seed, () => enteredInteger(f.seed.value.trim(), 0, 2147483646));
          b.count = checked(f.count, () => enteredInteger(f.count.value.trim(), 1, 100)); b.intervalSeconds = checked(f.interval, () => enteredInteger(f.interval.value.trim(), 300, 86400));
          for (let i = 0; i < b.count; i++) times.push(new Date(Date.parse(b.startAt) + i * b.intervalSeconds * 1000).toISOString().slice(0, 19) + "Z");
          pairs.push(["Начало", displayTime(b.startAt)], ["Последнее измерение", displayTime(times.at(-1))], ["Число измерений", String(b.count)], ["Шаг", b.intervalSeconds + " секунд"], ["Seed", String(b.seed)], ["Алгоритм", "hydrology-lcg-v1"]);
        }
        if (operation === "import") {
          b.csv = f.csv.value;
          const rows = checked(f.csv, () => parseCSV(b.csv)); times.push(...rows.map(r => r.measuredAt));
          pairs.push(["Число строк", String(rows.length)], ["Первое время в наборе", displayTime([...times].sort()[0])], ["Последнее время в наборе", displayTime([...times].sort().at(-1))]);
        }
        if (times.some(time => time > nowUTC())) throw Object.assign(new Error("Измерения в будущем не допускаются. Проверьте время в UTC."), { field: f.csv || f.start?.date || f.measured?.date });
        if (!["yes", "no"].includes(f.published.value)) throw Object.assign(new Error("Выберите публичную видимость."), { field: f.published });
        b.published = f.published.value === "yes"; b.reason = required(f.reason, 500);
        if (new TextEncoder().encode(JSON.stringify(b)).length > 16384) throw Object.assign(new Error("JSON запроса превышает 16 КиБ. Уменьшите CSV или длину источников."), { field: f.csv || f.reason });
        pairs.push(["Публикация", b.published ? "Опубликовать данные" : "Не публиковать"], ["Основание", b.reason]);
        const routes = { configure: "configuration", measure: "measurements", correct: "corrections", import: "import", generate: "generate" };
        intent = freeze({ operation, key: crypto.randomUUID(), body: b, postId: operation === "create" ? "" : p.id, path: apiPath(operation === "create" ? "posts" : "posts/" + p.id + "/" + routes[operation]), contextKey: JSON.stringify(context), areaId, times, pairs });
        phase = "preview"; receipt = null; retryRejected = false; renderOutcome(); update(); outcome.querySelector("h3")?.focus();
      } catch (error) { localError(error); }
    }
    function renderOutcome() {
      outcome.replaceChildren(); outcome.hidden = !intent && !retained;
      if (retained && !intent) { outcome.append(el("p", "hyd-warning", retained)); return; }
      if (!intent) return;
      const headingText = { preview: "Проверьте команду перед отправкой", sending: "Ожидается подтверждение", unknown: "Исход команды неизвестен", confirmed: "Команда подтверждена" }[phase];
      const title = el("h3", "", headingText, "outcome-heading"); title.tabIndex = -1; outcome.append(title);
      if (phase === "preview") {
        definition(outcome, [["Операция", LABELS[intent.operation]], ["Гидропост", intent.operation === "create" ? intent.body.name : selectedPost()?.name || ""], ...intent.pairs]);
        outcome.append(el("p", "hyd-muted", intent.operation === "correct" ? "Будет создана новая редакция. Предыдущая запись сохранится в журнале." : intent.operation === "configure" ? "Сохранить новые настройки." : "Сохранить измерения."));
        const confirm = button("Отправить", "confirm", () => send(), true); confirm.dataset.command = "confirm";
        const cancel = button("Изменить ввод", "cancel", () => { intent = null; phase = "idle"; renderOutcome(); update(); form?.node.querySelector("input,textarea,select")?.focus(); }); cancel.dataset.command = "cancel";
        const actions = el("div", "hyd-actions"); actions.append(confirm, cancel); outcome.append(actions);
      } else if (phase === "sending") {
        outcome.append(el("p", "", "Команда отправляется. Не создавайте новую операцию вместо неё."));
      } else if (phase === "unknown") {
        outcome.append(el("p", "hyd-warning", "Результат отправки неизвестен. Повторите ту же операцию кнопкой ниже. Не закрывайте страницу: данные для повтора хранятся только здесь."));
        if (retryRejected) outcome.append(el("p", "", "Повтор отклонён. Результат первой отправки всё ещё неизвестен."));
        const retry = button("Повторить ту же команду", "retry", () => send(), true); retry.dataset.command = "retry"; outcome.append(retry);
      } else if (phase === "confirmed") {
        definition(outcome, [["Операция", LABELS[intent.operation]], ["Подтверждено", displayTime(receipt.committedAt)], ["Измерений в команде", String(receipt.measurementCount)]]);
        if (intent.operation === "generate") definition(outcome, [["Seed", String(receipt.seed)], ["Алгоритм", receipt.algorithmVersion]]);
        if (readFailed) {
          outcome.append(el("p", "hyd-warning", "Запись подтверждена, но текущие данные пока не удалось перечитать. Повторная запись не нужна."));
          const refresh = button("Обновить данные", "refresh", () => refreshConfirmed(), true); refresh.dataset.command = "refresh"; outcome.append(refresh);
        } else outcome.append(el("p", "", "Данные обновлены. Последующие изменения смотрите в таблице и журнале."));
      }
      if (phase !== "preview") {
        const details = el("details"); details.append(el("summary", "", "Параметры отправленной команды")); definition(details, intent.pairs); outcome.append(details);
      }
    }
    async function refreshData(signal, target, expectedPeriod, expectedScope) {
      const next = await fetchSeries(signal, target, "", expectedPeriod, expectedScope);
      if (signal.aborted) throw new DOMException("Context changed", "AbortError");
      const nextRiver = riverCode && riverCode !== next.post.riverCode ? next.post.riverCode : riverCode;
      const nextPosts = await fetchPosts(signal, expectedScope, nextRiver);
      return { posts: nextPosts, data: next, target, period: expectedPeriod, riverCode: nextRiver };
    }
    function applyRefresh(next) {
      posts = next.posts; data = next.data; selectedId = next.target; queryPeriod = next.period; riverCode = next.riverCode;
      history = null; historyTime = ""; settingsHistory = null; pageCount = 1; readFailed = false;
    }
    async function send() {
      if (!intent || !["preview", "unknown"].includes(phase) || busy || externalBusy || externalLock || !ready()) return;
      if (intent.contextKey !== JSON.stringify(context) || intent.areaId !== areaId) { reset(); return; }
      const frozen = intent, previousUnknown = phase === "unknown", ticket = generation; controller = new AbortController(); busy = true; phase = "sending"; retryRejected = false; setGlobalBusy(true); renderOutcome(); update();
      try {
        const received = receiptDTO(await request(frozen.path, { method: "POST", body: frozen.body, headers: { "Idempotency-Key": frozen.key }, signal: controller.signal }), frozen);
        if (ticket !== generation || frozen !== intent) return;
        receipt = received; phase = "confirmed"; readFailed = true; renderOutcome(); update();
        try {
          const next = await refreshData(controller.signal, received.postId, queryPeriod || periodValue(), scope());
          if (ticket !== generation || frozen !== intent) return;
          applyRefresh(next); form = null; render(); note("Данные перечитаны после подтверждённой команды.");
        } catch (error) {
          if (ticket !== generation) return;
          if (accessLost(error)) lose(error);
          else { readFailed = true; renderData(); renderOutcome(); note("Результат записи подтверждён; чтение текущих данных не завершено.", true, error); }
        }
      } catch (error) {
        if (ticket !== generation || frozen !== intent) return;
        if (accessLost(error)) lose(error);
        else if (previousUnknown || unknownWrite(error)) {
          phase = "unknown"; retryRejected = previousUnknown && !unknownWrite(error); renderOutcome(); note(errorLabel(error), true, error);
        } else {
          intent = null; phase = "idle"; receipt = null; renderOutcome(); note(errorLabel(error), true, error);
        }
      } finally { if (ticket === generation) { busy = false; controller = null; setGlobalBusy(false); update(); } }
    }
    async function refreshConfirmed() {
      if (phase !== "confirmed" || !receipt || busy || externalBusy || !ready()) return;
      const ticket = generation; controller = new AbortController(); busy = true; setGlobalBusy(true); update();
      try {
        const next = await refreshData(controller.signal, receipt.postId, queryPeriod || periodValue(), scope());
        if (ticket !== generation) return;
        applyRefresh(next); form = null; render(); note("Текущие данные обновлены. Повторная запись не выполнялась.");
      } catch (error) {
        if (ticket !== generation) return;
        if (accessLost(error)) lose(error);
        else { readFailed = true; renderData(); renderOutcome(); note("Текущие данные пока не удалось обновить. Запись подтверждена.", true, error); }
      } finally { if (ticket === generation) { busy = false; controller = null; setGlobalBusy(false); update(); } }
    }
    render(); note(operator ? "Выберите доступный участок и загрузите гидропосты." : "Загрузите справочник гидропостов.");
    return Object.freeze({ load, syncContext, reset, setExternalBusy, setExternalMutationLock, destroy() { reset(); root.replaceChildren(); } });
  }
  globalThis.VodokanalHydrology = Object.freeze({
    create: options => createView({ ...options, operator: true }),
    createPublic: options => createView({ ...options, operator: false })
  });
})();
