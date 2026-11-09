
(function (global) {
  "use strict";
  
  const DispatchNetworkView = (() => {
    "use strict";
    const BOX = Object.freeze({ width: 288, height: 116, gap: 12, hit: 48 });
    const mounted = new WeakMap();
    const finiteCoordinate = value => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : 500;
    };
    const intersects = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
    function wrapName(value, columns = 25, maxLines = 3) {
      const chars = Array.from(String(value || "Без названия").replace(/\s+/g, " ").trim());
      const lines = [];
      while (chars.length && lines.length < maxLines) {
        let count = Math.min(columns, chars.length);
        if (chars.length > count) {
          const space = chars.slice(0, count).lastIndexOf(" ");
          if (space >= Math.floor(columns / 2)) count = space;
        }
        lines.push(chars.splice(0, count).join("").trim());
        while (chars[0] === " ") chars.shift();
      }
      if (chars.length) lines[lines.length - 1] = Array.from(lines.at(-1)).slice(0, columns - 1).join("") + "…";
      return lines;
    }
    function layout(rows) {
      if (!Array.isArray(rows) || rows.length > 100) throw new Error("сеть_страница_лимит");
      const seen = new Set();
      const nodes = rows.map((row, index) => {
        if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id)) throw new Error("сеть_дубликат_или_отсутствует_идентификатор");
        seen.add(row.id);
        const original = { x: finiteCoordinate(row.x) + 400, y: finiteCoordinate(row.y) + 400 };
        return { id: row.id, index: index + 1, row, original, x: original.x, y: original.y };
      });
      const placed = [];
      for (const node of nodes) {
        let found = false;
        for (let ring = 0; ring <= 12 && !found; ring++) {
          for (let dy = -ring; dy <= ring && !found; dy++) for (let dx = -ring; dx <= ring && !found; dx++) {
            if (ring && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const x = node.original.x + dx * 64, y = node.original.y + dy * 64;
            if (!placed.some(p => Math.abs(p.x - x) < 60 && Math.abs(p.y - y) < 60)) {
              node.x = x; node.y = y; found = true;
            }
          }
        }
        if (!found) throw new Error("сеть_маркер_структура_исчерпано");
        placed.push(node);
      }
      const obstacles = nodes.map(n => ({ x: n.x - 28, y: n.y - 28, width: 56, height: 56 }));
      const labels = [];
      const directions = [[1,-1],[1,0],[1,1],[-1,-1],[-1,0],[-1,1],[0,-1],[0,1]];
      for (const node of nodes) {
        let box;
        for (let ring = 0; ring < 8 && !box; ring++) for (const [dx, dy] of directions) {
          const distance = 40 + ring * 148;
          const x = dx > 0 ? node.x + distance : dx < 0 ? node.x - distance - BOX.width : node.x - BOX.width / 2;
          const y = dy > 0 ? node.y + distance : dy < 0 ? node.y - distance - BOX.height : node.y - BOX.height / 2;
          const candidate = { x, y, width: BOX.width, height: BOX.height };
          if (!obstacles.some(o => intersects(candidate, o, BOX.gap)) && !labels.some(o => intersects(candidate, o, BOX.gap))) { box = candidate; break; }
        }
        if (!box) {
          const x = Math.max(...obstacles.map(o => o.x + o.width)) + 80;
          let y = 0;
          while (labels.some(o => intersects({ x, y, width: BOX.width, height: BOX.height }, o, BOX.gap))) y += BOX.height + BOX.gap;
          box = { x, y, width: BOX.width, height: BOX.height };
        }
        node.label = box;
        labels.push(box);
      }
      const all = [...obstacles, ...labels];
      const minX = Math.min(0, ...all.map(o => o.x)) - 32, minY = Math.min(0, ...all.map(o => o.y)) - 32;
      const maxX = Math.max(560, ...all.map(o => o.x + o.width)) + 32, maxY = Math.max(360, ...all.map(o => o.y + o.height)) + 32;
      for (const node of nodes) {
        node.x -= minX; node.y -= minY;
        node.label.x -= minX; node.label.y -= minY;
      }
      return { nodes, width: maxX - minX, height: maxY - minY, visuallySeparated: nodes.some(n => n.x + minX !== n.original.x || n.y + minY !== n.original.y) };
    }
    function mount(options) {
      const { doc, rows } = options;
      if (!Array.isArray(rows)) throw new Error("сеть_строки_некорректно");
      const ids = new Set();
      for (const row of rows) {
        if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error("сеть_дубликат_или_отсутствует_идентификатор");
        ids.add(row.id);
      }
      const root = doc.createElement("section");
      root.className = "dispatch-network-view";
      function render(pageIndex, selectedId, restoreFocus = false) {
        const count = Math.max(1, Math.ceil(rows.length / 100));
        const page = Math.max(0, Math.min(count - 1, pageIndex));
        const offset = page * 100;
        const fragment = renderWindow({ ...options, rows: rows.slice(offset, offset + 100), allRows: rows, offset, selectedId,
          onPage: next => render(next, undefined, "page"),
          onCrossSelect: index => render(Math.floor(index / 100), rows[index].id, true) });
        root.replaceChildren(fragment);
        mounted.set(root, () => mounted.get(fragment)?.());
        const focusTargets = mounted.get(fragment)?.();
        if (restoreFocus === "page") focusTargets?.pageButton?.focus?.({ preventScroll: true });
        else if (restoreFocus) focusTargets?.selectedButton?.focus?.({ preventScroll: true });
      }
      render(0);
      return root;
    }
    function renderWindow({ doc, rows, allRows, offset, selectedId, onPage, onCrossSelect, links = [], incidents = [], stateLabel = x => x, typeLabel = x => x }) {
      const model = layout(rows);
      for (const node of model.nodes) node.index += offset;
      const el = (tag, text, cls) => {
        const n = doc.createElement(tag);
        if (text !== undefined) n.textContent = text;
        if (cls) n.className = cls;
        return n;
      };
      const svgEl = (tag, attrs = {}, text) => {
        const n = doc.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
        if (text !== undefined) n.textContent = text;
        return n;
      };
      const root = el("section", undefined, "dispatch-network-fragment");
      root.append(el("h3", "Схема сети"), el("p", "Только загруженные объекты. Координаты условные: это не географическая карта и не управление оборудованием.", "dispatch-hint"));
      if (!rows.length) {
        root.append(el("p", "На этой странице нет объектов сети. Измените фильтры или добавьте объект.", "dispatch-network-empty"));
        return root;
      }
      const pageIndex = Math.floor(offset / 100), pageCount = Math.ceil(allRows.length / 100);
      const paging = el("nav", undefined, "dispatch-network-pages");
      paging.setAttribute("aria-label", "Фрагменты схемы, только уже загруженные объекты");
      const previous = el("button", "Предыдущие объекты"), next = el("button", "Следующие объекты");
      previous.type = next.type = "button";
      previous.disabled = pageIndex === 0; next.disabled = pageIndex + 1 === pageCount;
      previous.dataset.unavailable = String(previous.disabled); next.dataset.unavailable = String(next.disabled);
      previous.addEventListener("click", () => { if (pageIndex > 0) onPage(pageIndex - 1); });
      next.addEventListener("click", () => { if (pageIndex + 1 < pageCount) onPage(pageIndex + 1); });
      const pageCaption = el("p", `На схеме: объекты ${offset + 1}–${offset + rows.length} из ${allRows.length} загруженных. Фрагмент ${pageIndex + 1} из ${pageCount}. Полный список ниже; выбор объекта открывает его фрагмент.`, "dispatch-hint");
      pageCaption.setAttribute("role", "status");
      paging.append(previous, next, pageCaption);
      root.append(paging);
      const toolbar = el("div", undefined, "dispatch-network-tools");
      const status = el("output", "Масштаб 100%", "dispatch-network-scale");
      status.setAttribute("aria-live", "polite");
      const viewport = el("div", undefined, "dispatch-network-viewport");
      viewport.tabIndex = 0;
      viewport.setAttribute("role", "region");
      viewport.setAttribute("aria-label", "Схема сети. Стрелки перемещают вид; Tab переходит к объектам. Полные названия доступны в списке под схемой.");
      const svg = svgEl("svg", { viewBox: `0 0 ${model.width} ${model.height}`, width: model.width, height: model.height, "aria-label": "Объекты и связи загруженной страницы сети", role: "group" });
      svg.classList.add("dispatch-network-canvas");
      const edges = svgEl("g", { "data-network-layer": "edges" }), leaders = svgEl("g", { "data-network-layer": "leaders" }), labels = svgEl("g", { "data-network-layer": "labels" }), markers = svgEl("g", { "data-network-layer": "markers" });
      svg.append(edges, leaders, labels, markers);
      const nodes = new Map(model.nodes.map(n => [n.id, n]));
      let skippedLinks = 0;
      for (const link of links) {
        const a = nodes.get(link.fromId), b = nodes.get(link.toId);
        if (!a || !b) { skippedLinks++; continue; }
        edges.append(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: link.state === "Fault" ? "network-edge fault" : "network-edge", "aria-hidden": "true" }));
      }
      const detail = el("section", undefined, "dispatch-network-selection");
      detail.setAttribute("aria-label", "Выбранный объект сети");
      const list = el("ol", undefined, "dispatch-network-object-list");
      const heading = el("h4", `Все загруженные объекты (${allRows.length})`);
      const selections = [];
      const listButtons = new Map();
      let selected = model.nodes.find(n => n.id === selectedId) || model.nodes[0], zoom = 1;
      function scrollToNode(node) {
        const x = Math.max(0, (node.x - 80) * zoom), y = Math.max(0, (node.y - 80) * zoom);
        viewport.scrollLeft = x; viewport.scrollTop = y;
      }
      function choose(node, reveal = false) {
        selected = node;
        for (const s of selections) {
          s.marker.setAttribute("aria-pressed", String(s.node === node));
        }
        for (const [id, button] of listButtons) button.setAttribute("aria-current", String(id === node.id));
        detail.replaceChildren(el("h4", `${node.index}. ${node.row.name || "Без названия"}`), el("p", `${typeLabel(node.row.type)} · ${stateLabel(node.row.state)}`), el("p", node.row.address || "Адрес не указан"));
        if (incidents.some(i => i.networkAssetId === node.id && i.state === "Open")) detail.append(el("p", "Есть открытый инцидент. Подробности доступны в разделе «Инциденты»."));
        if (reveal) scrollToNode(node);
      }
      function control(text, fn, title) {
        const b = el("button", text); b.type = "button";
        if (title) b.setAttribute("aria-label", title);
        b.addEventListener("click", fn); toolbar.append(b); return b;
      }
      const decrease = control("−", () => setZoom(zoom - .25), "Уменьшить схему, не меньше 100 процентов");
      const increase = control("+", () => setZoom(zoom + .25), "Увеличить схему");
      control("100%", () => setZoom(1), "Вернуть читаемый масштаб 100 процентов");
      control("К выбранному объекту", () => scrollToNode(selected));
      toolbar.append(status);
      function setZoom(value) {
        const next = Math.max(1, Math.min(2, value));
        const cx = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom, cy = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
        zoom = next;
        svg.setAttribute("width", String(model.width * zoom)); svg.setAttribute("height", String(model.height * zoom));
        viewport.scrollLeft = Math.max(0, cx * zoom - viewport.clientWidth / 2); viewport.scrollTop = Math.max(0, cy * zoom - viewport.clientHeight / 2);
        status.textContent = `Масштаб ${Math.round(zoom * 100)}%`;
        decrease.disabled = zoom === 1; increase.disabled = zoom === 2;
        decrease.dataset.unavailable = String(zoom === 1); increase.dataset.unavailable = String(zoom === 2);
      }
      for (const node of model.nodes) {
        const incident = incidents.some(i => i.networkAssetId === node.id && i.state === "Open");
        const box = node.label;
        leaders.append(svgEl("line", { x1: node.x, y1: node.y, x2: Math.max(box.x, Math.min(node.x, box.x + box.width)), y2: Math.max(box.y, Math.min(node.y, box.y + box.height)), class: "network-label-leader", "aria-hidden": "true" }));
        const label = svgEl("g", { class: "network-label", "aria-hidden": "true" });
        label.append(svgEl("rect", { x: box.x, y: box.y, width: box.width, height: box.height, rx: 4 }));
        const lines = wrapName(`${node.index}. ${node.row.name || "Без названия"}`);
        lines.forEach((line, i) => label.append(svgEl("text", { x: box.x + 12, y: box.y + 23 + 20 * i }, line)));
        const stateLines = wrapName(`${stateLabel(node.row.state)}${incident ? " · Инцидент" : ""}`, 28, 2);
        stateLines.forEach((line, i) => label.append(svgEl("text", { x: box.x + 12, y: box.y + 83 + 20 * i, class: "network-label-state" }, line)));
        labels.append(label);
        const marker = svgEl("g", { role: "button", tabindex: 0, "data-network-node": "true", "aria-pressed": "false", "aria-label": `${node.index}. ${node.row.name || "Без названия"}. ${stateLabel(node.row.state)}${incident ? ". Открытый инцидент" : ""}`, class: "network-node", "data-state": node.row.state });
        marker.append(svgEl("title", {}, `${node.row.name || "Без названия"} · ${stateLabel(node.row.state)}`), svgEl("rect", { x: node.x - 24, y: node.y - 24, width: 48, height: 48, rx: 8 }), svgEl("text", { x: node.x, y: node.y + 6, "text-anchor": "middle", "aria-hidden": "true" }, String(node.index)));
        marker.addEventListener("click", () => choose(node));
        marker.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(node); } });
        marker.addEventListener("focus", () => choose(node));
        markers.append(marker);
        selections.push({ node, marker });
      }
      for (const [index, row] of allRows.entries()) {
        const incident = incidents.some(i => i.networkAssetId === row.id && i.state === "Open");
        const item = el("li"), b = el("button", `${row.name || "Без названия"} · ${stateLabel(row.state)}${incident ? " · Есть инцидент" : ""}`);
        b.type = "button";
        b.addEventListener("click", () => { const node = nodes.get(row.id); if (node) choose(node, true); else onCrossSelect(index); });
        item.append(b); list.append(item); listButtons.set(row.id, b);
      }
      viewport.append(svg);
      viewport.addEventListener("keydown", event => {
        if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
        const delta = { ArrowLeft: [-100,0], ArrowRight: [100,0], ArrowUp: [0,-100], ArrowDown: [0,100] }[event.key];
        if (delta) { event.preventDefault(); viewport.scrollLeft = Math.max(0, viewport.scrollLeft + delta[0]); viewport.scrollTop = Math.max(0, viewport.scrollTop + delta[1]); }
      });
      let drag = null;
      viewport.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch" || event.button !== 0 || event.target.closest?.("[data-network-node]")) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture?.(event.pointerId);
      });
      viewport.addEventListener("pointermove", event => {
        if (drag?.id !== event.pointerId) return;
        viewport.scrollLeft = Math.max(0, drag.left + drag.x - event.clientX); viewport.scrollTop = Math.max(0, drag.top + drag.y - event.clientY);
      });
      const endDrag = event => { if (drag?.id === event.pointerId) drag = null; };
      viewport.addEventListener("pointerup", endDrag); viewport.addEventListener("pointercancel", endDrag); viewport.addEventListener("lostpointercapture", endDrag);
      const hint = el("p", "Перемещайте схему пальцем, мышью или стрелками с клавиатуры. Полные названия — под схемой.", "dispatch-hint");
      if (model.visuallySeparated) root.append(el("p", "Совпадающие точки разнесены только для чтения. Исходные координаты объектов не изменены.", "dispatch-hint"));
      if (skippedLinks) root.append(el("p", `Связей с объектами вне видимого фрагмента: ${skippedLinks}. Они не показаны; другие фрагменты и раздел «Связи сети» доступны отдельно. Список связей тоже может быть загружен не полностью.`, "dispatch-hint"));
      root.append(toolbar, hint, viewport, detail, heading, list);
      setZoom(1); choose(selected, true);
      mounted.set(root, () => { scrollToNode(selected); return { selectedButton: listButtons.get(selected.id), pageButton: previous.disabled ? next : previous }; });
      return root;
    }
    const activate = root => { mounted.get(root)?.(); };
    return Object.freeze({ layout, wrapName, intersects, mount, activate, BOX });
  })();
  
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CATEGORIES={Leak:"Утечка",NoWater:"Нет воды",Pressure:"Давление",Sewer:"Канализация",Manhole:"Опасный люк",Quality:"Качество воды",Billing:"Расчёты",Other:"Другое"};
  const STATES={Submitted:"Отправлено",Accepted:"Принято",AwaitingInfo:"Ожидает уточнения",Rejected:"Отклонено",Resolved:"Решено",Open:"Открыт",Planned:"Запланировано",Active:"Действует",Restored:"Восстановлено",Fault:"Неисправен",Maintenance:"На обслуживании",Retired:"Выведен из эксплуатации"};
  const PRIORITIES={Low:"Низкий",Normal:"Обычный",High:"Высокий",Critical:"Критический"};
  const TYPES={Pipe:"Трубопровод",Valve:"Задвижка",Well:"Колодец",Pump:"Насос",Reservoir:"Резервуар",Hydrant:"Гидрант",Other:"Другой объект"};
  const SEVERITY={Minor:"Незначительная",Moderate:"Средняя",Major:"Высокая",Critical:"Критическая"};
  const INCIDENT_TYPES={Leak:"Утечка",Supply:"Водоснабжение",Sewer:"Канализация",Other:"Другое"};
  const WORK_STATES={Draft:"Черновик",Assigned:"Назначен",Accepted:"Принят бригадой",InProgress:"В работе",Paused:"Приостановлен",Reported:"Отчёт представлен",Verified:"Результат принят",Closed:"Закрыт",Cancelled:"Отменён",Submitted:"Передан на проверку",Completed:"Завершён",Rework:"Доработка"};
  const MIME={pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",txt:"text/plain",csv:"text/csv"};
  const label=(map,value)=>map[value]||value||"Не указано";
  const time=value=>!value||value.startsWith("0001-")?"Не зафиксировано":value.replace("T"," ").replace(/Z$/,"")+" UTC";
  const invalid=()=>Object.assign(new Error("некорректно_ответ"),{code:"некорректно_ответ"});
  function object(v){if(!v||typeof v!=="object"||Array.isArray(v))throw invalid();return v;}
  function uuid(v){if(typeof v!=="string"||!UUID.test(v))throw invalid();return v;}
  function list(v,max=200){if(!Array.isArray(v)||v.length>max)throw invalid();return v;}
  function row(v){object(v);uuid(v.id);if(!Number.isInteger(v.revision)||v.revision<1)throw invalid();return v;}
  function page(v){object(v);list(v.items,100);if(!Number.isInteger(v.limit)||v.limit<1||v.limit>100||v.items.length>v.limit||typeof v.hasMore!=="boolean"||typeof v.nextCursor!=="string"||v.nextCursor.length>1024||v.hasMore!==!!v.nextCursor)throw invalid();return v;}
  function crewHistoryRow(v,profile){
    object(v);const keys=(x,n)=>{object(x);if(Object.keys(x).sort().join(",")!==n.split(",").sort().join(","))throw invalid();};
    keys(v,"revision,operation,reason,changedAt,actorAccountId,before,after");uuid(v.actorAccountId);
    if(!Number.isInteger(v.revision)||v.revision<1||v.revision>profile.revision||!["crew.create","crew.profile"].includes(v.operation)||typeof v.reason!=="string"||v.reason.length>250||typeof v.changedAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v.changedAt)||!Number.isFinite(Date.parse(v.changedAt)))throw invalid();
    const common="id,workspaceId,areaId,name,state,revision,createdBy,createdAt,updatedAt,leaderAccountId";
    const snapshot=(s,empty=false)=>{object(s);if(empty&&Object.keys(s).length===0)return;keys(s,common+(v.operation==="crew.profile"?",skills,shiftFrom,shiftTo":""));row(s);uuid(s.createdBy);uuid(s.leaderAccountId);if(s.id!==profile.id||s.workspaceId!==profile.workspaceId||s.areaId!==profile.areaId||typeof s.name!=="string"||s.name.length>150||!["Active","Inactive"].includes(s.state))throw invalid();if(v.operation==="crew.profile"){if(list(s.skills,20).some(x=>typeof x!=="string"||x.length>100)||typeof s.shiftFrom!=="string"||typeof s.shiftTo!=="string")throw invalid();}};
    snapshot(v.before,v.operation==="crew.create");snapshot(v.after);
    if(v.after.revision!==v.revision||v.operation==="crew.create"&&(v.revision!==1||Object.keys(v.before).length)||v.operation==="crew.profile"&&v.before.revision!==v.revision-1)throw invalid();
    return v;
  }
  function authorshipPage(v,expected,previousRevision,previousCursor){
    const fields=(x,n)=>{if(!x||typeof x!=="object"||Array.isArray(x)||Object.keys(x).sort().join(",")!==n.split(",").sort().join(","))throw invalid();};
    const isId=x=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
    const operations={Resource:["resource.create"],Member:["crew.leader.roster","crew.member"],intakes:["intake.create","intake.configure"],network:["network.save"],networkLinks:["network.link"],outages:["outage.save","outage.publish"]};
    fields(v,"kind,objectId,workspaceId,areaId,createdBy,currentRevision,items,limit,hasMore,nextCursor");
    if(!Object.hasOwn(operations,expected.kind)||v.kind!==expected.kind||v.objectId!==expected.id||v.workspaceId!==expected.workspaceId||v.areaId!==expected.areaId||v.createdBy!==expected.createdBy||!isId(v.createdBy)||!Number.isSafeInteger(v.currentRevision)||v.currentRevision!==expected.revision||v.limit!==25||!Array.isArray(v.items)||v.items.length>25||typeof v.hasMore!=="boolean"||typeof v.nextCursor!=="string"||v.nextCursor.length>256||v.hasMore&&(v.items.length!==25||!v.nextCursor||v.nextCursor===previousCursor)||!v.hasMore&&v.nextCursor)throw invalid();
    let last=previousRevision;
    for(const h of v.items){fields(h,"revision,operation,changedAt,actorAccountId");if(!Number.isSafeInteger(h.revision)||h.revision<1||h.revision>=last||h.revision>v.currentRevision||!operations[v.kind].includes(h.operation)||!isId(h.actorAccountId)||typeof h.changedAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(h.changedAt)||!Number.isFinite(Date.parse(h.changedAt)))throw invalid();last=h.revision;}
    return v;
  }
  function errorText(e){
    const messages={кабинет_диспетчерская_прием_закрыто:"Приём обращений в этом центре закрыт.",кабинет_диспетчерская_необслуживаемо_адрес_или_категория:"Центр не обслуживает выбранный адрес или категорию.",кабинет_диспетчерская_квитанция_не_найдено:"Квитанция не найдена или секрет не совпадает.",кабинет_диспетчерская_редакция_конфликт:"Запись изменена другим участником. Обновите её перед повторной отправкой.",кабинет_диспетчерская_связь_конфликт:"Связь изменилась. Обновите обе карточки.",кабинет_диспетчерская_некорректно_даты:"Проверьте даты и плановый интервал.",кабинет_диспетчерская_квота_превышено:"Лимит обращений исчерпан. Повторите позже.",кабинет_наряд_незавершено_задачи:"Остались незавершённые обязательные наряды.",кабинет_наряд_смена_конфликт:"Смена не охватывает уже назначенные наряды.",некорректно_ответ:"Не удалось подтвердить корректность ответа. Обновите сведения."};
    return messages[e?.code]||({401:"Сеанс завершён. Войдите снова.",403:"Нет доступа к этой операции или участку.",404:"Запись не найдена или недоступна.",409:"Данные изменились или операция недопустима в текущем состоянии.",413:"Файл превышает допустимый размер.",429:"Слишком много запросов. Повторите позже."}[e?.status])||(e?.status===400?"Проверьте заполнение полей.":"Не удалось получить ответ сервера.");
  }
  function create({root,request,requestBinary,onSessionError=()=>{},onMutationLock=()=>{}}){
    if(!root||typeof request!=="function")throw new Error("Нужны корневой элемент и транспорт диспетчерской");
    const doc=root.ownerDocument,controllers=new Set(),urls=new Set();
    let context={},areaId="",tab="myRequests",generation=0,busy=false,externalBusy=false,externalLock=false,command=null,current=null,currentStaff=false,currentPage=null,rows=[],filters={},history=null,files=null,lookupState=null;
    root.classList.add("dispatch-ui");
    const el=(tag,text="",cls="")=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    const heading=el("h2","Обращения и диспетчерская"),nav=el("nav","","dispatch-tabs"),scope=el("div","","dispatch-toolbar"),status=el("p","","dispatch-status"),receipt=el("section","","dispatch-receipt"),body=el("div"),forms=el("div");
    status.setAttribute("role","status");status.setAttribute("aria-live","polite");receipt.setAttribute("aria-live","polite");nav.setAttribute("aria-label","Разделы диспетчерской");
    root.replaceChildren(heading,el("p","Обращения, инциденты и плановые работы.","dispatch-notice"),nav,scope,status,receipt,body,forms);
    function button(text,fn,mutation=false){const b=el("button",text);b.type="button";if(mutation)b.dataset.mutation="true";b.addEventListener("click",()=>{if(!b.disabled)Promise.resolve().then(fn).catch(e=>notice(e.status?errorText(e):e.message||errorText(e),true));});return b;}
    function notice(text,error=false){status.textContent=text;status.classList.toggle("dispatch-error",error);}
    function signed(){return !!context.accountId&&!!context.actorId;}
    function dispatcher(){return (context.dispatcherAreaIds||[]).includes(areaId);}
    function owner(){return (context.ownerAreaIds||[]).includes(areaId);}
    function locked(){return !!command;}
    function controls(){root.setAttribute("aria-busy",String(busy));for(const n of root.querySelectorAll("button,input,textarea,select"))n.disabled=!signed()||busy||externalBusy||locked()||n.dataset.unavailable==="true"||(externalLock&&n.dataset.mutation==="true");for(const n of receipt.querySelectorAll("button"))n.disabled=busy||externalBusy||externalLock||!signed();}
    function clear(){generation++;controllers.forEach(c=>c.abort());controllers.clear();urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();busy=false;command=null;onMutationLock(false);current=currentPage=history=files=lookupState=null;rows=[];forms.replaceChildren();receipt.replaceChildren();}
    function reset(){clear();context={};areaId="";render();notice("Войдите, чтобы работать с обращениями.");}
    function syncContext(value){const next=JSON.parse(JSON.stringify(value||{}));if(JSON.stringify(next)===JSON.stringify(context))return;const unresolved=!!command;clear();context=next;const areas=context.areas||[];areaId=areas.some(a=>a.id===areaId)?areaId:(areas.length===1?areas[0].id:"");render();notice(unresolved?"Участок изменён. Проверьте результат отправки в прежнем участке.":"Участок изменён. Обновите данные.");}
    async function api(path,options={}){const ctl=new AbortController();controllers.add(ctl);let timer;try{return await Promise.race([request(path,{...options,signal:ctl.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{ctl.abort();reject(Object.assign(new Error("Превышено время ожидания"),{code:"таймаут_ошибка"}));},20000);})]);}finally{clearTimeout(timer);controllers.delete(ctl);}}
    async function read(fn){if(busy||externalBusy||locked()||!signed())return;const stamp=generation;busy=true;controls();try{await fn(()=>stamp===generation);}catch(e){if(stamp!==generation)return;if([401,403].includes(e.status)){clear();render();onSessionError(e);}notice(errorText(e),true);}finally{if(stamp===generation){busy=false;controls();}}}
    function scopeParams(){if(!areaId||!context.workspaceId)throw new Error("Выберите область и участок.");return {workspaceId:context.workspaceId,areaId};}
    function query(values){const q=new URLSearchParams();for(const[k,v]of Object.entries(values))if(v!==""&&v!==undefined)q.set(k,String(v));return q.toString().replace(/\+/g,"%20");}
    function table(headers,data,renderRow){const wrap=el("div","","dispatch-table-scroll"),t=el("table"),head=el("thead"),tr=el("tr");headers.forEach(h=>tr.append(el("th",h)));head.append(tr);const tbody=el("tbody");data.forEach(x=>{const r=el("tr");renderRow(x).forEach(c=>{const td=el("td");if(c instanceof Node)td.append(c);else td.textContent=String(c??"");r.append(td);});tbody.append(r);});t.append(head,tbody);wrap.append(t);return wrap;}
    function details(parent,pairs){const dl=el("dl","","dispatch-details");for(const[k,v]of pairs)dl.append(el("dt",k),el("dd",String(v??"")));parent.append(dl);}
    function field(parent,name,caption,type="text",value="",choices=null,required=true,max=250){const wrap=el("div","","dispatch-field"),id="dispatch-"+name+"-"+crypto.randomUUID(),labelNode=el("label",caption),input=el(type==="textarea"?"textarea":choices?"select":"input");input.id=id;input.name=name;labelNode.htmlFor=id;if(!choices&&type!=="textarea")input.type=type;if(choices){if(type!=="multiselect")input.append(new Option("Выберите…",""));for(const[k,v]of Object.entries(choices))input.append(new Option(v,k));}if(type==="multiselect"){input.multiple=true;input.size=Math.min(8,Object.keys(choices).length);for(const o of input.options)o.selected=Array.isArray(value)&&value.includes(o.value);}else if(type==="checkbox")input.checked=!!value;else if(type!=="file")input.value=String(value??"");input.required=required&&type!=="checkbox";input.maxLength=max;if(type==="number")input.step="1";if(type==="datetime-local")input.step="1";wrap.append(labelNode,input);parent.append(wrap);return input;}
    function form(title,spec,submit,labelText="Проверить и отправить"){
      forms.replaceChildren();const f=el("form","","dispatch-form"),h=el("h3",title),fields={};f.append(h);for(const s of spec){fields[s.name]=field(f,s.name,s.label,s.type||"text",s.value??"",s.choices||null,s.required!==false,s.max||250);if(s.hint)f.append(el("p",s.hint,"dispatch-hint"));}
      const actions=el("div","","dispatch-actions"),save=el("button",labelText);save.type="submit";save.dataset.mutation="true";actions.append(save,button("Отмена",()=>{if(!locked())forms.replaceChildren();}));f.append(actions);f.addEventListener("submit",async e=>{e.preventDefault();if(busy||externalBusy||externalLock||locked()||!f.reportValidity())return;try{const values={};for(const s of spec){const input=fields[s.name];values[s.name]=s.type==="multiselect"?Array.from(input.selectedOptions,o=>o.value):s.type==="checkbox"?input.checked:s.type==="number"?Number(input.value):input.value.trim();}await submit(values,fields);}catch(error){notice(error.message||errorText(error),true);}});forms.append(f);h.tabIndex=-1;h.focus();controls();return {f,fields};
    }
    function dateValue(value){return value&&!value.startsWith("0001-")?value.replace(/Z$/,"").slice(0,19):"";}
    function utc(value){if(!value)return "";const text=value.length===16?value+":00":value;if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(text)||!Number.isFinite(Date.parse(text+"Z")))throw new Error("Укажите корректную дату и время UTC.");return text+"Z";}
    const dateField=(name,text,value="",required=true)=>({name,label:text+" (UTC)",type:"datetime-local",value:dateValue(value),required});
    function lines(value,max=30){const a=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(a.length>max)throw new Error("Слишком много строк.");return [...new Set(a)];}
    function prepare(path,data,message,after){if(externalLock||locked())return;const frozen=JSON.parse(JSON.stringify(data));forms.replaceChildren();const panel=el("section","","dispatch-confirm");panel.append(el("h3","Подтвердите действие"),el("p",message),button("Подтверждаю",()=>{command={path,body:frozen,key:crypto.randomUUID(),after,phase:"sending",everUnknown:false};onMutationLock(true);forms.replaceChildren();return send();},true),button("Не отправлять",()=>forms.replaceChildren()));forms.append(panel);controls();}
    function renderReceipt(){receipt.replaceChildren();if(!command)return;const unknown=command.phase==="unknown";receipt.append(el("h3",unknown?"Исход операции пока неизвестен":"Операция выполняется"),el("p",unknown?"Не создавайте новую команду. Повтор использует те же данные и тот же ключ, чтобы не получить дубликат.":"Дождитесь подтверждения сервера."));if(unknown)receipt.append(button("Повторить ту же команду",send));controls();}
    async function send(){if(!command||busy||externalBusy||externalLock)return;const c=command,stamp=generation;busy=true;c.phase="sending";renderReceipt();try{const result=await api(c.path,{method:"POST",body:c.body,headers:{"Idempotency-Key":c.key}});if(stamp!==generation)return;object(result);command=null;onMutationLock(false);receipt.replaceChildren();busy=false;notice("Изменения сохранены.");if(c.after)await c.after(result);else await load();}catch(e){if(stamp!==generation)return;if(!e.status||e.status>=500||c.everUnknown){c.phase="unknown";c.everUnknown=true;notice("Сервер не подтвердил исход операции.",true);renderReceipt();}else{command=null;onMutationLock(false);receipt.replaceChildren();notice(errorText(e)+" Обновите сведения перед следующей операцией.",true);if([401,403].includes(e.status)){clear();render();onSessionError(e);}}}finally{if(stamp===generation){busy=false;controls();}}}
    async function load(more=false){if(more&&!currentPage?.hasMore)return;const cursor=more?currentPage.nextCursor:"";await read(async fresh=>{const params={limit:25,cursor,...filters};if(tab!=="myRequests")Object.assign(params,scopeParams());const next=page(await api("dispatch/pages/"+tab+"?"+query(params)));next.items.forEach(row);if(!fresh())return;rows=more?[...rows,...next.items]:next.items;currentPage=next;current=history=files=null;forms.replaceChildren();renderBody();notice(rows.length?"Загружено записей: "+rows.length:"Записей по выбранным условиям нет.");});}
    function group(...nodes){const g=el("div","","dispatch-actions");g.append(...nodes);return g;}
    function render(){
      nav.replaceChildren();for(const[k,t]of [["myRequests","Мои обращения"],["requests","Очередь"],["incidents","Инциденты"],["outages","Отключения"],["network","Сеть"],["networkLinks","Связи сети"],["intakes","Приёмные"],["subscriptions","Подписки"],["crews","Смены и компетенции"]]){const b=button(t,()=>{if(locked())return;tab=k;current=null;rows=[];currentPage=null;filters={};forms.replaceChildren();render();});b.setAttribute("aria-current",String(tab===k));nav.append(b);}
      scope.replaceChildren();const areas=Object.fromEntries((context.areas||[]).filter(a=>a.state!=="Inactive").map(a=>[a.id,a.name||a.title||a.id]));const pick=field(scope,"area","Участок","text",areaId,areas,false);pick.addEventListener("change",()=>{clear();areaId=pick.value;render();});scope.append(button("Обновить",()=>tab==="subscriptions"?subscriptionForm():tab==="crews"?crewProfiles():load()));renderBody();controls();
    }
    function renderBody(){
      body.replaceChildren();if(!signed()){body.append(el("p","Войдите в кабинет."));return;}
      if(tab!=="myRequests"&&tab!=="subscriptions"&&!(tab==="intakes"?owner():dispatcher())){body.append(el("p","Для этого раздела требуется соответствующая роль в выбранном участке."));return;}
      const actions=el("div","","dispatch-actions");body.append(actions);
      if(tab==="myRequests"){actions.append(button("Новое обращение",newRequest,true),button("Присоединить гостевую квитанцию",claimReceipt,true));filterForm(actions);}
      if(tab==="requests")filterForm(actions);
      if(tab==="incidents")actions.append(button("Создать инцидент",()=>incidentForm(),true));
      if(tab==="outages")actions.append(button("Создать отключение",()=>outageForm(),true));
      if(tab==="network")actions.append(button("Добавить объект сети",()=>networkForm(),true),button("Показать схему загруженного участка",networkDiagram));
      if(tab==="networkLinks")actions.append(button("Добавить связь",()=>networkLinkForm(),true));
      if(tab==="intakes")actions.append(button("Создать приёмную",()=>intakeForm(),true));
      if(tab==="subscriptions"){body.append(el("p","Подписку может оформить владелец объекта."),button("Настроить подписку",subscriptionForm,true));return;}
      if(tab==="crews"){body.append(el("p","Участники, бригады и ресурсы создаются в разделе «Наряды». Здесь задаются компетенции и смена бригады."),button("Загрузить бригады",crewProfiles));return;}
      if(!currentPage){body.append(el("p","Нажмите «Обновить», чтобы загрузить текущие сведения."));return;}
      if(tab==="myRequests"||tab==="requests")body.append(table(["Обращение","Адрес","Статус / этап","Приоритет / срок","Ответственный / источник",""],rows,r=>[r.title,r.address,label(STATES,r.state)+" / "+r.stage,tab==="requests"?label(PRIORITIES,r.priority)+"; "+time(r.dueAt)+(r.overdue?"; ПРОСРОЧЕНО":""):time(r.updatedAt),tab==="requests"?(r.responsibleAccountId||"Не назначен")+" / "+(r.source==="GuestReceipt"?"Гость":"Кабинет"):r.intakeName,button("Открыть",()=>openRequest(r.id,tab==="requests"))]));
      else if(tab==="incidents")body.append(table(["Инцидент","Тяжесть","Состояние","Прогноз",""],rows,r=>[r.title,label(SEVERITY,r.severity),label(STATES,r.state),time(r.forecastAt),button("Открыть",()=>openIncident(r.id))]));
      else if(tab==="outages")body.append(table(["Причина","Статус","Адреса","Публичная редакция",""],rows,r=>[r.reason,label(STATES,r.state),(r.addresses||[]).join("; "),r.publishedRevision||"Не опубликовано",group(button("Изменить",()=>outageForm(r),true),button("Утвердить публикацию",()=>reasonForm("Опубликовать отключение",r,"dispatch/outages/"+r.id+"/publish","Публичными станут причина, адреса, сроки и точки подвоза. Внутренние ссылки не публикуются."),true),button("Авторство и версии",()=>showDirectoryHistory("outages",r)))]));
      else if(tab==="network")body.append(table(["Объект","Вид","Адрес","Состояние",""],rows,r=>[r.name,label(TYPES,r.type),r.address,label(STATES,r.state),group(button("Изменить",()=>networkForm(r),true),button("Авторство и версии",()=>showDirectoryHistory("network",r)))]));
      else if(tab==="networkLinks")body.append(table(["Начальный объект","Конечный объект","Состояние",""],rows,r=>[r.fromId,r.toId,label(STATES,r.state),group(button("Изменить",()=>networkLinkForm(r),true),button("Авторство и версии",()=>showDirectoryHistory("networkLinks",r)))]));
      else if(tab==="intakes")body.append(table(["Приёмная","Адреса","Публикация","Приём",""],rows,r=>[r.name,(r.addresses||[]).join("; "),r.published?"Опубликована":"Скрыта",r.accepting?"Открыт":"Закрыт",group(button("Настроить",()=>intakeForm(r),true),button("Авторство и версии",()=>showDirectoryHistory("intakes",r)))]));
      if(currentPage.hasMore)body.append(button("Загрузить ещё 25",()=>load(true)));if(!rows.length)body.append(el("p","Записей нет."));controls();
    }
    function filterForm(parent){parent.append(button("Фильтры",()=>{
      const spec=[{name:"state",label:"Статус",choices:Object.fromEntries(["Submitted","Accepted","AwaitingInfo","Rejected","Resolved"].map(k=>[k,STATES[k]])),value:filters.state,required:false},{name:"address",label:"Точный адрес",value:filters.address,required:false},dateField("from","Создано после",filters.from,false),dateField("to","Создано до",filters.to,false)];
      if(tab==="requests")spec.push({name:"priority",label:"Приоритет",choices:PRIORITIES,value:filters.priority,required:false},{name:"source",label:"Источник",choices:{Portal:"Кабинет",GuestReceipt:"Гость"},value:filters.source,required:false},{name:"responsibleAccountId",label:"Идентификатор ответственного (из карточки)",value:filters.responsibleAccountId,required:false},{name:"overdue",label:"Просрочка",choices:{true:"Только просроченные",false:"Без просрочки"},value:filters.overdue,required:false});
      form("Отбор обращений",spec,async values=>{values.from=utc(values.from);values.to=utc(values.to);filters=values;forms.replaceChildren();await load();},"Применить фильтры");
    }));}
    async function lookup(title,path,onChoose,caption=r=>r.name||r.title||r.address||r.id,params={}){
      await read(async fresh=>{const p=page(await api(path+"?"+query({...params,limit:25})));if(!fresh())return;lookupState={path,params,page:p,items:p.items,onChoose,caption,title};renderLookup();});
    }
    function renderLookup(){
      const l=lookupState;if(!l)return;forms.replaceChildren(el("h3",l.title));forms.append(table(["Запись",""],l.items,r=>[l.caption(r),button("Выбрать",()=>l.onChoose(r))]));
      if(l.page.hasMore)forms.append(button("Следующая страница",()=>read(async fresh=>{const p=page(await api(l.path+"?"+query({...l.params,limit:25,cursor:l.page.nextCursor})));if(!fresh())return;l.page=p;l.items=p.items;renderLookup();})));if(!l.items.length)forms.append(el("p","Доступных записей нет."));controls();
    }
    async function newRequest(){
      await lookup("Выберите обслуживающую приёмную","dispatch/intake-options",intake=>{
        if(!intake.accepting){notice("Приёмная сейчас не принимает обращения.",true);return;}
        form("Новое обращение: "+intake.name,[{name:"address",label:"Обслуживаемый адрес",choices:Object.fromEntries(list(intake.addresses,30).map(a=>[a,a]))},{name:"category",label:"Категория",choices:Object.fromEntries(list(intake.categories,8).map(c=>[c,label(CATEGORIES,c)]))},{name:"title",label:"Кратко о проблеме",max:150},{name:"description",label:"Описание",type:"textarea",max:2000},{name:"contact",label:"Контакт для связи",max:128}],v=>prepare("my/requests",{publicIntakeId:intake.id,...v},"Обращение будет направлено в «"+intake.name+"». После отправки можно добавить файлы.",r=>openRequest(r.id,false)));
      });
    }
    function claimReceipt(){
      form("Присоединить гостевое сообщение",[{name:"id",label:"Номер квитанции",max:36},{name:"secret",label:"Секрет квитанции",type:"password",max:64,hint:"Секрет не включается в ссылку и не сохраняется в браузере."}],v=>{
        if(!UUID.test(v.id)||!/^[0-9a-f]{64}$/.test(v.secret))throw new Error("Проверьте номер и секрет из сохранённой квитанции.");
        prepare("my/receipts/"+v.id+"/claim",{receiptSecret:v.secret},"Подтвердить владение квитанцией и добавить обращение в свой кабинет. Первоначальная история гостя сохранится.",r=>openRequest(r.id,false));
      });
    }
    function requestBase(){return(currentStaff?"dispatch":"my")+"/requests/"+current.id;}
    async function openRequest(id,staff){
      await read(async fresh=>{const dto=object(await api((staff?"dispatch":"my")+"/requests/"+uuid(id)));row(dto.request);list(dto.messages,200);if(!fresh())return;current={...dto.request,guestPhoto:dto.guestPhoto===true||dto.request.guestPhoto===true};currentStaff=staff;history=files=null;forms.replaceChildren();renderRequest(dto.messages);notice("Карточка загружена.");});
    }
    function renderRequest(messages){
      body.replaceChildren();const r=current;body.append(button("К списку",()=>load()),el("h3",r.title));details(body,[["Адрес",r.address],["Категория",label(CATEGORIES,r.category)],["Статус",label(STATES,r.state)],["Этап",r.stage],["Описание",r.description],["Контакт",r.contact],["Результат / основание",r.lastPublicReason],["Создано",time(r.createdAt)],["Обновлено",time(r.updatedAt)]]);
      if(currentStaff)details(body,[["Приоритет",label(PRIORITIES,r.priority)],["Срок",time(r.dueAt)],["Ответственный",r.responsibleAccountId||"Не назначен"],["Источник",r.source==="GuestReceipt"?"Гостевая квитанция":"Кабинет"],["Инцидент",r.incidentId||"Не связан"]]);
      const actions=group(button("Обновить карточку",()=>openRequest(r.id,currentStaff)),button("История",()=>loadHistory()),button("Вложения",loadFiles),button("Добавить файл",()=>uploadForm(),true));body.append(actions);
      if(!["Resolved","Rejected"].includes(r.state))actions.append(button("Ответить",()=>messageForm(false),true));
      else actions.append(button("Возобновить с причиной",()=>reasonForm("Новый этап обращения",r,requestBase()+"/actions/reopen","Обращение будет возобновлено новым этапом. История останется неизменной.",()=>openRequest(r.id,currentStaff)),true));
      if(currentStaff){
        actions.append(button("Внутренняя заметка",()=>messageForm(true),true),button("Приоритет и срок",triageForm,true),button("Связать с инцидентом",linkIncident,true));if(r.incidentId)actions.append(button("Отменить связь",unlinkIncident,true));
        for(const[action,text,allowed]of [["accept","Принять",["Submitted"]],["reject","Отклонить",["Submitted","Accepted"]],["ask-info","Запросить уточнение",["Submitted","Accepted"]],["resolve","Зафиксировать решение",["Accepted"]]])if(allowed.includes(r.state))actions.append(button(text,()=>reasonForm(text,r,requestBase()+"/actions/"+action,text+"? Основание увидит заявитель.",()=>openRequest(r.id,true)),true));
      }
      if(r.guestPhoto)actions.append(button("Скачать исходное фото гостя",()=>download(requestBase()+"/guest-photo")));
      body.append(el("h3","Переписка"));for(const m of messages){const article=el("article","","dispatch-message");article.append(el("h4",(m.visibility==="Internal"?"Внутренняя заметка · ":"")+({Requester:"Заявитель",Dispatcher:"Диспетчер",Guest:"Гость"}[m.authorLabel]||"Участник")+" · "+time(m.createdAt)),el("p",m.text));body.append(article);}if(!messages.length)body.append(el("p","Сообщений пока нет."));
      body.append(el("section","","dispatch-history"),el("section","","dispatch-files"));controls();
    }
    function messageForm(internal){
      form(internal?"Внутренняя заметка, не видна заявителю":"Ответ в обращение",[{name:"text",label:internal?"Текст заметки":"Текст ответа",type:"textarea",max:4000}],v=>prepare(requestBase()+(internal?"/internal-notes":"/messages"),{expectedRevision:current.revision,text:v.text},internal?"Сохранить служебную заметку. Она не станет публичным ответом.":"Отправить сообщение участникам обращения.",()=>openRequest(current.id,currentStaff)));
    }
    function reasonForm(title,r,path,message,after){form(title,[{name:"reason",label:"Основание",type:"textarea",max:250}],v=>prepare(path,{expectedRevision:r.revision,reason:v.reason},message,after));}
    function triageForm(){
      form("Приоритет, срок и ответственность",[{name:"priority",label:"Приоритет",choices:PRIORITIES,value:current.priority},dateField("dueAt","Срок исполнения",current.dueAt),{name:"reason",label:"Причина изменения",max:250}],v=>prepare(requestBase()+"/triage",{expectedRevision:current.revision,priority:v.priority,dueAt:utc(v.dueAt),reason:v.reason},"Вы станете ответственным за обращение. Изменение срока и приоритета сохранится в истории.",()=>openRequest(current.id,true)));
    }
    async function loadHistory(more=false){
      await read(async fresh=>{const p=page(await api(requestBase()+"/timeline?"+query({limit:25,cursor:more?history?.nextCursor:""})));if(!fresh())return;history={...p,items:more?[...history.items,...p.items]:p.items};const host=body.querySelector(".dispatch-history");host.replaceChildren(el("h3","История этапов"));
        for(const h of history.items){const author=h.authorLabel==="Guest"?"Гость":h.authorLabel==="Requester"?"Заявитель":h.actorAccountId||"Диспетчер";host.append(el("p",time(h.changedAt)+" · "+author+" · "+h.operation+" · "+h.reason+" · этап "+(h.after?.stage||"")));}
        if(history.hasMore)host.append(button("Более ранние события",()=>loadHistory(true)));controls();
      });
    }
    async function loadFiles(){
      await read(async fresh=>{const data=list(await api(requestBase()+"/files"),100);if(!fresh())return;files=data;const host=body.querySelector(".dispatch-files");host.replaceChildren(el("h3","Вложения"));host.append(table(["Файл","Видимость","Версия",""],files,f=>[f.filename,f.visibility==="Internal"?"Служебный":"Для заявителя",f.version,group(button("Скачать",()=>download((currentStaff?"dispatch":"my")+"/request-files/"+uuid(f.id)+"/content")),button("Версии",()=>fileVersions(f)),button("Новая версия",()=>uploadForm(f),true))]));if(!files.length)host.append(el("p","Файлов нет."));controls();});
    }
    async function fileVersions(f){
      await read(async fresh=>{const data=object(await api((currentStaff?"dispatch":"my")+"/request-files/"+uuid(f.id)));list(data.versions,100);if(!fresh())return;forms.replaceChildren(el("h3","Версии: "+f.filename));forms.append(table(["Версия","Файл","Дата","Основание",""],data.versions,v=>[v.version,v.filename,time(v.createdAt),v.reason,button("Скачать версию",()=>download((currentStaff?"dispatch":"my")+"/request-files/"+f.id+"/versions/"+v.version+"/content"))]));controls();});
    }
    async function fileBody(file){
      if(!file||!file.size||file.size>5242880)throw new Error("Выберите непустой файл не больше 5 МиБ.");const ext=file.name.split(".").pop().toLowerCase(),mime=MIME[ext];if(!mime)throw new Error("Разрешены PDF, PNG, JPEG, TXT и CSV.");const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {filename:file.name,mime,contentBase64:btoa(binary)};
    }
    function uploadForm(existing){
      const spec=[{name:"file",label:"Файл до 5 МиБ",type:"file"}];if(existing)spec.push({name:"reason",label:"Причина новой версии",max:250});else spec.push({name:"visibility",label:"Кому доступно",choices:currentStaff?{Public:"Заявителю и диспетчеру",Internal:"Только диспетчерской"}:{Public:"Заявителю и диспетчеру"},value:"Public"});
      const created=form(existing?"Новая версия файла":"Добавить вложение",spec,async(v,fields)=>{const stamp=generation,data=await fileBody(fields.file.files[0]);if(stamp!==generation)return;if(existing)prepare((currentStaff?"dispatch":"my")+"/request-files/"+existing.id+"/versions",{...data,expectedVersion:existing.version,reason:v.reason},"Сохранить новую версию. Предыдущая версия останется в истории.",loadFiles);else prepare(requestBase()+"/files",{...data,visibility:v.visibility},"Загрузить вложение с выбранной видимостью.",loadFiles);});created.fields.file.accept=".pdf,.png,.jpg,.jpeg,.txt,.csv";
    }
    async function download(path){
      await read(async fresh=>{if(typeof requestBinary!=="function")throw new Error("Транспорт файлов недоступен.");const ctl=new AbortController();controllers.add(ctl);try{const r=await requestBinary(path,{signal:ctl.signal});if(!fresh())return;if(!(r?.blob instanceof Blob)||!Object.values(MIME).includes(r.contentType)||r.blob.size<1||r.blob.size>5242880||typeof r.filename!=="string")throw invalid();const url=URL.createObjectURL(r.blob);urls.add(url);const a=el("a");a.href=url;a.download=r.filename;a.hidden=true;root.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000);notice("Файл получен с повторной проверкой доступа.");}finally{controllers.delete(ctl);}});
    }
    function incidentForm(r){
      const spec=r?[{name:"severity",label:"Тяжесть",choices:SEVERITY,value:r.severity},dateField("forecastAt","Прогноз устранения",r.forecastAt),{name:"description",label:"Описание",type:"textarea",value:r.description,max:2000},{name:"reason",label:"Причина изменения",max:250}]:[{name:"title",label:"Название",max:150},{name:"type",label:"Тип",choices:{Leak:"Утечка",Supply:"Водоснабжение",Sewer:"Канализация",Other:"Другое"}},{name:"severity",label:"Тяжесть",choices:SEVERITY,value:"Moderate"},dateField("startedAt","Начало"),dateField("forecastAt","Прогноз устранения"),{name:"description",label:"Описание",type:"textarea",max:2000}];
      form(r?"Изменить инцидент":"Создать инцидент",spec,v=>{v.forecastAt=utc(v.forecastAt);if(r)v.expectedRevision=r.revision;else{v.startedAt=utc(v.startedAt);Object.assign(v,scopeParams());}prepare("dispatch/incidents"+(r?"/"+r.id+"/actions/update":""),v,"Сохранить сведения об инциденте.",result=>openIncident(result.id));});
    }
    async function openIncident(id){
      await read(async fresh=>{const dto=object(await api("dispatch/incidents/"+uuid(id)));row(dto.incident);list(dto.requests,100);if(!fresh())return;current=dto.incident;forms.replaceChildren();body.replaceChildren(button("К списку",()=>load()),el("h3",current.title));
        details(body,[["Тип",label(INCIDENT_TYPES,current.type)],["Состояние",label(STATES,current.state)],["Тяжесть",label(SEVERITY,current.severity)],["Начало",time(current.startedAt)],["Прогноз",time(current.forecastAt)],["Устранён",time(current.resolvedAt)],["Описание",current.description],["Ответственный",current.responsibleAccountId],["Объект сети",current.networkAssetId||"Не выбран"]]);
        body.append(group(button("Изменить",()=>incidentForm(current),true),button("Указать сетевой объект",incidentAsset,true),button("Зафиксировать устранение",()=>reasonForm("Завершить инцидент",current,"dispatch/incidents/"+current.id+"/actions/resolve","Сначала завершите обязательные задачи и наряды.",()=>openIncident(id)),true)));
        body.append(el("h3","Связанные обращения"),table(["Обращение","Статус",""],dto.requests,r=>[r.title,label(STATES,r.state),button("Открыть",()=>openRequest(r.id,true))]));incidentWork(current);controls();
      });
    }
    function incidentWork(incident){
      const section=el("section"),title=el("h3","Связанные наряды"),result=el("div"),progress=el("p");
      section.id="dispatch-incident-work";title.id="dispatch-incident-work-heading";section.setAttribute("aria-labelledby",title.id);
      progress.id="dispatch-incident-work-status";progress.setAttribute("role","status");
      const scopeSnapshot=scopeParams(),seen=new Set(),cursors=new Set();let matches=[],cursor="",loaded=false,hasMore=false;
      const active=()=>body.contains(section)&&current?.id===incident.id&&context.workspaceId===scopeSnapshot.workspaceId&&areaId===scopeSnapshot.areaId;
      const next=button("Загрузить связанные наряды",()=>loadWork(false)),refresh=button("Обновить наряды",()=>loadWork(true));
      next.id="dispatch-incident-work-next";refresh.id="dispatch-incident-work-refresh";
      function renderWork(){
        result.replaceChildren();if(matches.length)result.append(table(["Наряд","Состояние","Обязательный","Плановый интервал"],matches,r=>{
          const name=el("span",r.name||r.task);name.id="dispatch-incident-work-"+r.id;
          return [name,label(WORK_STATES,r.state),r.requiredForIncident?"Да":"Нет",time(r.plannedFrom)+" — "+time(r.plannedTo)];
        }));
        progress.textContent=!loaded?"Список ещё не загружен.":"Найдено связанных нарядов: "+matches.length+". "+(hasMore?"Проверена часть списка участка. Продолжите поиск, чтобы увидеть остальные.":"Список участка проверен полностью. Для работы с нарядом откройте раздел «Наряды».");
        next.textContent=loaded?"Продолжить поиск нарядов":"Загрузить связанные наряды";next.hidden=loaded&&!hasMore;next.dataset.unavailable=String(loaded&&!hasMore);
        refresh.hidden=!loaded;refresh.dataset.unavailable=String(!loaded);controls();
      }
      async function loadWork(restart){
        if(!active()||!dispatcher()||(!restart&&loaded&&!hasMore))return;
        await read(async fresh=>{
          const requested=restart?"":cursor;
          const dto=page(await api("work/orders?"+query({...scopeSnapshot,limit:25,cursor:requested})));
          if(!fresh()||!active())return;
          const ids=new Set(restart?[]:seen),visited=new Set(restart?[]:cursors),found=[];
          if(dto.limit!==25||visited.has(requested)||(dto.hasMore&&(!dto.items.length||dto.nextCursor===requested||visited.has(dto.nextCursor))))throw invalid();
          for(const r of dto.items){
            row(r);if(r.workspaceId!==scopeSnapshot.workspaceId||r.areaId!==scopeSnapshot.areaId||ids.has(r.id)||!["Request","Incident","ServiceOrder"].includes(r.sourceKind)||typeof r.sourceIncidentId!=="string"||typeof r.requiredForIncident!=="boolean"||typeof r.name!=="string"||typeof r.task!=="string"||typeof r.state!=="string"||typeof r.plannedFrom!=="string"||typeof r.plannedTo!=="string")throw invalid();
            ids.add(r.id);if(r.sourceKind==="Incident"&&r.sourceIncidentId===incident.id)found.push(r);
          }
          visited.add(requested);seen.clear();ids.forEach(id=>seen.add(id));cursors.clear();visited.forEach(value=>cursors.add(value));
          matches=restart?found:[...matches,...found];cursor=dto.nextCursor;hasMore=dto.hasMore;loaded=true;renderWork();
        });
      }
      section.append(title,progress,result,group(next,refresh));body.append(section);renderWork();
    }
    async function linkIncident(){
      const r=current;await lookup("Инцидент для объединения","dispatch/pages/incidents",i=>{
        form("Связать обращение и инцидент",[{name:"reason",label:"Причина объединения",max:250}],v=>prepare("dispatch/requests/"+r.id+"/incidents/"+i.id+"/actions/link",{requestExpectedRevision:r.revision,incidentExpectedRevision:i.revision,reason:v.reason},"Объединение не меняет владельцев и права исходных обращений.",()=>openRequest(r.id,true)));
      },r=>r.title,scopeParams());
    }
    async function unlinkIncident(){
      const r=current;await read(async fresh=>{const dto=object(await api("dispatch/incidents/"+uuid(r.incidentId)));if(!fresh())return;form("Отменить объединение",[{name:"reason",label:"Причина отмены связи",max:250}],v=>prepare("dispatch/requests/"+r.id+"/incidents/"+r.incidentId+"/actions/unlink",{requestExpectedRevision:r.revision,incidentExpectedRevision:dto.incident.revision,reason:v.reason},"Связь будет снята явной операцией с сохранением истории.",()=>openRequest(r.id,true)));});
    }
    async function incidentAsset(){
      const incident=current;await lookup("Выберите объект сети","dispatch/pages/network",asset=>form("Привязать объект сети",[{name:"reason",label:"Основание",max:250}],v=>prepare("dispatch/incidents/"+incident.id+"/network-asset",{expectedRevision:incident.revision,networkAssetId:asset.id,reason:v.reason},"Привязать инцидент к «"+asset.name+"».",()=>openIncident(incident.id))),r=>r.name,scopeParams());
    }
    function networkForm(r){
      form(r?"Изменить объект сети":"Новый объект сети",[{name:"name",label:"Название",value:r?.name,max:150},{name:"address",label:"Адрес",value:r?.address,max:250},{name:"type",label:"Вид объекта",choices:TYPES,value:r?.type},{name:"state",label:"Состояние",choices:{Active:STATES.Active,Fault:STATES.Fault,Maintenance:STATES.Maintenance,Retired:STATES.Retired},value:r?.state||"Active"},{name:"description",label:"Описание",type:"textarea",value:r?.description,max:2000},{name:"x",label:"Координата X схемы (0–1000)",type:"number",value:r?.x??500},{name:"y",label:"Координата Y схемы (0–1000)",type:"number",value:r?.y??500},{name:"reason",label:"Причина",max:250}],v=>prepare("dispatch/network-assets"+(r?"/"+r.id:""),{...scopeParams(),expectedRevision:r?.revision||0,...v},"Сохранить объект сети."));
    }
    async function networkLinkForm(r){
      await lookup("Выберите начало связи","dispatch/pages/network",from=>lookup("Выберите конец связи","dispatch/pages/network",to=>{
        if(from.id===to.id)throw new Error("Начало и конец связи должны различаться.");
        form("Связь: "+from.name+" → "+to.name,[{name:"state",label:"Состояние",choices:{Active:STATES.Active,Fault:STATES.Fault,Maintenance:STATES.Maintenance,Retired:STATES.Retired},value:r?.state||"Active"},{name:"reason",label:"Основание",max:250}],v=>prepare("dispatch/network-links"+(r?"/"+r.id:""),{...scopeParams(),expectedRevision:r?.revision||0,fromId:from.id,toId:to.id,...v},"Сохранить связь объектов."));
      },x=>x.name,scopeParams()),x=>x.name,scopeParams());
    }
    async function networkDiagram(){
      await read(async fresh=>{
        const links=page(await api("dispatch/pages/networkLinks?"+query({...scopeParams(),limit:100}))),incidents=page(await api("dispatch/pages/incidents?"+query({...scopeParams(),limit:100})));if(!fresh())return;
        const view=DispatchNetworkView.mount({doc,rows,links:links.items,incidents:incidents.items,stateLabel:value=>label(STATES,value),typeLabel:value=>label(TYPES,value)});
        const scope=el("p","Схема показывает только загруженные объекты. Связей: "+links.items.length+(links.hasMore?"; есть следующая страница":"")+". Инцидентов: "+incidents.items.length+(incidents.hasMore?"; есть следующая страница":"")+". Для полного перечня используйте соответствующие таблицы.","dispatch-hint");
        forms.replaceChildren(scope,view);DispatchNetworkView.activate(view);
      });
    }
    function outageForm(r){
      if(!r){form("Источник отключения",[{name:"sourceType",label:"Основание",choices:{Incident:"Инцидент",WorkOrder:"Плановый наряд"}}],v=>lookup("Выберите источник",v.sourceType==="Incident"?"dispatch/pages/incidents":"work/orders",source=>outageFields(null,v.sourceType,source.id),x=>x.title||x.name||x.task||x.id,scopeParams()),"Выбрать источник");return;}outageFields(r,r.sourceType,r.sourceId);
    }
    function outageFields(r,sourceType,sourceId){
      form(r?"Изменить отключение":"Новое отключение",[{name:"type",label:"Вид отключения",choices:{Emergency:"Аварийное",Planned:"Плановое"},value:r?.type||"Emergency"},{name:"state",label:"Состояние",choices:{Planned:STATES.Planned,Active:STATES.Active,Restored:STATES.Restored},value:r?.state||"Active"},{name:"reason",label:"Понятная жителям причина",type:"textarea",max:1000,value:r?.reason},{name:"addresses",label:"Обслуживаемые адреса, по одному в строке",type:"textarea",max:9000,value:r?.addresses?.join("\n")},dateField("startedAt","Начало",r?.startedAt),dateField("expectedRestoredAt","Прогноз восстановления, если известен",r?.expectedRestoredAt,false),dateField("restoredAt","Фактическое восстановление",r?.restoredAt,false)],v=>{
        const data={...scopeParams(),expectedRevision:r?.revision||0,sourceType,sourceId,...v,addresses:lines(v.addresses),startedAt:utc(v.startedAt),expectedRestoredAt:utc(v.expectedRestoredAt),restoredAt:utc(v.restoredAt),waterPoints:JSON.parse(JSON.stringify(r?.waterPoints||[]))};waterPointsForm(r,data);
      });
    }
    function waterPointsForm(r,data){
      forms.replaceChildren(el("h3","Точки подвоза воды"),el("p","Добавьте доступные точки. Пустой список означает, что подвоз для этой редакции не назначен."));const host=el("div"),actions=el("div","","dispatch-actions");forms.append(host,actions);
      function draw(){host.replaceChildren(table(["Адрес","С","До","Примечание",""],data.waterPoints,p=>[p.address,time(p.from),time(p.to),p.note,button("Удалить из черновика",()=>{data.waterPoints=data.waterPoints.filter(x=>x!==p);draw();})]));controls();}
      actions.append(button("Добавить точку",()=>{if(data.waterPoints.length>=20)throw new Error("Не больше 20 точек подвоза.");form("Точка подвоза",[{name:"address",label:"Адрес",max:250},dateField("from","Начало выдачи"),dateField("to","Конец выдачи"),{name:"note",label:"Примечание",max:250}],v=>{data.waterPoints.push({...v,from:utc(v.from),to:utc(v.to)});waterPointsForm(r,data);},"Добавить в черновик");}),button("Сохранить черновик отключения",()=>prepare("dispatch/outages"+(r?"/"+r.id:""),data,"Сохранить внутреннюю редакцию. Для изменения публичной страницы требуется отдельное утверждение."),true));draw();
    }
    function showDirectoryHistory(kind,r){
      if(!(kind==="intakes"?owner():dispatcher()))return;
      body.querySelector(".dispatch-directory-history")?.remove();
      const host=el("section","","dispatch-directory-history"),status=el("p","История ещё не загружена."),entries=el("div"),latest=el("p");
      const expected={...scopeParams(),kind,id:uuid(r.id),createdBy:uuid(r.createdBy),revision:r.revision};let cursor="",last=r.revision+1,done=false;
      const next=button("Загрузить историю авторов",()=>read(async fresh=>{
        if(done||!body.contains(host)||!(kind==="intakes"?owner():dispatcher()))return;
        const p=authorshipPage(await api("dispatch/pages/"+kind+"?"+query({...scopeParams(),view:"history",historyId:r.id,limit:25,cursor})),expected,last,cursor);
        if(!fresh()||!body.contains(host))return;
        if(!cursor)latest.textContent=p.items[0]?.revision===r.revision?"Автор текущей версии: "+p.items[0].actorAccountId:"Автор текущей версии не подтверждён сохранённой историей.";
        for(const h of p.items)entries.append(el("p","Версия "+h.revision+" · "+h.actorAccountId+" · "+time(h.changedAt)+" · "+h.operation));
        if(p.items.length)last=p.items.at(-1).revision;cursor=p.nextCursor;done=!p.hasMore;next.hidden=done;next.textContent="Более ранние версии";
        status.textContent=done?"История текущего участка загружена полностью.":"Загружена часть истории текущего участка.";controls();
      }));next.id="dispatch-directory-history-next";host.append(el("h3","Авторство и версии"));details(host,[["Запись",r.name||r.reason||r.id],["Автор создания",r.createdBy],["Текущая версия",r.revision]]);
      host.append(el("p","События выбранного участка. После переноса приёмной прежние события остаются в исходном участке."),latest,status,entries,next);body.append(host);controls();
    }
    function intakeForm(r){
      const cats=Object.keys(CATEGORIES);form(r?"Настройки приёмной":"Новая приёмная",[{name:"name",label:"Название центра",value:r?.name,max:150},{name:"defaultAreaId",label:"Участок по умолчанию",choices:Object.fromEntries((context.areas||[]).filter(a=>(context.ownerAreaIds||[]).includes(a.id)).map(a=>[a.id,a.name||a.id])),value:r?.defaultAreaId||areaId},{name:"addresses",label:"Разрешённые адреса, по одному в строке",type:"textarea",max:9000,value:r?.addresses?.join("\n")},{name:"categories",label:"Принимаемые категории",type:"multiselect",choices:CATEGORIES,value:r?.categories||cats,hint:"Можно выбрать несколько категорий; на компьютере используйте Ctrl или Shift."},{name:"published",label:"Показывать в публичном выборе",type:"checkbox",value:r?.published||false},{name:"accepting",label:"Принимать обращения",type:"checkbox",value:r?.accepting||false}],v=>{
        const data={...v,addresses:lines(v.addresses)};if(!data.categories.length||data.categories.some(x=>!CATEGORIES[x]))throw new Error("Укажите категории из списка.");if(r)data.expectedRevision=r.revision;else data.workspaceId=context.workspaceId;prepare("dispatch/intakes"+(r?"/"+r.id+"/actions/configure":""),data,"Сохранить приёмную? Обращения с указанных адресов будут поступать в выбранный участок. Закрытая приёмная не принимает новые обращения.");
      });
    }
    async function subscriptionForm(){
      await lookup("Выберите объект подтверждённого лицевого счёта","my/personal-accounts",account=>form("Уведомления: "+account.address,[{name:"enabled",label:"Получать изменения отключений по этому адресу",type:"checkbox",value:true}],v=>prepare("my/outage-subscriptions",{propertyId:uuid(account.propertyId),enabled:v.enabled},v.enabled?"Подписаться на опубликованные изменения отключений.":"Отключить подписку на этот объект.",()=>notice("Настройка подписки сохранена."))),r=>r.address+" · ЛС "+r.numberNormalized);
    }
    async function crewProfiles(){
      await read(async fresh=>{const data=object(await api("work/setup?"+query(scopeParams())));list(data.crews,200);if(!fresh())return;body.replaceChildren(el("h3","Смены и компетенции бригад"),table(["Бригада","Состояние",""],data.crews,c=>[c.name,label(STATES,c.state),button("Профиль",()=>openCrewProfile(c.id))]));controls();});
    }
    function renderCrewHistory(profile){
      const host=el("section","","dispatch-crew-history");host.id="dispatch-crew-history";
      const status=el("p","История ещё не загружена."),entries=el("div");let cursor="",lastRevision=profile.revision+1,done=false;
      const next=button("Загрузить историю изменений",()=>read(async fresh=>{
        if(!dispatcher()||done||!body.contains(host))return;
        const p=page(await api("work/crews/"+uuid(profile.id)+"/profile?"+query({view:"history",limit:25,cursor})));
        if(p.hasMore&&(!p.items.length||p.nextCursor===cursor))throw invalid();
        let previous=lastRevision;for(const h of p.items){crewHistoryRow(h,profile);if(h.revision>=previous)throw invalid();previous=h.revision;}
        if(!fresh()||!body.contains(host))return;
        for(const h of p.items){const card=el("section");card.append(el("h4","Версия "+h.revision+" · "+(h.operation==="crew.create"?"Создание бригады":"Изменение смены и компетенций")));details(card,[["Автор изменения",h.actorAccountId],["Когда",time(h.changedAt)],["Основание",h.reason]]);
          if(h.operation==="crew.profile")for(const [title,s] of [["До изменения",h.before],["После изменения",h.after]]){card.append(el("h5",title));details(card,[["Компетенции",s.skills.join(", ")||"Не заданы"],["Начало смены",time(s.shiftFrom)],["Окончание смены",time(s.shiftTo)]]);}
          entries.append(card);
        }
        lastRevision=previous;cursor=p.nextCursor;done=!p.hasMore;next.hidden=done;next.textContent="Более ранние изменения";
        status.textContent=done?(entries.children.length?"История загружена полностью.":"Сохранённых записей истории нет."):"Загружена часть истории. Доступны более ранние изменения.";controls();
      }));next.id="dispatch-crew-history-next";host.append(el("h3","История смен и компетенций"),status,entries,next);body.append(host);
    }
    async function openCrewProfile(id){
      await read(async fresh=>{const data=row(await api("work/crews/"+uuid(id)+"/profile"));uuid(data.createdBy);if(data.id!==id||data.workspaceId!==context.workspaceId||data.areaId!==areaId)throw invalid();if(!fresh())return;body.replaceChildren(el("h3","Профиль бригады"));details(body,[["Бригада",data.name],["Автор создания",data.createdBy],["Текущая версия",data.revision],["Обновлено",time(data.updatedAt)]]);renderCrewHistory(data);form("Профиль: "+data.name,[{name:"skills",label:"Компетенции, по одной в строке",type:"textarea",max:2000,value:(data.skills||[]).join("\n")},dateField("shiftFrom","Начало смены",data.shiftFrom),dateField("shiftTo","Окончание смены",data.shiftTo),{name:"reason",label:"Основание изменения",max:250}],v=>prepare("work/crews/"+id+"/profile",{expectedRevision:data.revision,skills:lines(v.skills,20),shiftFrom:utc(v.shiftFrom),shiftTo:utc(v.shiftTo),reason:v.reason},"Сохранить компетенции и смену. Изменение не должно исключать уже назначенные наряды.",()=>openCrewProfile(id)));});
    }
    render();
    return {syncContext,reset,destroy:()=>{reset();root.replaceChildren();},setExternalBusy:value=>{externalBusy=!!value;controls();},setExternalMutationLock:value=>{externalLock=!!value;controls();}};
  }
  function mountPublic({root,request}){
    if(!root||typeof request!=="function")throw new Error("Нужны корневой элемент и транспорт публичной диспетчерской");
    const doc=root.ownerDocument,controllers=new Set(),urls=new Set();
    let generation=0,busy=false,intakes=[],intakesPage=null,pending=null,confirmed=null,ticket=null;
    root.classList.add("dispatch-ui");
    const el=(tag,text="",cls="")=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    const status=el("p","","dispatch-status"),controlsHost=el("div","","dispatch-actions"),formHost=el("div"),receiptHost=el("section","","dispatch-receipt");
    status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    root.replaceChildren(el("p","Сообщение попадёт только в выбранный центр. Номер квитанции без секрета не позволяет читать сообщение.","dispatch-notice"),controlsHost,status,formHost,receiptHost);
    function button(text,fn){const b=el("button",text);b.type="button";b.addEventListener("click",()=>{if(!b.disabled)Promise.resolve().then(fn).catch(e=>notice(e.status?errorText(e):e.message||errorText(e),true));});return b;}
    function notice(text,error=false){status.textContent=text;status.classList.toggle("dispatch-error",error);}
    function update(){root.setAttribute("aria-busy",String(busy));for(const n of root.querySelectorAll("button,input,select,textarea"))n.disabled=busy||n.dataset.requiresSaved==="true"&&!pending?.saved;}
    function field(parent,name,caption,type="text",choices=null,max=250){const wrap=el("div","","dispatch-field"),id="public-dispatch-"+name+"-"+crypto.randomUUID(),labelNode=el("label",caption),input=el(choices?"select":type==="textarea"?"textarea":"input");input.id=id;labelNode.htmlFor=id;if(!choices&&type!=="textarea")input.type=type;if(choices){input.append(new Option("Выберите…",""));for(const[k,v]of choices)input.append(new Option(v,k));}input.required=true;input.maxLength=max;if(type==="password")input.autocomplete="off";wrap.append(labelNode,input);parent.append(wrap);return input;}
    async function api(path,options={}){const ctl=new AbortController();controllers.add(ctl);try{return await request(path,{...options,signal:ctl.signal,headers:{"X-Vodokanal-Request":"1",...(options.headers||{})}});}finally{controllers.delete(ctl);}}
    async function run(fn){if(busy)return;const stamp=generation;busy=true;update();try{await fn(()=>stamp===generation);}catch(e){if(stamp===generation)notice(errorText(e),true);}finally{if(stamp===generation){busy=false;update();}}}
    function discardPrivate(){generation++;controllers.forEach(c=>c.abort());controllers.clear();urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();busy=false;pending=confirmed=ticket=null;formHost.replaceChildren();receiptHost.replaceChildren();update();}
    function navigation(){controlsHost.replaceChildren(button("Сообщить об опасном люке",async()=>{if(pending){notice("Сначала завершите отправку подготовленного сообщения или сохраните квитанцию и проверьте его статус.",true);return;}discardPrivate();await loadIntakes(false);}),button("Проверить сохранённую квитанцию",()=>{if(pending){notice("Для подготовленного сообщения используйте проверку статуса ниже.",true);return;}discardPrivate();receiptForm();}));}
    async function loadIntakes(more=false){await run(async fresh=>{const next=page(await api("intakes?"+new URLSearchParams({limit:"25",...(more&&intakesPage?.nextCursor?{cursor:intakesPage.nextCursor}:{})})));if(!fresh())return;intakesPage=next;intakes=more?[...intakes,...next.items]:next.items;intakeChooser();notice(intakes.length?"Выберите приёмную, обслуживающую адрес.":"Опубликованных приёмных пока нет.");});}
    function intakeChooser(){formHost.replaceChildren(el("h3","Куда направить сообщение"));const select=field(formHost,"intake","Центр","text",intakes.map(i=>[i.id,i.name+(i.accepting?"":" (приём закрыт)")]));formHost.append(button("Выбрать центр",()=>{const intake=intakes.find(i=>i.id===select.value);if(!intake)throw new Error("Выберите центр.");if(!intake.accepting||!list(intake.categories,8).includes("Manhole"))throw new Error("Эта приёмная сейчас не принимает сообщения об опасных люках.");hazardForm(intake);}));if(intakesPage.hasMore)formHost.append(button("Загрузить ещё приёмные",()=>loadIntakes(true)));update();}
    function hazardForm(intake){
      formHost.replaceChildren();const f=el("form","","dispatch-form");f.append(el("h3","Опасный люк: "+intake.name));
      const address=field(f,"address","Обслуживаемый адрес","text",list(intake.addresses,30).map(a=>[a,a]));
      const location=field(f,"location","Расположение или ближайший перекрёсток","text",null,250),description=field(f,"description","Что повреждено и в чём опасность","textarea",null,1500),contact=field(f,"contact","Контакт для обратной связи","text",null,128),photo=field(f,"photo","Фото JPEG или PNG до 5 МиБ","file");
      photo.accept=".jpg,.jpeg,.png";f.append(el("p","Не подходите к опасному месту ради фотографии. ","dispatch-hint"));
      const submit=el("button","Подготовить сообщение и квитанцию");submit.type="submit";f.append(submit);
      f.addEventListener("submit",async event=>{event.preventDefault();if(busy||!f.reportValidity())return;const file=photo.files[0];if(!file||!file.size||file.size>5242880){notice("Нужна фотография размером до 5 МиБ.",true);return;}const ext=file.name.split(".").pop().toLowerCase(),mime=MIME[ext];if(!["image/png","image/jpeg"].includes(mime)){notice("Разрешены JPEG и PNG.",true);return;}await run(async fresh=>{const data=new Uint8Array(await file.arrayBuffer());let bytes="";for(let i=0;i<data.length;i+=32768)bytes+=String.fromCharCode(...data.subarray(i,i+32768));const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");if(!fresh())return;ticket={schema:1,receiptId:crypto.randomUUID(),receiptSecret:secret};pending={key:ticket.receiptId,body:{publicIntakeId:intake.id,address:address.value,location:location.value.trim(),description:description.value.trim(),contact:contact.value.trim(),photo:{filename:file.name,mime,contentBase64:btoa(bytes)},receiptSecret:secret},unknown:false,saved:false};formHost.replaceChildren();renderPending();notice("Сохраните квитанцию: без неё проверить статус обращения не получится.");});});
      formHost.append(f);update();
    }
    function saveTicket(){
      if(!ticket)return;const blob=new Blob([JSON.stringify(ticket,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);urls.add(url);const a=el("a");a.href=url;a.download="vodokanal-receipt-"+ticket.receiptId+".json";root.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000);if(pending)pending.saved=true;renderPending();notice("Файл квитанции подготовлен. Храните его как пароль; не публикуйте.");
    }
    function renderPending(){
      receiptHost.replaceChildren();if(!ticket)return;receiptHost.append(el("h3",confirmed?"Сообщение принято":"Подготовлена защищённая квитанция"),el("p","Номер: "+ticket.receiptId),el("p","Секрет находится в скачиваемом файле, не в адресной строке."),button("Скачать квитанцию JSON",saveTicket));
      if(pending){receiptHost.append(el("p",pending.unknown?"Исход отправки неизвестен. Повтор безопасен только с тем же ключом и исходными данными.":"Сообщение ещё не подтверждено сервером."));const sendButton=button(pending.unknown?"Повторить исходную отправку":"Квитанция сохранена, отправить сообщение",sendHazard);sendButton.disabled=!pending.saved;sendButton.dataset.requiresSaved="true";receiptHost.append(sendButton,button("Проверить статус этой квитанции",()=>readReceipt(ticket.receiptId,ticket.receiptSecret)));}
      if(confirmed)renderStatus(confirmed);
      update();const sendButton=receiptHost.querySelector("[data-requires-saved]");if(sendButton)sendButton.disabled=busy||!pending?.saved;
    }
    async function sendHazard(){
      if(!pending?.saved)return;const operation=pending;await run(async fresh=>{
        try{const result=await api("hazard-reports",{method:"POST",body:operation.body,headers:{"Idempotency-Key":operation.key}});validateReceipt(result,ticket.receiptId);if(!fresh())return;confirmed=result;pending=null;renderPending();notice("Сообщение принято в выбранную очередь. Сохраните квитанцию.");}
        catch(e){if(!fresh())return;operation.unknown=!e.status||e.status>=500||operation.unknown;renderPending();notice(errorText(e)+(operation.unknown?" Не создавайте повторную заявку.":" Исправить данные можно только после подтверждённого отказа сервера."),true);if(!operation.unknown)receiptHost.append(button("Исправить сообщение",()=>{pending=null;ticket=null;receiptHost.replaceChildren();intakeChooser();}));}
      });
    }
    function validateReceipt(v,id){object(v);if(v.receiptId!==id||typeof v.state!=="string"||!Object.hasOwn(STATES,v.state)||!Number.isInteger(v.stage)||v.stage<1||typeof v.createdAt!=="string"||typeof v.updatedAt!=="string"||typeof v.claimed!=="boolean")throw invalid();for(const k of Object.keys(v))if(!["receiptId","state","stage","createdAt","updatedAt","claimed"].includes(k))throw invalid();return v;}
    function renderStatus(v){receiptHost.append(el("p","Статус: "+label(STATES,v.state)+". Этап: "+v.stage+"."),el("p","Обновлено: "+time(v.updatedAt)),el("p",v.claimed?"Квитанция уже присоединена к кабинету.":"После входа можно присоединить сообщение в разделе «Обращения» по номеру и секрету."));const link=el("a","Войти или зарегистрироваться");link.href="/login?service=request";receiptHost.append(link);}
    async function readReceipt(id,secret){await run(async fresh=>{const value=validateReceipt(await api("receipts/"+uuid(id),{headers:{"X-Receipt-Secret":secret}}),id);if(!fresh())return;confirmed=value;if(pending&&pending.key===id)pending=null;receiptHost.replaceChildren(el("h3","Ограниченный статус квитанции"));renderStatus(value);if(ticket)receiptHost.append(button("Скачать квитанцию JSON",saveTicket));notice("Статус получен. Текст, контакты и файлы гостевому запросу не выдаются.");});}
    function receiptForm(){
      const f=el("form","","dispatch-form");f.append(el("h3","Проверить квитанцию"));const id=field(f,"receiptId","Номер квитанции","text",null,36),secret=field(f,"receiptSecret","Секрет квитанции","password",null,64);const file=field(f,"receiptFile","Или открыть файл квитанции","file");file.required=false;file.accept=".json,application/json";file.addEventListener("change",async()=>{const selected=file.files[0],stamp=generation;try{if(!selected||selected.size>4096)throw new Error("Некорректный файл квитанции.");const dto=object(JSON.parse(await selected.text()));if(stamp!==generation)return;if(dto.schema!==1||!UUID.test(dto.receiptId)||!/^[0-9a-f]{64}$/.test(dto.receiptSecret)||Object.keys(dto).some(k=>!["schema","receiptId","receiptSecret"].includes(k)))throw new Error("Некорректный файл квитанции.");id.value=dto.receiptId;secret.value=dto.receiptSecret;file.value="";}catch(e){if(stamp===generation)notice(e.message,true);}});
      const submit=el("button","Узнать статус");submit.type="submit";f.append(submit);f.addEventListener("submit",event=>{event.preventDefault();if(!f.reportValidity()||busy)return;if(!UUID.test(id.value)||!/^[0-9a-f]{64}$/.test(secret.value)){notice("Проверьте номер и секрет квитанции.",true);return;}const own={schema:1,receiptId:id.value,receiptSecret:secret.value};ticket=own;secret.value="";void readReceipt(own.receiptId,own.receiptSecret);});formHost.replaceChildren(f);update();
    }
    const onPageHide=()=>discardPrivate();
    global.addEventListener("pagehide",onPageHide);
    function destroy(){global.removeEventListener("pagehide",onPageHide);discardPrivate();root.replaceChildren();}
    navigation();notice("Выберите создание сообщения или проверку квитанции.");
    return {destroy,reset:()=>{discardPrivate();navigation();notice("Гостевые данные очищены.");}};
  }
  global.PortalDispatchUI=Object.freeze({create,mountPublic});
})(window);
