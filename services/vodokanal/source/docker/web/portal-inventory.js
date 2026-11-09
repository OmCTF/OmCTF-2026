
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX = 999999999999;
  const AGGREGATE_MAX = 999999999999999;
  const OPERATIONS = Object.freeze({ Receipt: "Приход", Transfer: "Перемещение", Reserve: "Резервирование", Issue: "Выдача по наряду", Return: "Возврат на склад", Release: "Освобождение резерва", Consume: "Подтверждённый расход", Reversal: "Обратное движение" });
  const ACTIONS = Object.freeze({ Receipt: "Провести приход", Transfer: "Переместить материал", Reserve: "Зарезервировать всё запрошенное количество", Issue: "Выдать материал", Return: "Принять возврат", Release: "Освободить остаток резерва", Reversal: "Провести обратное движение" });
  function invalid() { const e = new Error("Некорректный ответ склада"); e.code = "некорректно_ответ"; e.status = 200; return e; }
  function object(v) { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v; }
  function text(v, max = 2000) { if (typeof v !== "string" || v.length > max) throw invalid(); return v; }
  function id(v) { if (!UUID.test(text(v, 36))) throw invalid(); return v; }
  function optionalId(v) { return v === "" ? "" : id(v); }
  function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(v) || v < min || v > max) throw invalid(); return v; }
  function array(v, max = 100) { if (!Array.isArray(v) || v.length > max) throw invalid(); return v; }
  function unique(rows) { if (new Set(rows.map(row => row.id)).size !== rows.length) throw invalid(); return rows; }
  function pick(v, keys) { object(v); return Object.fromEntries(keys.split(",").map(key => [key, v[key]])); }
  function freeze(v) { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
  function milliInput(v, precision = 3, positive = true) {
    if (typeof v !== "string" || !/^(?:0|[1-9][0-9]{0,8})(?:[.,][0-9]{1,3})?$/.test(v)) throw new Error("Введите число до 999999999,999: запятая или точка, не более трёх дробных знаков, без пробелов и разделителей тысяч.");
    const [whole, fraction = ""] = v.replace(",", ".").split(".");
    const n = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
    if (!Number.isSafeInteger(n) || n > MAX || n < (positive ? 1 : 0)) throw new Error(positive ? "Количество должно быть больше нуля." : "Количество не может быть отрицательным.");
    if (n % (10 ** (3 - precision)) !== 0) throw new Error("Для этой единицы допустимо значащих дробных знаков: " + precision + ". Округление не выполняется.");
    return n;
  }
  function milli(v, positive = false, aggregate = false) {
    if (typeof v !== "number" || !Number.isFinite(v) || Object.is(v, -0)) throw invalid();
    if (aggregate) {
      const wire = String(v); if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,3})?$/.test(wire)) throw invalid();
      const [whole, fraction = ""] = wire.split("."), n = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
      if (!Number.isSafeInteger(n) || n > AGGREGATE_MAX || n < (positive ? 1 : 0)) throw invalid(); return n;
    }
    try { return milliInput(String(v), 3, positive); } catch (_) { throw invalid(); }
  }
  function numberFromMilli(n) { integer(n, 0, MAX); return Number((Math.floor(n / 1000) + "." + String(n % 1000).padStart(3, "0"))); }
  function quantity(v) { const n = milli(v, false, true); return String(Math.floor(n / 1000)) + (n % 1000 ? "," + String(n % 1000).padStart(3, "0").replace(/0+$/, "") : ""); }
  function utc(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(v)) throw invalid();
    const wire = v.endsWith("Z") ? v : v + "Z", time = Date.parse(wire);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) + "Z" !== wire) throw invalid();
    return wire;
  }
  function dateLabel(v) { return utc(v).slice(0, 19).replace("T", " ") + " UTC"; }
  function inputDate(day, time) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(day) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new Error("Введите дату ДД.ММ.ГГГГ и время ЧЧ:ММ:СС в UTC.");
    const [d, m, y] = day.split(".");
    try { return utc(`${y}-${m}-${d}T${time}Z`); } catch (_) { throw new Error("Проверьте календарную дату и время UTC."); }
  }
  function uncertain(error) { return !error?.status || error.status >= 500 || error.code === "некорректно_ответ" || ["таймаут_ошибка", "сеть_ошибка"].includes(error.code); }
  function nativeSessionLost(error) { return [400, 404].includes(error?.status) && error?.code === "хттп_ошибка"; }
  function accessLost(error) { return [401, 403, 404].includes(error?.status) || nativeSessionLost(error); }
  function scoped(v, scope) { object(v); if (id(v.workspaceId) !== scope.workspaceId || id(v.areaId) !== scope.areaId) throw invalid(); return v; }
  function listDTO(v, transform) {
    object(v); const limit = integer(v.limit, 1, 100); if (typeof v.hasMore !== "boolean") throw invalid();
    const items = array(v.items, limit).map(transform), nextCursor = text(v.nextCursor, 400);
    if ((v.hasMore && (items.length !== limit || !nextCursor)) || (!v.hasMore && nextCursor)) throw invalid();
    return { items, limit, hasMore: v.hasMore, nextCursor, snapshotAt: utc(v.snapshotAt) };
  }
  function setupRow(v, kind, scope) {
    scoped(v, scope); const row = pick(v, "id,name,workspaceId,areaId,state,revision"); id(row.id); text(row.name, 150); if (!row.name) throw invalid(); text(row.state, 32); integer(row.revision, 1);
    if (kind === "Unit") row.precision = integer(v.precision, 0, 3);
    if (kind === "Material") { row.unitId = id(v.unitId); row.unitName = text(v.unitName, 150); }
    if (kind === "Cell") row.warehouseId = id(v.warehouseId);
    return row;
  }
  function settingsDTO(v, scope) {
    object(v); if (v.limit !== 100 || typeof v.hasMore !== "boolean") throw invalid();
    const out = { limit: 100, hasMore: v.hasMore, snapshotAt: utc(v.snapshotAt) };
    for (const [name, kind] of [["units", "Unit"], ["materials", "Material"], ["warehouses", "Warehouse"], ["cells", "Cell"]]) out[name] = unique(array(v[name]).map(row => ({ ...setupRow(row, kind, scope), createdBy: id(row.createdBy) })));
    if (out.materials.some(row => !out.units.some(unit => unit.id === row.unitId && unit.name === row.unitName)) || out.cells.some(row => !out.warehouses.some(warehouse => warehouse.id === row.warehouseId))) throw invalid();
    return out;
  }
  function requestDTO(v, scope) {
    scoped(v, scope); const row = pick(v, "id,workspaceId,areaId,workOrderId,workOrderName,state,materialId,materialName,unitId,unitName,warehouseId,warehouseName,cellId,cellName,requestedQuantity,reservedTotal,issuedTotal,returnedTotal,releasedTotal,reservedRemaining,outstandingQuantity,revision,lastMovementId");
    for (const key of ["id", "workOrderId", "materialId", "unitId", "warehouseId", "cellId"]) id(row[key]); optionalId(row.lastMovementId);
    for (const key of ["workOrderName", "materialName", "unitName", "warehouseName", "cellName"]) text(row[key], 150);
    if (!["Requested", "Open", "Closed"].includes(row.state)) throw invalid(); integer(row.revision, 1);
    const [q, r, i, t, l, left, outstanding] = ["requestedQuantity", "reservedTotal", "issuedTotal", "returnedTotal", "releasedTotal", "reservedRemaining", "outstandingQuantity"].map(key => milli(row[key]));
    if (!q || (r !== 0 && r !== q) || i + l > r || t > i || left !== r - i - l || outstanding !== i - t) throw invalid();
    row.consumedTotal = v.consumedTotal; row.returnableQuantity = v.returnableQuantity;
    const consumed = milli(row.consumedTotal), returnable = milli(row.returnableQuantity);
    if (t + consumed > i || returnable !== i - t - consumed) throw invalid();
    return row;
  }
  function movementDTO(v, scope, current = true) {
    scoped(v, scope); const row = pick(v, "id,workspaceId,areaId,number,state,revision,operation,materialId,materialName,unitId,unitName,warehouseId,cellId,targetWarehouseId,targetCellId,materialRequestId,workOrderId,quantity,basis,reason,occurredAt,postedAt,authorAccountId,originalMovementId,previousMovementId,reversalMovementId");
    if (!current && row.reversalMovementId === undefined) row.reversalMovementId = "";
    for (const key of ["id", "materialId", "unitId", "warehouseId", "cellId", "authorAccountId"]) id(row[key]);
    for (const key of ["targetWarehouseId", "targetCellId", "materialRequestId", "workOrderId", "originalMovementId", "previousMovementId", "reversalMovementId"]) optionalId(row[key]);
    for (const key of ["number", "materialName", "unitName"]) text(row[key], 150);
    text(row.basis, 2000); text(row.reason, 500); if (!row.basis || row.state !== "Posted" || row.revision !== 1 || !OPERATIONS[row.operation]) throw invalid();
    milli(row.quantity, true); utc(row.occurredAt); utc(row.postedAt);
    if (!!row.materialRequestId !== !!row.workOrderId || (row.operation === "Reversal") !== !!row.originalMovementId) throw invalid();
    if (row.operation === "Transfer" && (!row.targetWarehouseId || !row.targetCellId)) throw invalid();
    if (["Reserve", "Issue", "Return", "Release", "Consume"].includes(row.operation) && !row.materialRequestId) throw invalid();
    if (["Receipt", "Transfer"].includes(row.operation) && row.materialRequestId) throw invalid();
    return row;
  }
  function errorText(error) {
    const messages = {
      некорректно_ответ: "Не удалось проверить ответ сервера. Показанные ранее сведения могут быть устаревшими.",
      таймаут_ошибка: "Сервер не ответил вовремя.", сеть_ошибка: "Ответ сервера не получен.",
      кабинет_склад_недостаточно_доступно: "Доступного количества недостаточно. Обновите остатки.",
      кабинет_склад_остатки_конфликт: "Операция нарушит доступный остаток или резерв. Обновите остатки и проверьте количество.",
      кабинет_склад_количество_конфликт: "Количество не соответствует текущему резерву или невозвращённой выдаче. Обновите заявку и проверьте количество.",
      кабинет_склад_редакция_конфликт: "Заявка на материал уже изменилась. Обновите её перед новой командой.",
      кабинет_склад_сторно_заказ: "Сначала отмените более позднее действующее движение этой заявки."
    };
    if (messages[error?.code]) return messages[error.code];
    if (error?.status === 401 || nativeSessionLost(error)) return "Сеанс завершён. Войдите снова.";
    if (error?.status === 403) return "Нет доступа к складскому учёту выбранного участка.";
    if (error?.status === 404) return "Запись недоступна. Выберите участок и обновите список.";
    if (error?.status === 409) return "Состояние учёта изменилось. Обновите данные перед новой командой.";
    if (error?.status === 400 || error?.status === 422) return "Сервер отклонил данные операции. Проверьте поля и основание.";
    return "Не удалось выполнить запрос.";
  }
  function create({ root, request, setGlobalBusy = () => {}, onSessionError = () => false, onMutationLock = () => {} }) {
    let externalMutationLock = false, lastMutationLock = false;
    if (!root || typeof request !== "function") throw new Error("Нужны корневой элемент склада и обработчик запроса");
    const doc = root.ownerDocument;
    const el = (tag, cls, content, elementId) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (content !== undefined) n.textContent = content; if (elementId) n.id = elementId; return n; };
    let context = emptyContext(), generation = 0, running = false, externalBusy = false, task = null, busyEpoch = 0;
    let state = emptyState(), command = null, retainedNotice = "";
    const controllers = new Set();
    const shell = el("div", "inv-content"), heading = el("h2", "", "Склад ремонтных материалов", "inventory-heading");
    heading.tabIndex = -1;
    const warning = el("p", "inv-notice", "Учёт остатков, поступлений и выдачи материалов.");
    const status = el("p", "inv-status", "Выберите участок, затем загрузите складские справочники.", "inventory-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const diagnostics = el("div", "", undefined, "inventory-diagnostics"), result = el("div", "", undefined, "inventory-result"); result.setAttribute("aria-live", "polite");
    const scopeHost = el("div", "inv-fields"), area = field(scopeHost, "Участок", "inventory-area", "select"), load = button("Загрузить участок", "inventory-load", () => loadSetup(), true);
    scopeHost.append(load);
    const tabs = el("div", "inv-tabs"), warehouseTab = button("Склад", "inventory-tab-warehouse", () => switchView("warehouse")), orderTab = button("Материалы наряда", "inventory-tab-orders", () => switchView("orders"));
    tabs.setAttribute("aria-label", "Разделы складского учёта"); tabs.append(warehouseTab, orderTab);
    const warehouseHost = el("section", "", undefined, "inventory-warehouse-view"), orderHost = el("section", "", undefined, "inventory-orders-view");
    shell.append(heading, warning, scopeHost, status, diagnostics, result, tabs, warehouseHost, orderHost); root.replaceChildren(shell);
    area.addEventListener("change", () => { if (blocked()) return; const selected = area.value; resetData(true); state.areaId = areas().some(row => row.id === selected) ? selected : ""; render(); note("Участок изменён. Загрузите справочники заново."); });
    function emptyContext() { return { accountId: "", actorId: "", workspaceId: "", areas: [], storekeeperAreaIds: [] }; }
    function emptyState() { return { view: "warehouse", areaId: "", settings: null, stock: null, orders: null, requests: null, selectedRequest: null, movements: null, warehouseId: "", cellId: "", workOrderId: "", selectedMovement: null, stale: false }; }
    function field(parent, label, elementId, type = "text", max = 0) { const wrap = el("div", "inv-field"), caption = el("label", "", label), input = el(["select", "textarea"].includes(type) ? type : "input", "", undefined, elementId); caption.htmlFor = elementId; if (!["select", "textarea"].includes(type)) input.type = type; if (max) input.maxLength = max; wrap.append(caption, input); parent.append(wrap); return input; }
    function button(label, elementId, handler, primary = false) { const n = el("button", primary ? "inv-primary" : "", label, elementId); n.type = "button"; n.addEventListener("click", async () => { if (n.disabled) return; try { await handler(); } catch (error) { note(errorText(error), true, error); } }); return n; }
    function options(select, rows, blank = "Выберите запись") { select.replaceChildren(); const first = el("option", "", blank); first.value = ""; select.append(first); for (const row of rows) { const option = el("option", "", row.name); option.value = row.id; select.append(option); } }
    function areas() { return context.areas.filter(row => row.state === "Active" && context.storekeeperAreaIds.includes(row.id)); }
    function ready() { return !!(context.accountId && context.actorId && context.workspaceId && areas().some(row => row.id === state.areaId)); }
    function blocked() { return running || externalBusy || externalMutationLock || !!command && (["sending", "unknown"].includes(command.phase) || command.phase === "confirmed" && command.refreshFailed); }
    function fresh(ticket) { return ticket === generation; }
    function note(message, failed = false, error = null) {
      status.textContent = message; status.className = failed ? "inv-status inv-error" : "inv-status"; diagnostics.replaceChildren();
      if (error) { const details = el("details", "inv-meta"); details.append(el("summary", "", "Сведения для поддержки")); for (const [key, title] of [["code", "Код ошибки"], ["requestId", "Код запроса"]]) if (/^[a-zA-ZА-Яа-яЁё0-9_-]{1,160}$/.test(error[key] || "")) details.append(el("p", "", title + ": " + error[key])); if (details.childNodes.length > 1) diagnostics.append(details); }
    }
    function abort() { for (const controller of controllers) controller.abort(); controllers.clear(); if (task && task.busyEpoch === busyEpoch) setGlobalBusy(false); task = null; running = false; }
    function resetData(keepArea = false) { generation += 1; abort(); const selected = state.areaId, view = state.view; state = emptyState(); if (keepArea) { state.areaId = selected; state.view = view; } command = null; retainedNotice = ""; }
    function clearedOutcomeNotice() {
      if (command && ["sending", "unknown"].includes(command.phase)) return "Участок изменён. Результат отправки неизвестен. Проверьте учёт перед новой операцией.";
      if (command?.phase === "confirmed") return "Изменение сохранено. Выберите участок и обновите данные.";
      return retainedNotice;
    }
    function reset() { const outcomeNotice = clearedOutcomeNotice(); resetData(); retainedNotice = outcomeNotice; context = emptyContext(); render(); note("Войдите, чтобы открыть складской учёт."); }
    function syncContext(value) {
      const next = { accountId: value?.accountId || "", actorId: value?.actorId || "", workspaceId: value?.workspaceId || "", areas: [], storekeeperAreaIds: [] };
      try {
        if (next.accountId) id(next.accountId); if (next.actorId) id(next.actorId); if (next.workspaceId) id(next.workspaceId);
        next.areas = unique(array(value?.areas || []).map(row => ({ id: id(row.id), name: text(row.name, 150), state: text(row.state, 32) })));
        next.storekeeperAreaIds = array(value?.storekeeperAreaIds || []).map(id);
        if (next.storekeeperAreaIds.some(key => !next.areas.some(row => row.id === key && row.state === "Active"))) throw invalid();
      } catch (_) { reset(); note("Не удалось проверить доступные участки. Обновите кабинет.", true); return; }
      if (JSON.stringify(context) !== JSON.stringify(next)) {
        const outcomeNotice = clearedOutcomeNotice();
        resetData(); context = next; retainedNotice = outcomeNotice;
        state.areaId = areas()[0]?.id || ""; render(); note(areas().length ? "Выберите участок и загрузите справочники." : "Нет действующего доступа кладовщика к участкам.");
      } else updateBusy();
    }
    function setExternalBusy(value) { busyEpoch += 1; externalBusy = !!value; updateBusy(); }
    function setExternalMutationLock(value) { externalMutationLock = !!value; updateBusy(); }
    function updateBusy() {
      const ownedLock = !!command && (["sending", "unknown"].includes(command.phase) || command.phase === "confirmed" && !!command.refreshFailed);
      if (ownedLock !== lastMutationLock) { lastMutationLock = ownedLock; onMutationLock(ownedLock); }
      shell.setAttribute("aria-busy", String(running)); area.disabled = blocked() || !areas().length; load.disabled = blocked() || !ready();
      warehouseTab.disabled = blocked() || !state.settings; orderTab.disabled = blocked() || !state.settings;
      for (const control of [...warehouseHost.querySelectorAll("input,select,textarea,button"), ...orderHost.querySelectorAll("input,select,textarea,button")]) control.disabled = blocked() || !ready() || control.dataset.unavailable === "true" || (state.stale && !!control.closest("form[data-inventory-mutation]"));
      const retry = result.querySelector("#inventory-retry"); if (retry) retry.disabled = running || externalBusy || !ready();
      const refresh = result.querySelector("#inventory-refresh-confirmed"); if (refresh) refresh.disabled = running || externalBusy || !ready();
    }
    async function run(fn) {
      if (running || externalBusy || externalMutationLock || !ready()) return;
      const ticket = generation, controller = new AbortController(), current = {}; task = current; running = true; controllers.add(controller); setGlobalBusy(true); current.busyEpoch = busyEpoch; updateBusy();
      try { await fn(ticket, controller.signal); } catch (error) { if (fresh(ticket)) handleReadError(error); }
      finally { controllers.delete(controller); if (task === current) { task = null; running = false; if (current.busyEpoch === busyEpoch) setGlobalBusy(false); updateBusy(); } }
    }
    function handleReadError(error) {
      const wasConfirmed = command?.phase === "confirmed", wasUnknown = command && ["sending", "unknown"].includes(command.phase);
      if (accessLost(error)) {
        resetData(); retainedNotice = wasConfirmed ? "Изменение сохранено, но данные не обновились. Выберите участок и обновите список." : wasUnknown ? "Доступ прекращён. Исход ранее отправленной операции не подтверждён." : "";
        render(); if (onSessionError(error, retainedNotice)) return;
      } else { state.stale = true; updateBusy(); }
      note(errorText(error) + (!accessLost(error) ? " Данные могут быть устаревшими. Повторите чтение перед новой операцией." : ""), true, error);
    }
    function switchView(view) { if (blocked() || !state.settings) return; state.view = view; state.movements = null; state.selectedMovement = null; render(); (view === "warehouse" ? warehouseHost : orderHost).querySelector("h3")?.focus(); }
    function renderCommand() {
      result.replaceChildren();
      if (retainedNotice) result.append(el("p", "inv-notice", retainedNotice));
      if (!command) return;
      const unknown = command.phase === "unknown", sending = command.phase === "sending", message = sending ? "Ожидается ответ о проведении операции. Повторная отправка недоступна." : unknown ? "Результат отправки неизвестен. Повторите ту же операцию кнопкой ниже, не создавая новую." : command.refreshFailed ? "Изменение сохранено, но данные не обновились. Обновите список без повторной отправки." : "Изменение сохранено. Данные обновлены.";
      const preview = command.previewId && doc.getElementById(command.previewId);
      if (preview) {
        const title = preview.querySelector("h4"); if (title) title.textContent = unknown ? "Исход операции неизвестен" : sending ? "Данные отправлены, ожидается ответ" : "Изменение сохранено";
        for (const term of preview.querySelectorAll("dt")) if (["Эффект", "Запрошенный эффект", "Подтверждение"].includes(term.textContent)) {
          term.textContent = unknown || sending ? "Запрошенный эффект" : "Подтверждение";
          term.nextElementSibling.textContent = unknown ? "Результат отправки неизвестен. Показаны отправленные данные, а не текущие остатки." : sending ? "Команда отправлена. Подтверждение её результата ещё не получено." : "Изменение сохранено. Обновите остатки и заявку.";
        }
      }
      result.append(el("p", "inv-result" + (!sending && !unknown ? " inv-result-confirmed" : " inv-notice"), message, "inventory-command-status"));
      if (unknown) result.append(button("Повторить ту же операцию", "inventory-retry", () => execute(command)), el("p", "inv-muted", "Повтор использует прежние данные и ключ. Закрытие страницы не отменяет возможную запись."));
      if (command.phase === "confirmed" && command.refreshFailed) result.append(button("Обновить данные без новой записи", "inventory-refresh-confirmed", () => refreshConfirmed()));
    }
    function render() {
      options(area, areas(), "Нет выбранного участка"); area.value = state.areaId;
      warehouseTab.setAttribute("aria-pressed", String(state.view === "warehouse")); orderTab.setAttribute("aria-pressed", String(state.view === "orders"));
      warehouseHost.hidden = state.view !== "warehouse"; orderHost.hidden = state.view !== "orders";
      if (state.view === "warehouse") { orderHost.replaceChildren(); renderWarehouse(); } else { warehouseHost.replaceChildren(); renderOrders(); }
      renderCommand(); updateBusy();
    }
    function listNote(host, list, noun) {
      host.append(el("p", "inv-meta", `${noun}: загружено ${list.items.length}, страница ${list.limit}. Снимок: ${dateLabel(list.snapshotAt)}.`));
      if (list.hasMore) { const name = ["stock", "orders", "requests", "movements"].find(key => state[key] === list); if (name) host.append(button("Показать ещё", "inventory-next-" + name, () => loadMore(name))); }
    }
    async function loadMore(name) {
      const previous = state[name]; if (!previous?.hasMore || !previous.nextCursor) return;
      await run(async (ticket, signal) => {
        let value;
        if (name === "stock") value = await readStock(signal, previous.nextCursor);
        else if (name === "requests") value = await readRequests(signal, state.workOrderId, previous.nextCursor);
        else if (name === "movements") value = await readMovements(signal, state.view === "orders" ? state.workOrderId : "", previous.nextCursor);
        else value = listDTO(await request("inventory/work-orders?" + query({ cursor: previous.nextCursor }), { signal }), row => {
          scoped(row, scope()); const out = pick(row, "id,name,state,workspaceId,areaId"); id(out.id); text(out.name, 150); text(out.state, 32); return out;
        });
        if (!fresh(ticket) || state[name] !== previous) return;
        const key = row => name === "stock" ? [row.warehouseId, row.cellId, row.materialId].join("/") : row.id;
        const seen = new Set(previous.items.map(key)); for (const row of value.items) { if (seen.has(key(row))) throw invalid(); seen.add(key(row)); }
        if (value.hasMore && value.nextCursor === previous.nextCursor) throw invalid();
        state[name] = { ...value, items: previous.items.concat(value.items) }; render(); note("Следующая страница загружена. Подтверждённые строки сохранены.");
      });
    }
    function definition(host, pairs) { const dl = el("dl"); for (const [label, value] of pairs) dl.append(el("dt", "", label), el("dd", "", value)); host.append(dl); }
    function formError(host, input, message) { host.replaceChildren(); host.className = "inv-error"; host.setAttribute("role", "alert"); host.tabIndex = -1; const link = el("a", "", message); link.href = "#" + input.id; link.addEventListener("click", event => { event.preventDefault(); input.focus(); }); host.append(link); input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", host.id); host.focus(); }
    function scope() { return { workspaceId: context.workspaceId, areaId: state.areaId }; }
    function query(extra = {}) { return new URLSearchParams({ ...scope(), ...extra }).toString(); }
    function active(rows = []) { return rows.filter(row => row.state === "Active"); }
    function catalog(name, key) { return state.settings?.[name]?.find(row => row.id === key); }
    function precision(materialId) { const material = catalog("materials", materialId), unit = material && catalog("units", material.unitId); if (!material || !unit) throw invalid(); return unit.precision; }
    function metadata(host, row) { const details = el("details", "inv-meta"), pairs = [["Идентификатор", row.id], ["Редакция", String(row.revision)]]; if (row.authorAccountId) pairs.push(["Идентификатор учётной записи автора", row.authorAccountId]); details.append(el("summary", "", "Сведения для поддержки")); definition(details, pairs); host.append(details); }
    function authorLabel(row) { return row.authorAccountId === context.accountId ? "Вы" : "Учётная запись " + row.authorAccountId; }
    function movementLocations(row, original = false) {
      const location = (warehouseId, cellId) => {
        const warehouse = catalog("warehouses", warehouseId), cell = catalog("cells", cellId);
        return (warehouse?.name || (warehouseId ? "Склад не загружен (ID: " + warehouseId + ")" : "Склад не указан")) + " / " + (cell?.warehouseId === warehouseId ? cell.name : cellId ? "Ячейка не загружена (ID: " + cellId + ")" : "Ячейка не указана");
      };
      const transfer = !!(row.targetWarehouseId || row.targetCellId), savedDirection = original || row.operation === "Reversal";
      const pairs = [[transfer ? savedDirection ? "Откуда в исходном документе" : "Откуда" : "Склад / ячейка", location(row.warehouseId, row.cellId)]];
      if (transfer) pairs.push([savedDirection ? "Куда в исходном документе" : "Куда", location(row.targetWarehouseId, row.targetCellId)]);
      return pairs;
    }
    function empty(host, message) { host.append(el("p", "inv-empty", message)); }
    function section(host, title, elementId) { const panel = el("section", "inv-section", undefined, elementId), h = el("h3", "", title); h.tabIndex = -1; panel.append(h); host.append(panel); return panel; }
    function table(host, title, headings, rows, elementId) {
      const hint = el("p", "inv-meta", "Если таблица шире экрана, прокручивайте её отдельно. С клавиатуры: переведите фокус на таблицу и используйте стрелки.", elementId + "-hint");
      const wrapper = el("div", "inv-table-wrap", undefined, elementId); wrapper.tabIndex = 0; wrapper.setAttribute("role", "region"); wrapper.setAttribute("aria-label", title); wrapper.setAttribute("aria-describedby", hint.id);
      const t = el("table"), head = el("thead"), body = el("tbody"), hr = el("tr"); t.append(el("caption", "", title));
      for (const heading of headings) { const th = el("th", "", heading); th.scope = "col"; hr.append(th); } head.append(hr);
      for (const values of rows) { const row = el("tr"); for (const value of values) row.append(el("td", typeof value === "number" ? "inv-quantity" : "", typeof value === "number" ? quantity(value) : value)); body.append(row); }
      t.append(head, body); wrapper.append(t); host.append(hint, wrapper);
    }
    async function loadSetup() {
      await run(async (ticket, signal) => { note("Загружаем справочники участка…"); const value = settingsDTO(await request("inventory/setup?" + query(), { signal }), scope()); if (!fresh(ticket)) return;
        state.settings = value; state.stock = null; state.requests = null; state.movements = null; state.selectedRequest = null; state.selectedMovement = null; state.stale = false;
        state.warehouseId = active(value.warehouses)[0]?.id || ""; state.cellId = ""; render(); note("Справочники загружены. Остатки и наряды загружаются отдельно.");
      });
    }
    async function readStock(signal, cursor = "") {
      const scopeValue = scope(), raw = await request("inventory/stock?" + query({ ...(state.warehouseId ? { warehouseId: state.warehouseId } : {}), ...(cursor ? { cursor } : {}) }), { signal });
      const value = listDTO(raw, row => {
        scoped(row, scopeValue); const out = pick(row, "workspaceId,areaId,materialId,materialName,unitId,unitName,warehouseId,warehouseName,cellId,cellName,onHand,reserved,available");
        for (const key of ["materialId", "unitId", "warehouseId", "cellId"]) id(out[key]);
        for (const key of ["materialName", "unitName", "warehouseName", "cellName"]) text(out[key], 150);
        const [onHand, reserved, available] = ["onHand", "reserved", "available"].map(key => milli(out[key], false, true));
        if (reserved > onHand || available !== onHand - reserved || (state.warehouseId && out.warehouseId !== state.warehouseId)) throw invalid(); return out;
      });
      if (new Set(value.items.map(row => [row.materialId, row.warehouseId, row.cellId].join("/"))).size !== value.items.length) throw invalid(); return value;
    }
    async function readMovements(signal, workOrderId = "", cursor = "") {
      const value = listDTO(await request("inventory/documents?" + query({ ...(workOrderId ? { workOrderId } : {}), ...(cursor ? { cursor } : {}) }), { signal }), row => movementDTO(row, scope())); unique(value.items);
      if (workOrderId && value.items.some(row => row.workOrderId !== workOrderId)) throw invalid(); return value;
    }
    async function loadStock() {
      await run(async (ticket, signal) => { note("Обновляем остатки и движения…"); const stock = await readStock(signal), movements = await readMovements(signal); if (!fresh(ticket)) return;
        state.stock = stock; state.movements = movements; state.selectedMovement = null; state.stale = false; render(); note("Остатки и движения загружены. Они могут измениться после этого снимка.");
      });
    }
    async function loadOrders() {
      await run(async (ticket, signal) => { const value = listDTO(await request("inventory/work-orders?" + query(), { signal }), row => {
        scoped(row, scope()); const out = pick(row, "id,name,state,workspaceId,areaId"); id(out.id); text(out.name, 150); text(out.state, 32); return out;
      }); unique(value.items); if (!fresh(ticket)) return; state.orders = value; if (!value.items.some(row => row.id === state.workOrderId)) { state.workOrderId = ""; state.requests = null; state.selectedRequest = null; } render(); note("Доступные наряды загружены. Выберите наряд по названию."); });
    }
    async function readRequests(signal, workOrderId = state.workOrderId, cursor = "") {
      if (!workOrderId) throw invalid(); const value = listDTO(await request("inventory/requests?" + query({ workOrderId, ...(cursor ? { cursor } : {}) }), { signal }), row => requestDTO(row, scope())); unique(value.items);
      if (value.items.some(row => row.workOrderId !== workOrderId)) throw invalid(); return value;
    }
    async function loadRequests() {
      await run(async (ticket, signal) => { note("Обновляем материалы наряда…"); const value = await readRequests(signal), movements = await readMovements(signal, state.workOrderId); if (!fresh(ticket)) return;
        state.requests = value; state.movements = movements; state.selectedRequest = state.selectedRequest && value.items.find(row => row.id === state.selectedRequest.id) || null; state.selectedMovement = null; state.stale = false;
        render(); note("Материалы наряда и движения обновлены.");
      });
    }
    function buildForm(host, prefix, label, specs, build) {
      const form = el("form", "", undefined, prefix), fields = el("div", "inv-fields"), errors = el("div", "", undefined, prefix + "-errors"), controls = {}, preview = el("div", "", undefined, prefix + "-preview"); form.noValidate = true; form.dataset.inventoryMutation = "true";
      for (const spec of specs) { const input = field(fields, spec.label, prefix + "-" + spec.key, spec.type || "text", spec.max || 0); controls[spec.key] = input;
        if (spec.rows) { options(input, spec.rows, spec.blank); input.value = spec.value || ""; } else if (spec.value !== undefined) input.value = spec.value;
        if (spec.inputMode) input.inputMode = spec.inputMode; if (spec.placeholder) input.placeholder = spec.placeholder; else if (spec.inputMode === "decimal") input.placeholder = "0,000"; if (spec.wide) input.parentElement.classList.add("inv-wide");
        if (spec.hint) { const hint = el("p", "inv-meta", spec.hint, input.id + "-hint"); input.parentElement.append(hint); input.setAttribute("aria-describedby", hint.id); }
      }
      const review = el("button", "inv-primary", "Проверить: " + label, prefix + "-review"); review.type = "submit"; form.append(errors, fields, review, preview); host.append(form);
      let prepared = null;
      function clearPreview() { prepared = null; preview.replaceChildren(); errors.replaceChildren(); for (const input of Object.values(controls)) { input.removeAttribute("aria-invalid"); const hint = doc.getElementById(input.id + "-hint"); if (hint) input.setAttribute("aria-describedby", hint.id); else input.removeAttribute("aria-describedby"); } }
      form.addEventListener("input", clearPreview); form.addEventListener("change", clearPreview);
      form.addEventListener("submit", event => {
        event.preventDefault(); if (blocked() || !ready() || state.stale) return; clearPreview();
        try {
          prepared = build(controls); prepared.body = { ...scope(), ...prepared.body }; prepared.scope = { ...scope(), accountId: context.accountId, actorId: context.actorId }; prepared.key = crypto.randomUUID(); prepared.previewId = preview.id;
          freeze(prepared.body); freeze(prepared.scope); preview.append(el("h4", "", "Проверьте перед записью")); definition(preview, prepared.summary);
          preview.append(el("p", "inv-notice", prepared.kind === "movement" ? "Проведённый документ нельзя изменить или удалить. Для исправления оформите обратное движение." : "После создания основные сведения не меняются. Проверьте выбранные записи и количество."));
          preview.append(button(label, prefix + "-confirm", () => { if (prepared) return execute(prepared); }, true), button("Изменить данные", prefix + "-edit", () => { clearPreview(); Object.values(controls)[0]?.focus(); }));
          review.classList.remove("inv-primary"); preview.querySelector("h4").tabIndex = -1; preview.querySelector("h4").focus(); updateBusy();
        } catch (error) { const input = error.field || Object.values(controls)[0]; formError(errors, input, error.message || "Проверьте поля."); }
      });
      if (state.stale) { review.dataset.unavailable = "true"; form.prepend(el("p", "inv-notice", "Сведения устарели. Обновите данные перед новой операцией.")); }
      return controls;
    }
    function failure(field, message) { const error = new Error(message); error.field = field; throw error; }
    function required(input, max, label) { const value = input.value.trim(); if (!value || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) failure(input, label + ": от 1 до " + max + " символов без управляющих знаков."); input.value = value; return value; }
    function chosen(input, rows, label) { const row = rows.find(item => item.id === input.value); if (!row) failure(input, "Выберите " + label + " из загруженного списка."); return row; }
    function enteredQuantity(input, materialId) { try { return numberFromMilli(milliInput(input.value, precision(materialId))); } catch (error) { failure(input, error.message); } }
    function dates(prefix = "") { const now = new Date().toISOString(); return [{ key: prefix + "day", label: "Дата операции (UTC)", value: now.slice(8, 10) + "." + now.slice(5, 7) + "." + now.slice(0, 4), max: 10, inputMode: "numeric", placeholder: "ДД.ММ.ГГГГ" }, { key: prefix + "time", label: "Время операции (UTC)", value: now.slice(11, 19), max: 8, inputMode: "numeric", placeholder: "ЧЧ:ММ:СС" }]; }
    function commonMovement(controls, correction = false) {
      const basis = required(controls.basis, 2000, "Основание"), reason = correction ? required(controls.reason, 500, "Причина исправления") : controls.reason.value.trim();
      if (reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) failure(controls.reason, "Причина: до 500 символов без управляющих знаков."); controls.reason.value = reason;
      let occurredAt; try { occurredAt = inputDate(controls.day.value, controls.time.value); } catch (error) { failure(controls.day, error.message); }
      return { basis, reason, occurredAt };
    }
    function basisFields(correction = false) { return [...dates(), { key: "basis", label: "Документ или основание", type: "textarea", max: 2000, wide: true }, { key: "reason", label: correction ? "Причина исправления" : "Пояснение (необязательно)", type: "textarea", max: 500, wide: true }]; }
    function warehouseCells(warehouseId) { return active(state.settings.cells).filter(row => row.warehouseId === warehouseId); }
    function renderWarehouse() {
      warehouseHost.replaceChildren(); const title = el("h3", "", "Остатки и движения", "inventory-warehouse-heading"); title.tabIndex = -1; warehouseHost.append(title);
      if (!state.settings) { empty(warehouseHost, "Справочники участка ещё не загружены. Остатки неизвестны."); return; }
      if (state.settings.hasMore) warehouseHost.append(el("p", "inv-notice", "Справочники ограничены первыми 100 записями каждого вида. Часть записей не показана."));
      const fields = el("div", "inv-fields"), warehouse = field(fields, "Склад", "inventory-warehouse", "select"); options(warehouse, active(state.settings.warehouses), "Все склады участка"); warehouse.value = state.warehouseId;
      warehouse.addEventListener("change", () => { if (blocked()) return; state.warehouseId = warehouse.value; state.stock = null; state.movements = null; state.selectedMovement = null; state.stale = false; render(); note("Склад изменён. Обновите остатки."); });
      fields.append(button("Обновить остатки и движения", "inventory-stock-load", loadStock, true)); warehouseHost.append(fields);
      warehouseHost.append(el("p", "inv-meta", "Остаток на складе включает резерв. Доступно = остаток − резерв. Значения разных единиц не суммируются."));
      if (!state.stock) empty(warehouseHost, "Остатки ещё не загружены. Отсутствие данных не означает нулевой остаток.");
      else { listNote(warehouseHost, state.stock, "Строк остатков"); if (!state.stock.items.length) empty(warehouseHost, "В полученной выборке строк остатков нет."); else table(warehouseHost, "Остатки по материалам и ячейкам", ["Материал", "Склад / ячейка", "Единица", "Остаток", "Резерв", "Доступно"], state.stock.items.map(row => [row.materialName, row.warehouseName + " / " + row.cellName, row.unitName, row.onHand, row.reserved, row.available]), "inventory-stock-table"); }
      const posting = section(warehouseHost, "Приход и перемещение", "inventory-posting"); renderStockForm(posting);
      renderMovements(warehouseHost);
      const setup = el("details", "inv-section", undefined, "inventory-setup-details"); setup.append(el("summary", "", "Справочники: единицы, материалы, склады и ячейки"), el("p", "inv-meta", "После создания единицу материала и склад ячейки изменить нельзя. Для каждого движения выберите ячейку.")); warehouseHost.append(setup); renderSetupAuthors(setup); renderSetupForm(setup);
    }
    function renderSetupAuthors(host) {
      for (const [key, title] of [["units", "Единицы"], ["materials", "Материалы"], ["warehouses", "Склады"], ["cells", "Ячейки"]]) {
        table(host, title + ": автор и версия", ["Наименование", "Автор создания", "Версия"], state.settings[key].map(row => [row.name, row.createdBy, String(row.revision)]), "inventory-authors-" + key);
      }
    }
    function renderSetupForm(host) {
      const kinds = [{ id: "Unit", name: "Единица" }, { id: "Material", name: "Материал" }, { id: "Warehouse", name: "Склад" }, { id: "Cell", name: "Ячейка" }];
      const controls = buildForm(host, "inventory-create-setup", "Создать запись", [{ key: "kind", label: "Вид записи", type: "select", rows: kinds, value: "Unit" }, { key: "name", label: "Наименование", max: 150 }, { key: "precision", label: "Знаков после точки у единицы", type: "select", rows: [0, 1, 2, 3].map(n => ({ id: String(n), name: String(n) })), value: "0" }, { key: "unit", label: "Единица материала", type: "select", rows: active(state.settings.units) }, { key: "warehouse", label: "Склад ячейки", type: "select", rows: active(state.settings.warehouses) }], controls => {
        const kind = chosen(controls.kind, kinds, "вид записи").id, name = required(controls.name, 150, "Наименование"), body = { name };
        if (kind === "Unit") { if (!/^[0-3]$/.test(controls.precision.value)) failure(controls.precision, "Выберите точность от 0 до 3."); body.precision = Number(controls.precision.value); }
        if (kind === "Material") body.unitId = chosen(controls.unit, active(state.settings.units), "единицу").id;
        if (kind === "Cell") body.warehouseId = chosen(controls.warehouse, active(state.settings.warehouses), "склад").id;
        return { kind: "setup", setupKind: kind, path: "inventory/setup/" + kind, body, summary: [["Вид", kinds.find(row => row.id === kind).name], ["Наименование", name]], refresh: "setup" };
      });
      const toggle = () => { controls.precision.parentElement.hidden = controls.kind.value !== "Unit"; controls.unit.parentElement.hidden = controls.kind.value !== "Material"; controls.warehouse.parentElement.hidden = controls.kind.value !== "Cell"; }; controls.kind.addEventListener("change", toggle); toggle();
    }
    function renderStockForm(host) {
      const materials = active(state.settings.materials), warehouses = active(state.settings.warehouses);
      if (!materials.length || !warehouses.length || !active(state.settings.cells).length) { empty(host, "Для операции нужны действующие материал с единицей, склад и ячейка. Создайте их в справочниках."); return; }
      const controls = buildForm(host, "inventory-stock-operation", "Провести складскую операцию", [{ key: "operation", label: "Операция", type: "select", rows: [{ id: "Receipt", name: OPERATIONS.Receipt }, { id: "Transfer", name: OPERATIONS.Transfer }], value: "Receipt" }, { key: "material", label: "Материал", type: "select", rows: materials }, { key: "warehouse", label: "Склад", type: "select", rows: warehouses, value: state.warehouseId }, { key: "cell", label: "Ячейка", type: "select", rows: warehouseCells(state.warehouseId) }, { key: "targetWarehouse", label: "Склад получателя", type: "select", rows: warehouses }, { key: "targetCell", label: "Ячейка получателя", type: "select", rows: [] }, { key: "quantity", label: "Количество в единицах материала", inputMode: "decimal", hint: "Дробная часть отделяется запятой или точкой. Точность берётся из единицы материала; округление не выполняется." }, ...basisFields()], controls => {
        const operation = controls.operation.value; if (!["Receipt", "Transfer"].includes(operation)) failure(controls.operation, "Выберите операцию.");
        const material = chosen(controls.material, materials, "материал"), warehouse = chosen(controls.warehouse, warehouses, "склад"), cell = chosen(controls.cell, warehouseCells(warehouse.id), "ячейку");
        const q = enteredQuantity(controls.quantity, material.id), body = { operation, materialId: material.id, warehouseId: warehouse.id, cellId: cell.id, quantity: q, ...commonMovement(controls) };
        const summary = [["Операция", OPERATIONS[operation]], ["Материал", material.name], ["Количество", quantity(q) + " " + material.unitName], [operation === "Transfer" ? "Откуда" : "Куда", warehouse.name + " / " + cell.name]];
        if (operation === "Transfer") { const targetWarehouse = chosen(controls.targetWarehouse, warehouses, "склад получателя"), targetCell = chosen(controls.targetCell, warehouseCells(targetWarehouse.id), "ячейку получателя"); if (targetCell.id === cell.id) failure(controls.targetCell, "Для перемещения выберите другую ячейку."); body.targetWarehouseId = targetWarehouse.id; body.targetCellId = targetCell.id; summary.push(["Куда", targetWarehouse.name + " / " + targetCell.name]); }
        summary.push(["Эффект", operation === "Receipt" ? "Остаток увеличится; резерв не изменится." : "Остаток уменьшится в исходной ячейке и увеличится в ячейке получателя; резерв не изменится."], ["Основание", body.basis], ["Фактическое время", dateLabel(body.occurredAt)]);
        return { kind: "movement", path: "inventory/documents", body, material, summary, refresh: "stock" };
      });
      for (const [warehouse, cell] of [[controls.warehouse, controls.cell], [controls.targetWarehouse, controls.targetCell]]) warehouse.addEventListener("change", () => options(cell, warehouseCells(warehouse.value)));
      const toggle = () => { controls.targetWarehouse.parentElement.hidden = controls.targetCell.parentElement.hidden = controls.operation.value !== "Transfer"; }; controls.operation.addEventListener("change", toggle); toggle();
    }
    const WORK_STATES = { Draft: "Черновик", Assigned: "Назначен", Accepted: "Принят бригадой", InProgress: "В работе", Paused: "Приостановлен", Submitted: "На приёмке", Rework: "На доработке", Completed: "Завершён", Reported: "Отчёт представлен", Verified: "Результат принят", Closed: "Закрыт", Cancelled: "Отменён" };
    function renderOrders() {
      orderHost.replaceChildren(); const title = el("h3", "", "Материалы наряда", "inventory-orders-heading"); title.tabIndex = -1; orderHost.append(title);
      if (!state.settings) { empty(orderHost, "Сначала загрузите складские справочники участка."); return; }
      orderHost.append(button("Загрузить доступные наряды", "inventory-orders-load", loadOrders));
      if (!state.orders) { empty(orderHost, "Наряды ещё не загружены. Доступ кладовщика к материалам не открывает техническое приложение наряда."); return; }
      listNote(orderHost, state.orders, "Нарядов"); if (!state.orders.items.length) { empty(orderHost, "В полученной выборке доступных нарядов нет."); return; }
      const fields = el("div", "inv-fields"), order = field(fields, "Наряд (название)", "inventory-order", "select"); options(order, state.orders.items); order.value = state.workOrderId;
      order.addEventListener("change", () => { if (blocked()) return; state.workOrderId = state.orders.items.some(row => row.id === order.value) ? order.value : ""; state.requests = null; state.selectedRequest = null; state.selectedMovement = null; state.movements = null; state.stale = false; render(); note("Наряд выбран. Загрузите его материалы."); });
      const refresh = button("Обновить материалы и движения", "inventory-requests-load", loadRequests, true); refresh.dataset.unavailable = String(!state.workOrderId); fields.append(refresh); orderHost.append(fields);
      const current = state.orders.items.find(row => row.id === state.workOrderId); if (!current) return;
      definition(orderHost, [["Наряд", current.name], ["Состояние", WORK_STATES[current.state] || "Состояние не поддерживается этим экраном"]]);
      orderHost.append(el("p", "inv-meta", "Выданное за вычетом возврата не равно расходу. Расход подтвердите отдельно. Завершение наряда не возвращает материалы на склад."));
      if (!state.requests) empty(orderHost, "Материалы наряда ещё не загружены."); else { listNote(orderHost, state.requests, "Заявок на материал"); for (const row of state.requests.items) { const item = el("div", "inv-row"); if (state.selectedRequest?.id === row.id) item.setAttribute("aria-current", "true"); item.append(button(row.materialName + " · " + row.warehouseName + " / " + row.cellName, "inventory-request-" + row.id, () => { if (blocked()) return; state.selectedRequest = row; state.selectedMovement = null; render(); doc.getElementById("inventory-request-heading")?.focus(); }), el("p", "inv-meta", "Запрошено: " + quantity(row.requestedQuantity) + " " + row.unitName + ". В резерве осталось: " + quantity(row.reservedRemaining) + ". Не возвращено: " + quantity(row.outstandingQuantity) + ".")); orderHost.append(item); } if (!state.requests.items.length) empty(orderHost, "В полученной выборке заявок на материал нет."); }
      if (state.selectedRequest) renderRequestDetail(section(orderHost, "Выбранная заявка на материал", "inventory-request-detail"));
      const creator = el("details", "inv-section"); creator.append(el("summary", "", "Запросить материал для наряда")); orderHost.append(creator);
      if (["Assigned", "Accepted", "InProgress", "Paused", "Rework"].includes(current.state)) renderRequestForm(creator, current); else empty(creator, "В текущем состоянии наряда нельзя запросить материалы.");
      renderMovements(orderHost);
    }
    function renderRequestForm(host, order) {
      const materials = active(state.settings.materials), warehouses = active(state.settings.warehouses);
      const controls = buildForm(host, "inventory-request-create", "Создать запрос материала", [{ key: "material", label: "Материал", type: "select", rows: materials }, { key: "warehouse", label: "Склад", type: "select", rows: warehouses }, { key: "cell", label: "Ячейка", type: "select", rows: [] }, { key: "quantity", label: "Запрошенное количество", inputMode: "decimal" }, { key: "basis", label: "Основание запроса", type: "textarea", max: 2000, wide: true }, { key: "reason", label: "Пояснение (необязательно)", type: "textarea", max: 500, wide: true }], controls => {
        const material = chosen(controls.material, materials, "материал"), warehouse = chosen(controls.warehouse, warehouses, "склад"), cell = chosen(controls.cell, warehouseCells(warehouse.id), "ячейку");
        const q = enteredQuantity(controls.quantity, material.id), basis = required(controls.basis, 2000, "Основание"), reason = controls.reason.value.trim(); if (reason.length > 500) failure(controls.reason, "Пояснение: до 500 символов."); controls.reason.value = reason;
        return { kind: "request", path: "inventory/requests", body: { workOrderId: order.id, materialId: material.id, warehouseId: warehouse.id, cellId: cell.id, requestedQuantity: q, basis, reason }, material, order, summary: [["Наряд", order.name], ["Материал", material.name], ["Запрошено", quantity(q) + " " + material.unitName], ["Склад / ячейка", warehouse.name + " / " + cell.name], ["Эффект", "Создаётся запрос. Остаток и резерв пока не меняются."], ["Основание", basis]], refresh: "requests" };
      }); controls.warehouse.addEventListener("change", () => options(controls.cell, warehouseCells(controls.warehouse.value)));
    }
    function requestActions(row) {
      const order = state.orders?.items.find(item => item.id === row.workOrderId), normal = ["Assigned", "Accepted", "InProgress", "Paused", "Rework"].includes(order?.state), clearing = !!order && Object.prototype.hasOwnProperty.call(WORK_STATES, order.state);
      return { Reserve: normal && row.reservedTotal === 0, Issue: ["InProgress", "Rework"].includes(order?.state) && row.reservedRemaining > 0, Return: clearing && row.returnableQuantity > 0, Release: clearing && row.reservedRemaining > 0 };
    }
    function renderRequestDetail(host) {
      const row = state.selectedRequest; host.querySelector("h3").id = "inventory-request-heading";
      definition(host, [["Материал", row.materialName], ["Склад / ячейка", row.warehouseName + " / " + row.cellName], ["Запрошено", quantity(row.requestedQuantity) + " " + row.unitName], ["Всего зарезервировано", quantity(row.reservedTotal)], ["Выдано", quantity(row.issuedTotal)], ["Возвращено", quantity(row.returnedTotal)], ["Освобождено", quantity(row.releasedTotal)], ["Осталось в резерве", quantity(row.reservedRemaining)], ["Выдано и не возвращено", quantity(row.outstandingQuantity)]]); metadata(host, row);
      const allowed = requestActions(row), choices = Object.entries(allowed).filter(([, yes]) => yes).map(([key]) => ({ id: key, name: OPERATIONS[key] }));
      definition(host, [["Подтверждённый расход", quantity(row.consumedTotal)], ["Требует отчёта или возврата", quantity(row.returnableQuantity)]]);
      host.append(el("p", "inv-meta", "Вернуть можно выданные, но ещё не израсходованные материалы. Расход подтверждает бригадир в разделе «Материалы нарядов»."));
      if (!choices.length) { empty(host, "Для текущих остатков и состояния наряда нет доступных действий. Обновите данные."); return; }
      const controls = buildForm(host, "inventory-request-operation", "Провести операцию по наряду", [{ key: "operation", label: "Операция", type: "select", rows: choices, value: choices[0].id }, { key: "quantity", label: "Количество", inputMode: "decimal" }, ...basisFields()], controls => {
        const operation = chosen(controls.operation, choices, "операцию").id, body = { operation, materialRequestId: row.id, expectedRevision: row.revision, ...commonMovement(controls) };
        const q = operation === "Reserve" ? row.requestedQuantity : enteredQuantity(controls.quantity, row.materialId), cap = operation === "Return" ? row.returnableQuantity : row.reservedRemaining;
        if (operation !== "Reserve" && milli(q) > milli(cap)) failure(controls.quantity, "Количество превышает допустимый остаток: " + quantity(cap) + " " + row.unitName + ".");
        if (operation !== "Reserve") body.quantity = q;
        return { kind: "movement", path: "inventory/documents", body, before: row, expectedQuantity: q, summary: [["Наряд", row.workOrderName], ["Материал", row.materialName], ["Операция", OPERATIONS[operation]], ["Количество", quantity(q) + " " + row.unitName], ["Эффект", { Reserve: "Резервируется всё запрошенное количество. Физический остаток не меняется.", Issue: "Остаток и резерв уменьшатся на выданное количество.", Return: "Остаток увеличится. Резерв не восстанавливается.", Release: "Резерв уменьшится. Физический остаток не меняется." }[operation]], ["Основание", body.basis]], refresh: "requests" };
      }); const toggle = () => { controls.quantity.parentElement.hidden = controls.operation.value === "Reserve"; }; controls.operation.addEventListener("change", toggle); toggle();
    }
    function renderMovements(host) {
      const panel = section(host, "Проведённые документы", "inventory-documents-" + state.view);
      panel.append(el("p", "inv-meta", "Документ проведён. Текущие остатки смотрите в разделе склада."));
      if (!state.movements) { empty(panel, "Документы ещё не загружены."); return; }
      listNote(panel, state.movements, "Документов");
      for (const row of state.movements.items) { const item = el("div", "inv-row"); item.append(button(OPERATIONS[row.operation] + " · " + (row.number ? "документ " + row.number : "без номера"), "inventory-document-" + row.id, () => openMovement(row.id)), el("p", "inv-meta", row.materialName + ": " + quantity(row.quantity) + " " + row.unitName + ". Проведено: " + dateLabel(row.postedAt))); panel.append(item); }
      if (!state.movements.items.length) empty(panel, "В полученной выборке проведённых документов нет.");
      if (state.selectedMovement) renderMovementDetail(panel);
    }
    async function openMovement(movementId) {
      await run(async (ticket, signal) => { const row = movementDTO(await request("inventory/documents/" + id(movementId) + "?" + query(), { signal }), scope()); if (row.id !== movementId) throw invalid();
        let head = null; if (row.materialRequestId) { const value = await readRequests(signal, row.workOrderId); head = value.items.find(item => item.id === row.materialRequestId) || null; }
        if (!fresh(ticket)) return; state.selectedMovement = { row, head }; render(); doc.getElementById("inventory-document-heading")?.focus(); note("Документ перечитан. Возможность обратного движения зависит от текущих остатков и состояния заявки.");
      });
    }
    function renderMovementDetail(host) {
      const { row, head } = state.selectedMovement, panel = section(host, "Документ " + (row.number || "без номера"), "inventory-document-detail"); panel.querySelector("h3").id = "inventory-document-heading";
      definition(panel, [["Операция", OPERATIONS[row.operation]], ["Материал", row.materialName], ["Количество", quantity(row.quantity) + " " + row.unitName], ...movementLocations(row), ["Автор", authorLabel(row)], ["Основание", row.basis], ["Пояснение", row.reason || "Не указано"], ["Фактическое время", dateLabel(row.occurredAt)], ["Время проведения", dateLabel(row.postedAt)]]); metadata(panel, row);
      if (row.operation === "Consume") { panel.append(el("p", "inv-meta", "Исправить расход можно в разделе «Материалы нарядов».")); return; }
      const reason = row.operation === "Reversal" ? "Обратное движение повторно не отменяется." : row.reversalMovementId ? "Для этого документа уже проведено обратное движение." : row.materialRequestId && !head ? "Актуальная заявка не найдена в ограниченной выборке. Последнее действующее движение не подтверждено." : row.materialRequestId && head.lastMovementId !== row.id ? "Сначала отмените более позднее движение по этой заявке." : "";
      if (reason) { const disabled = button("Провести обратное движение", "inventory-reversal-unavailable", () => {}); disabled.dataset.unavailable = "true"; panel.append(disabled, el("p", "inv-meta", reason)); return; }
      buildForm(panel, "inventory-reversal", "Провести обратное движение", basisFields(true), controls => {
        const body = { operation: "Reversal", originalMovementId: row.id, ...commonMovement(controls, true) }; if (head) body.expectedRevision = head.revision;
        return { kind: "movement", path: "inventory/documents", body, original: row, before: head, summary: [["Исходный документ", row.number || "Без номера"], ["Материал", row.materialName], ["Количество", quantity(row.quantity) + " " + row.unitName], ...movementLocations(row, true), ["Автор исходного документа", authorLabel(row)], ["Эффект", "Будет создано обратное движение. Резерв может восстановиться даже у завершённого наряда; при необходимости освободите его отдельно."], ["Причина", body.reason]], refresh: state.view === "orders" ? "requests" : "stock" };
      });
    }
    function validateReceipt(raw, intent) {
      const body = intent.body;
      if (intent.kind === "setup") { const row = setupRow(raw, intent.setupKind, body); if (row.name !== body.name || row.revision !== 1 || row.state !== "Active") throw invalid(); for (const key of ["precision", "unitId", "warehouseId"]) if (body[key] !== undefined && row[key] !== body[key]) throw invalid(); return row; }
      if (intent.kind === "request") { const row = requestDTO(raw, body); for (const key of ["workOrderId", "materialId", "warehouseId", "cellId", "requestedQuantity"]) if (row[key] !== body[key]) throw invalid(); if (row.revision !== 1 || row.state !== "Requested" || row.lastMovementId || ["reservedTotal", "issuedTotal", "returnedTotal", "releasedTotal", "reservedRemaining", "outstandingQuantity"].some(key => row[key] !== 0) || row.unitId !== intent.material.unitId) throw invalid(); return row; }
      const row = movementDTO(raw, body, false); if (row.operation !== body.operation || row.basis !== body.basis || row.reason !== (body.reason || "") || utc(row.occurredAt) !== body.occurredAt || row.authorAccountId !== intent.scope.accountId) throw invalid();
      if (intent.original) {
        const original = intent.original; for (const key of ["materialId", "unitId", "warehouseId", "cellId", "targetWarehouseId", "targetCellId", "materialRequestId", "workOrderId", "quantity"]) if (row[key] !== original[key]) throw invalid(); if (row.originalMovementId !== original.id) throw invalid();
      } else if (intent.before) {
        for (const key of ["materialId", "unitId", "warehouseId", "cellId", "workOrderId"]) if (row[key] !== intent.before[key]) throw invalid();
        if (row.materialRequestId !== intent.before.id || row.quantity !== intent.expectedQuantity || row.previousMovementId !== intent.before.lastMovementId || row.originalMovementId || row.targetWarehouseId || row.targetCellId) throw invalid();
      } else {
        for (const key of ["materialId", "warehouseId", "cellId", "quantity"]) if (row[key] !== body[key]) throw invalid();
        if (row.unitId !== intent.material.unitId || row.targetWarehouseId !== (body.targetWarehouseId || "") || row.targetCellId !== (body.targetCellId || "") || row.materialRequestId || row.workOrderId || row.originalMovementId) throw invalid();
      }
      return row;
    }
    async function refreshAfter(intent, ticket, signal) {
      if (intent.refresh === "setup") { const data = settingsDTO(await request("inventory/setup?" + query(), { signal }), scope()); if (!fresh(ticket)) return; state.settings = data; }
      else if (intent.refresh === "stock") { const stock = await readStock(signal), movements = await readMovements(signal); if (!fresh(ticket)) return; state.stock = stock; state.movements = movements; state.selectedMovement = null; }
      else { const requests = await readRequests(signal), movements = await readMovements(signal, state.workOrderId); if (!fresh(ticket)) return; state.requests = requests; state.movements = movements; state.selectedRequest = requests.items.find(row => row.id === (intent.before?.id || intent.receipt.id)) || null; state.selectedMovement = null; }
      if (!fresh(ticket)) return; intent.refreshFailed = false; state.stale = false; render(); note("Операция подтверждена. Данные обновлены.");
    }
    async function execute(intent) {
      if (!intent || intent.scope.accountId !== context.accountId || intent.scope.actorId !== context.actorId || intent.scope.workspaceId !== context.workspaceId || intent.scope.areaId !== state.areaId) return;
      await run(async (ticket, signal) => {
        const wasUnknown = intent.phase === "unknown"; command = intent; retainedNotice = ""; intent.phase = "sending"; renderCommand(); updateBusy();
        try {
          const raw = await request(intent.path, { method: "POST", body: intent.body, headers: { "Idempotency-Key": intent.key }, signal });
          const receipt = validateReceipt(raw, intent); if (!fresh(ticket)) return; intent.receipt = freeze(receipt); intent.phase = "confirmed"; intent.refreshFailed = true; state.stale = true; renderCommand();
          await refreshAfter(intent, ticket, signal);
        } catch (error) {
          if (!fresh(ticket)) return;
          if (nativeSessionLost(error)) { handleReadError(error); }
          else if (intent.phase === "confirmed") { intent.refreshFailed = true; state.stale = true; renderCommand(); note("Операция подтверждена. Обновить данные пока не удалось.", true, error); if (accessLost(error)) handleReadError(error); }
          else if (wasUnknown || uncertain(error)) { intent.phase = "unknown"; renderCommand(); note("Исход операции не подтверждён. Дождитесь ответа при явном повторе той же операции.", false, error); if (accessLost(error)) handleReadError(error); }
          else { command = null; state.stale = true; render(); note(errorText(error) + " Подтверждение записи не получено.", true, error); if (accessLost(error)) handleReadError(error); }
        }
      });
    }
    async function refreshConfirmed() {
      if (command?.phase !== "confirmed") return; const saved = command;
      await run(async (ticket, signal) => { try { await refreshAfter(saved, ticket, signal); } catch (error) { if (!fresh(ticket)) return; saved.refreshFailed = true; state.stale = true; renderCommand(); note("Операция подтверждена. Обновить данные пока не удалось.", true, error); if (accessLost(error)) handleReadError(error); } });
    }
    render();
    return Object.freeze({ syncContext, reset, setExternalBusy, setExternalMutationLock });
  }
  globalThis.VodokanalInventory = Object.freeze({ create, helpers: Object.freeze({ milliInput, milli, quantity, inputDate, utc }) });
})();
