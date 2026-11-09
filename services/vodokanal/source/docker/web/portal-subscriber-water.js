(() => {
  "use strict";
  const labels = { Planned: "Запланирована", InProgress: "В пути", Done: "Доставлена", Cancelled: "Отменена",
    Confirmed: "Подтверждён", Issued: "Выдан", Accepted: "Принято", LateReview: "Ожидает проверки",
    Pending: "Ожидает решения", Approved: "Согласовано", Rejected: "Отклонено", Approve: "Согласовано", Reject: "Отклонено" };
  const errors = {
    кабинет_вода_доставка_конфликт: "У заказа есть незавершённая доставка. Сначала отмените запланированную доставку.",
    кабинет_вода_доставка_состояние_конфликт: "Доставка или заказ уже изменились. Для завершения доставки вода должна быть выдана.",
    кабинет_вода_доставка_запрещено: "Выполнить доставку может только назначенный действующий исполнитель.",
    кабинет_наряд_ресурс_конфликт: "Машина занята в этом интервале. Выберите другое время или ресурс.",
    кабинет_счетчик_проверка_последовательность_конфликт: "Изменение нарушает последовательность: даты должны различаться, значения не должны уменьшаться.",
    кабинет_счетчик_фото_существует: "У этого показания уже есть фотография. Сохранённая фотография не заменяется.",
    кабинет_счетчик_проверка_состояние_конфликт: "Решение уже принято. Обновите список.",
    кабинет_счетчик_проверка_лимит: "Ряд превышает предел одной процедуры проверки. Обратитесь к оператору."
  };
  const make = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const stamp = (value) => {
    if (!value) return "Не указано";
    const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
    return Number.isFinite(d.getTime()) ? d.toLocaleString("ru-RU") : "Некорректное время";
  };
  const iso = (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Укажите дату и время.");
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  };
  const wireUTC = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value)) throw new Error("Сервер вернул некорректную дату измерения. Обновите список.");
    const normalized = value.endsWith("Z") ? value : value + "Z";
    const parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace(/\.000Z$/, "Z") !== normalized) throw new Error("Сервер вернул некорректную дату измерения. Обновите список.");
    return normalized;
  };

  function create({ root, request, download, getContext = () => ({}), onError = () => {}, onMutationLock = () => {} }) {
    if (!root || typeof request !== "function") throw new Error("Не задан контракт кабинета абонента и воды");
    let context = {}, epoch = 0, busy = null, externalBusy = false, externalLock = false;
    let preparing = false, pending = null, publishedLock = false, clearedUnknown = false;
    const controllers = new Set(), readers = new Set();
    const pagers = [];
    const state = { readings: [], corrections: [], deliveries: [], selectedDelivery: null };
    root.classList.add("sw-extra");
    const status = make("p", "Выберите пространство и участок.", "sw-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const controls = make("div", undefined, "sw-toolbar");
    const area = field(controls, "Участок", "select");
    root.append(make("h2", "Показания и доставка воды"), controls, status);
    const receipt = make("section", undefined, "sw-receipt"); receipt.hidden = true;
    receipt.setAttribute("aria-live", "polite"); root.append(receipt);
    const receiptText = make("p");
    const retry = button(receipt, "Повторить ту же операцию", () => sendPending(), true, true);
    receipt.prepend(receiptText);
    const meter = section("Фото, проверка и принятый ряд показаний");
    const meterStaff = field(meter, "Режим просмотра", "select");
    options(meterStaff, [["mine", "Мои подтверждённые лицевые счета"], ["staff", "Служебный реестр участка"]]);
    const account = field(meter, "Лицевой счёт", "select");
    const accountPager = pager(meter, account, () => meterStaff.value === "staff" ? "personal-accounts?" + scope() : "my/personal-accounts",
      (row) => row.numberNormalized || row.number || row.name || "Подтверждённый лицевой счёт");
    const installation = field(meter, "Установка прибора", "select");
    const installPager = pager(meter, installation, () => "meter-installations?personalAccountId=" + encodeURIComponent(account.value),
      (row) => (row.name || "Прибор") + " · " + stamp(row.admittedAt || row.installedAt || row.createdAt));
    const reading = field(meter, "Показание", "select");
    const readingPager = pager(meter, reading, () => "meter-readings?meterInstallationId=" + encodeURIComponent(installation.value),
      (row) => stamp(row.measuredAt) + " · " + row.value + " · " + (labels[row.state] || "Запись"),
      (rows) => { state.readings = rows; refreshReviewOptions(); });
    const photoBox = make("fieldset"); photoBox.append(make("legend", "Фотография выбранного показания"));
    const photo = field(photoBox, "PNG или JPEG, не более 5 МБ", "file"); photo.accept = "image/png,image/jpeg";
    const photoUpload = button(photoBox, "Прикрепить фотографию", async () => {
      if (!uuid(reading.value)) throw new Error("Выберите показание.");
      const file = photo.files[0];
      if (!file || file.size < 1 || file.size > 5242880 || !["image/png", "image/jpeg"].includes(file.type)) throw new Error("Выберите PNG или JPEG размером до 5 МБ.");
      const current = epoch, readingId = reading.value;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); readers.add(reader);
        const done = () => readers.delete(reader);
        reader.onerror = () => { done(); reject(new Error("Не удалось прочитать выбранный файл.")); };
        reader.onabort = () => { done(); reject(Object.assign(new Error("Чтение отменено."), { code: "контекст_изменено" })); };
        reader.onload = () => { done(); resolve(String(reader.result).split(",")[1]); }; reader.readAsDataURL(file);
      });
      if (current !== epoch) return;
      await write("meter-readings/" + readingId + "/photo", { filename: file.name, mime: file.type, contentBase64: data }, () => {
        photo.value = ""; message("Фотография сохранена. Показание не изменено.");
      });
    }, true);
    button(photoBox, "Скачать фотографию", async () => {
      if (!uuid(reading.value)) throw new Error("Выберите показание.");
      if (typeof download !== "function") throw new Error("Скачивание недоступно.");
      const controller = new AbortController(); controllers.add(controller);
      try { await download("meter-readings/" + reading.value + "/photo/download", "reading-photo", controller.signal); }
      finally { controllers.delete(controller); }
    });
    meter.append(photoBox);
    const accepted = make("div");
    meter.append(make("h3", "Принятая последовательность"), make("p", "Расход рассчитан по принятым показаниям и согласованным исправлениям. График показывает загруженные данные."), accepted);
    const acceptedPager = pager(meter, null, () => "meter-installations/" + installation.value + "/accepted-series", null,
      (rows) => {
        renderSeries(accepted, rows);
        options(correctionTarget, rows.map(row => [row.id, stamp(row.measuredAt) + " · " + row.value]));
      });
    const correctionForm = make("fieldset"); correctionForm.append(make("legend", "Запросить исправление принятого показания"));
    const correctionTarget = field(correctionForm, "Принятое показание из загруженного ряда", "select");
    const proposedValue = field(correctionForm, "Предлагаемое значение", "number"); proposedValue.min = "0"; proposedValue.step = "0.001";
    const proposedDate = field(correctionForm, "Дата и время измерения", "datetime-local");
    const correctionReason = field(correctionForm, "Причина исправления", "textarea"); correctionReason.maxLength = 2000;
    button(correctionForm, "Отправить заявку на исправление", async () => {
      const value = Number(proposedValue.value);
      if (!uuid(correctionTarget.value) || !proposedValue.value || !Number.isFinite(value) || value < 0 || !correctionReason.value.trim()) throw new Error("Выберите показание, введите значение и причину исправления.");
      await write("meter-readings/" + correctionTarget.value + "/correction-requests", {
        reason: correctionReason.value.trim(), proposedValue: value, proposedMeasuredAt: iso(proposedDate.value)
      }, () => {
        proposedValue.value = ""; proposedDate.value = ""; correctionReason.value = ""; correctionPager.clear();
        message("Заявка сохранена. Загрузите список заявок заново. До решения сотрудника принятый ряд не меняется.");
      });
    }, true);
    meter.append(correctionForm);
    const reviews = make("div"); meter.append(make("h3", "Проверка поздних измерений и исправлений"));
    const correctionPager = pager(meter, null, () => "meter-installations/" + installation.value + "/correction-requests", null,
      (rows) => { state.corrections = rows; refreshReviewOptions(); renderRecords(reviews, rows, (r) => stamp(r.proposedMeasuredAt) + " · " + r.proposedValue + " · " + (labels[r.state] || "Заявка") + " · " + r.reason); });
    meter.append(reviews);
    const reviewForm = make("fieldset"); reviewForm.append(make("legend", "Решение сотрудника расчётного отдела"));
    const candidate = field(reviewForm, "Измерение или заявка", "select");
    const decision = field(reviewForm, "Решение", "select");
    options(decision, [["Approve", "Согласовать"], ["Reject", "Отклонить"]]);
    const reviewReason = field(reviewForm, "Основание решения", "textarea"); reviewReason.maxLength = 2000;
    button(reviewForm, "Сохранить решение", async () => {
      const selected = candidate._rows?.get(candidate.value);
      if (!selected || !reviewReason.value.trim()) throw new Error("Выберите запись и укажите основание решения.");
      await write("meter-readings/" + selected.readingId + "/review", {
        decision: decision.value, reason: reviewReason.value.trim(), value: selected.value,
        measuredAt: wireUTC(selected.measuredAt), correctionId: selected.correctionId || ""
      }, () => {
        reviewReason.value = "";
        for (const page of [readingPager, correctionPager, decisionPager, acceptedPager]) page.clear();
        message("Решение сохранено. Загрузите принятый ряд и историю заново; исходное показание не изменено.");
      });
    }, true);
    meter.append(reviewForm);
    const decisions = make("div"); meter.append(make("h3", "История решений"), decisions);
    const decisionPager = pager(meter, null, () => "meter-installations/" + installation.value + "/review-decisions", null,
      (rows) => renderRecords(decisions, rows, (r) => stamp(r.createdAt) + " · " + (labels[r.decision] || "Решение") + " · " + r.reason));

    const water = section("Доставка воды");
    const deliveryMode = field(water, "Список доставок", "select");
    options(deliveryMode, [["staff", "Доставки участка"], ["mine", "Назначенные мне"]]);
    const deliveries = make("div"); water.append(deliveries);
    const deliveryPager = pager(water, null, () => (deliveryMode.value === "mine" ? "water/my-deliveries?" : "water/deliveries?") + scope(), null,
      (rows) => { state.deliveries = rows; renderDeliveries(rows); });
    const createDelivery = make("fieldset"); createDelivery.append(make("legend", "Запланировать доставку"));
    const order = field(createDelivery, "Подтверждённый или выданный заказ", "select");
    const ordersPager = pager(createDelivery, order, () => "water/orders?" + scope(), (r) => r.quantity + " м³ · " + stamp(r.scheduledAt) + " · " + (labels[r.state] || r.state), null,
      (r) => ["Confirmed", "Issued"].includes(r.state));
    const resource = field(createDelivery, "Машина / ресурс", "select");
    const resourcesPager = pager(createDelivery, resource, () => "water/delivery-options/resources?" + scope(), (r) => r.name);
    const executor = field(createDelivery, "Исполнитель с действующими полномочиями", "select");
    const executorsPager = pager(createDelivery, executor, () => "water/delivery-options/executors?" + scope(), (r) => r.name);
    const address = field(createDelivery, "Адрес или точка доставки", "text"); address.maxLength = 250;
    const startAt = field(createDelivery, "Начало интервала", "datetime-local");
    const endAt = field(createDelivery, "Окончание интервала", "datetime-local");
    button(createDelivery, "Создать доставку", async () => {
      if (![order.value, resource.value, executor.value].every(uuid) || !address.value.trim()) throw new Error("Выберите заказ, машину и исполнителя, укажите адрес.");
      await write("water/deliveries", { workspaceId: context.workspaceId, areaId: area.value, orderId: order.value,
        resourceId: resource.value, executorAccountId: executor.value, address: address.value.trim(), startAt: iso(startAt.value), endAt: iso(endAt.value) }, () => {
        clearDeliverySelection(); deliveryPager.clear(); ordersPager.clear();
        resource.value = ""; executor.value = ""; address.value = ""; startAt.value = ""; endAt.value = "";
        message("Доставка запланирована. Загрузите список доставок заново. Исполнителю направлено уведомление.");
      });
    }, true);
    water.append(createDelivery);
    const actionBox = make("fieldset"); actionBox.append(make("legend", "Исполнение выбранной доставки"));
    const selectedText = make("p", "Выберите доставку в списке."); actionBox.append(selectedText);
    const action = field(actionBox, "Действие", "select");
    const comment = field(actionBox, "Комментарий к действию", "textarea"); comment.maxLength = 2000;
    button(actionBox, "Подтвердить действие", async () => {
      const row = state.selectedDelivery;
      if (!row || !action.value || !comment.value.trim()) throw new Error("Выберите доставку, действие и укажите комментарий.");
      await write("water/deliveries/" + row.id + "/actions/" + action.value, { expectedRevision: row.revision, comment: comment.value.trim() }, () => {
        clearDeliverySelection(); deliveryPager.clear(); ordersPager.clear();
        message("Действие сохранено. Загрузите доставки заново перед следующим действием.");
      });
    }, true);
    water.append(actionBox);

    function section(title) { const section = make("section", undefined, "sw-section"); section.append(make("h3", title)); root.append(section); return section; }
    function field(parent, label, type) {
      const wrap = make("label", undefined, "sw-field"), node = make(type === "select" || type === "textarea" ? type : "input");
      if (node.tagName === "INPUT") node.type = type;
      node.setAttribute("aria-label", label);
      wrap.append(make("span", label), node); parent.append(wrap); return node;
    }
    function button(parent, label, callback, mutation = false, recovery = false) {
      const b = make("button", label); b.type = "button";
      if (mutation) b.dataset.mutation = "true";
      if (recovery) b.dataset.recovery = "true";
      b.addEventListener("click", () => { if (!b.disabled) run(callback, mutation, recovery); }); parent.append(b); return b;
    }
    function options(select, entries) {
      const previous = select.value; select.replaceChildren();
      const empty = make("option", "Выберите запись"); empty.value = ""; select.append(empty);
      for (const [id, label] of entries) { const option = make("option", label); option.value = id; select.append(option); }
      if (entries.some(([id]) => id === previous)) select.value = previous;
    }
    function scope() {
      if (!uuid(context.workspaceId) || !uuid(area.value)) throw new Error("Выберите пространство и участок.");
      return new URLSearchParams({ workspaceId: context.workspaceId, areaId: area.value }).toString();
    }
    function message(text) { status.textContent = text; }
    function contextKey(value) {
      return JSON.stringify([value.accountId || "", value.actorId || "", value.workspaceId || "", value.areaId || "",
        value.permissionEpoch ?? "", value.roles || [], value.memberships || [], value.areas || []]);
    }
    function updateControls() {
      const signed = uuid(context.accountId), locked = preparing || Boolean(pending);
      root.setAttribute("aria-busy", String(Boolean(busy)));
      for (const node of root.querySelectorAll("button,input,select,textarea")) {
        node.disabled = !signed || Boolean(busy) || externalBusy || node.dataset.unavailable === "true" ||
          (Boolean(pending) && node.dataset.recovery !== "true") || (externalLock && node.dataset.mutation === "true");
      }
      if (locked !== publishedLock) { publishedLock = locked; onMutationLock(locked); }
    }
    function renderReceipt() {
      receipt.hidden = !pending && !clearedUnknown;
      retry.hidden = !pending;
      receiptText.textContent = pending
        ? "Результат сохранения неизвестен. Повторите ту же операцию кнопкой ниже. Не закрывайте страницу до подтверждения."
        : clearedUnknown ? "Рабочая область изменена. Данные для повтора удалены. Проверьте результат прежней отправки перед новой операцией." : "";
      updateControls();
    }
    async function run(fn, mutation = false, recovery = false) {
      if (busy || externalBusy || !uuid(context.accountId) || (pending && !recovery) || (mutation && externalLock)) return;
      const token = {}, generation = epoch; busy = token; preparing = mutation; updateControls();
      try { await fn(); }
      catch (error) {
        if (generation === epoch) {
          if (error.code === "контекст_изменено" || error.status === 401 || error.status === 403) reset();
          message(errors[error.code] || (pending ? "Результат записи не подтверждён. Используйте повтор той же операции." :
            error.status === 429 ? "Достигнут лимит запросов. Повторите позже." :
            error.status === 409 ? "Запись уже изменилась. Загрузите актуальные данные перед действием." :
            error.status === 401 ? "Сеанс завершён. Войдите снова." :
            error.status === 403 ? "Доступ больше не подтверждён. Закрытые данные очищены." :
            error.status ? "Запрос не завершён. Проверьте данные и обновите список." :
            error.message || "Ответ не получен. Повторите загрузку."));
          onError(error);
        }
      } finally { if (busy === token) { busy = null; preparing = false; updateControls(); } }
    }
    async function api(path, options = {}) {
      const controller = new AbortController(); controllers.add(controller);
      try { return await request(path, { ...options, signal: controller.signal }); }
      finally { controllers.delete(controller); }
    }
    async function write(path, body, confirmed) {
      if (externalLock || pending) throw new Error("Сначала подтвердите результат предыдущей операции.");
      if (contextKey(getContext()) !== contextKey(context)) throw Object.assign(new Error("Рабочая область изменилась. Обновите страницу."), { code: "контекст_изменено" });
      pending = { path, json: JSON.stringify(body), key: crypto.randomUUID(), generation: epoch,
        context: contextKey(context), confirmed, uncertain: false };
      renderReceipt(); await sendPending();
    }
    async function sendPending() {
      const command = pending;
      if (!command || externalLock || command.generation !== epoch) return;
      if (command.context !== contextKey(getContext())) throw Object.assign(new Error("Рабочая область изменилась. Обновите страницу."), { code: "контекст_изменено" });
      const generation = epoch;
      try {
        const result = await api(command.path, { method: "POST", body: JSON.parse(command.json), idempotencyKey: command.key });
        if (generation !== epoch || pending !== command) return;
        if (!result || typeof result !== "object" || Array.isArray(result) || !uuid(result.id)) {
          throw Object.assign(new Error("Ответ о записи не прошёл проверку."), { code: "некорректно_ответ" });
        }
        pending = null; clearedUnknown = false; renderReceipt(); command.confirmed(result);
      } catch (error) {
        if (generation !== epoch || pending !== command) throw error;
        const unknown = !error.status || error.status >= 500 || [408, 499].includes(error.status) || error.code === "некорректно_ответ";
        command.uncertain ||= unknown;
        if (!command.uncertain) pending = null;
        renderReceipt(); throw error;
      }
    }
    function pager(parent, select, path, label, changed, filter = () => true) {
      let cursor = "", more = false, rows = [], running = null;
      const bar = make("div", undefined, "sw-pager");
      const info = make("span", "Данные не загружены.");
      const first = button(bar, "Загрузить", () => load(true));
      const next = button(bar, "Показать ещё", () => load(false)); next.dataset.unavailable = "true";
      bar.append(info); parent.append(bar);
      async function load(replace) {
        if (running || (!replace && !more)) return;
        const generation = epoch, expectedCursor = replace ? "" : cursor, token = {}; running = token;
        try {
          const url = path();
          const result = await api(url + (url.includes("?") ? "&" : "?") + new URLSearchParams({ limit: "25", cursor: expectedCursor }));
          if (generation !== epoch) return;
          const page = Array.isArray(result) ? { items: result, hasMore: false, nextCursor: "" } : result;
          if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean" || typeof page.nextCursor !== "string" ||
              (page.hasMore && (!page.nextCursor || page.nextCursor === expectedCursor)) ||
              (!page.hasMore && page.nextCursor)) throw new Error("Сервер вернул некорректную страницу.");
          const merged = replace ? [] : [...rows], ids = new Set(merged.map(r => r.id));
          for (const row of page.items) {
            if (!row || !uuid(row.id) || ids.has(row.id)) throw new Error("Повторяющиеся или некорректные записи. Обновите список.");
            ids.add(row.id); merged.push(row);
          }
          rows = merged; cursor = page.nextCursor; more = page.hasMore;
          if (select) options(select, rows.filter(filter).map(row => [row.id, label(row)]));
          changed?.([...rows]); info.textContent = "Загружено: " + rows.length + (more ? ". Есть продолжение." : ". Список загружен.");
          next.dataset.unavailable = String(!more); updateControls();
        } finally { if (running === token) running = null; }
      }
      function clear() { cursor = ""; more = false; rows = []; running = null; next.dataset.unavailable = "true"; info.textContent = "Данные не загружены."; if (select) options(select, []); changed?.([]); }
      const handle = { load, clear, first, next, rows: () => [...rows] }; pagers.push(handle); return handle;
    }
    function renderRecords(target, rows, text) {
      target.replaceChildren();
      if (!rows.length) { target.append(make("p", "Записей в загруженной выборке нет.")); return; }
      const list = make("ul"); for (const row of rows) list.append(make("li", text(row))); target.append(list);
    }
    function renderSeries(target, rows) {
      target.replaceChildren();
      const sorted = [...rows].sort((a, b) => String(a.measuredAt).localeCompare(String(b.measuredAt)));
      if (!sorted.length) { target.append(make("p", "Принятых измерений в загруженной выборке нет.")); return; }
      if (sorted.some(r => !Number.isFinite(r.value) || !Number.isFinite(r.consumption))) throw new Error("Некорректный принятый ряд.");
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 640 180"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Принятые показания. Точные значения приведены в таблице.");
      const min = Math.min(...sorted.map(r => r.value)), max = Math.max(...sorted.map(r => r.value));
      const line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", sorted.map((r, i) => (24 + i * 592 / Math.max(1, sorted.length - 1)) + "," + (154 - (r.value - min) * 132 / Math.max(1, max - min))).join(" "));
      line.setAttribute("fill", "none"); line.setAttribute("stroke", "#225b86"); line.setAttribute("stroke-width", "2"); svg.append(line); target.append(svg);
      const table = make("table"), head = make("tr");
      ["Измерено", "Получено", "Принятое значение", "Расход", "Исходное значение"].forEach(t => head.append(make("th", t)));
      const thead = make("thead"); thead.append(head); table.append(thead); const tbody = make("tbody");
      for (const row of sorted) {
        const tr = make("tr");
        [stamp(row.measuredAt), stamp(row.receivedAt), String(row.value), String(row.consumption), String(row.originalValue) + " · " + stamp(row.originalMeasuredAt)].forEach(t => tr.append(make("td", t)));
        tbody.append(tr);
      }
      table.append(tbody); const scroll = make("div", undefined, "sw-table-scroll"); scroll.tabIndex = 0; scroll.append(table); target.append(scroll);
    }
    function refreshReviewOptions() {
      if (typeof candidate === "undefined") return;
      const items = state.corrections.filter(r => r.state === "Pending").map(r => ({
        id: r.id, readingId: r.readingId, correctionId: r.id, value: r.proposedValue, measuredAt: r.proposedMeasuredAt, label: "Исправление: " + stamp(r.proposedMeasuredAt) + " · " + r.proposedValue
      }));
      for (const row of state.readings.filter(r => r.state === "LateReview")) items.push({
        id: row.id, readingId: row.id, value: row.value, measuredAt: row.measuredAt, label: "Позднее: " + stamp(row.measuredAt) + " · " + row.value
      });
      candidate._rows = new Map(items.map(r => [r.id, r])); options(candidate, items.map(r => [r.id, r.label]));
    }
    function renderDeliveries(rows) {
      clearDeliverySelection();
      deliveries.replaceChildren();
      for (const row of rows) {
        const card = make("article", undefined, "sw-delivery");
        card.append(make("h4", row.address), make("p", (labels[row.state] || "Неизвестное состояние") + " · " + stamp(row.startAt) + " — " + stamp(row.endAt)));
        card.append(make("p", "Фактическое начало: " + stamp(row.actualStartAt) + ". Окончание: " + stamp(row.actualEndAt)));
        button(card, "Выбрать доставку", async () => {
          state.selectedDelivery = row; selectedText.textContent = row.address + " · " + (labels[row.state] || row.state);
          const actions = [];
          if (row.state === "Planned" && row.executorAccountId === context.accountId) actions.push(["start", "Начать доставку"]);
          if (row.state === "InProgress" && row.executorAccountId === context.accountId) actions.push(["complete", "Подтвердить доставку"]);
          if (row.state === "Planned" && (context.roles || []).includes("WaterOperator")) actions.push(["cancel", "Отменить запланированную доставку"]);
          options(action, actions); actionBox.scrollIntoView({ block: "nearest" });
        });
        deliveries.append(card);
      }
      if (!rows.length) deliveries.append(make("p", "Доставок в загруженной выборке нет."));
    }
    function clearMeter() {
      for (const page of [installPager, readingPager, acceptedPager, correctionPager, decisionPager]) page.clear();
      photo.value = ""; reviewReason.value = ""; proposedValue.value = ""; proposedDate.value = ""; correctionReason.value = "";
    }
    function clearDeliverySelection() {
      state.selectedDelivery = null; selectedText.textContent = "Выберите доставку в списке.";
      options(action, []); comment.value = "";
    }
    function invalidate() {
      if (pending) clearedUnknown = true;
      epoch++;
      for (const controller of controllers) controller.abort(); controllers.clear();
      for (const reader of readers) reader.abort(); readers.clear();
      busy = null; preparing = false; pending = null;
    }
    function clearData() {
      for (const page of pagers) page.clear();
      clearDeliverySelection();
      photo.value = ""; reviewReason.value = ""; proposedValue.value = ""; proposedDate.value = ""; correctionReason.value = "";
      address.value = ""; startAt.value = ""; endAt.value = "";
      candidate._rows = new Map(); options(candidate, []); options(correctionTarget, []);
    }
    function reset() {
      invalidate(); context = {}; clearData(); options(area, []);
      reviewForm.hidden = true; createDelivery.hidden = true;
      renderReceipt();
      message("Выберите рабочее пространство и участок.");
    }
    function setContext(next) {
      next = next || {};
      const oldArea = area.value;
      if (contextKey(next) === contextKey(context)) return;
      reset(); context = JSON.parse(JSON.stringify(next));
      options(area, (context.areas || []).filter(a => a.workspaceId === context.workspaceId && a.state === "Active").map(a => [a.id, a.name]));
      if ([...area.options].some(o => o.value === context.areaId)) area.value = context.areaId;
      else if ([...area.options].some(o => o.value === oldArea)) area.value = oldArea;
      const staff = (context.roles || []).includes("BillingSpecialist"), operator = (context.roles || []).includes("WaterOperator");
      reviewForm.hidden = !staff; createDelivery.hidden = !operator;
      meterStaff.value = staff ? "staff" : "mine"; deliveryMode.value = operator ? "staff" : "mine";
      updateControls();
      message("Данные не загружаются автоматически. Выберите раздел и нажмите «Загрузить».");
    }
    function selectionChanged(clear) { invalidate(); clear(); renderReceipt(); }
    area.addEventListener("change", () => selectionChanged(clearData));
    meterStaff.addEventListener("change", () => selectionChanged(() => { accountPager.clear(); clearMeter(); }));
    account.addEventListener("change", () => selectionChanged(clearMeter));
    installation.addEventListener("change", () => selectionChanged(() => {
      for (const page of [readingPager, acceptedPager, correctionPager, decisionPager]) page.clear();
      photo.value = ""; reviewReason.value = ""; proposedValue.value = ""; proposedDate.value = ""; correctionReason.value = "";
    }));
    reading.addEventListener("change", () => selectionChanged(() => { photo.value = ""; }));
    deliveryMode.addEventListener("change", () => selectionChanged(() => { deliveryPager.clear(); clearDeliverySelection(); }));
    function setExternalBusy(value) { externalBusy = Boolean(value); updateControls(); }
    function setExternalMutationLock(value) { externalLock = Boolean(value); updateControls(); }
    reset();
    return Object.freeze({ setContext, reset, setExternalBusy, setExternalMutationLock, destroy: () => { reset(); root.replaceChildren(); } });
  }
  window.VodokanalSubscriberWater = Object.freeze({ create });
})();
