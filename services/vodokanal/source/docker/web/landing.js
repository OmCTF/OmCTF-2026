(() => {
  "use strict";
  const host = document.getElementById("landing-news");
  if (!host) return;
  const API = "/public-portal/hs/portal/v1/";
  const doc = host.ownerDocument;
  const el = (tag, text, cls = "") => { const node = doc.createElement(tag); node.textContent = text; node.className = cls; return node; };
  function message(text) {
    const box = el("p", text + " ", "rv-empty"), link = el("a", "Открыть объявления и документы");
    link.href = "/services#archive"; box.append(link); host.replaceChildren(box);
  }
  function stamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) + "Z" !== value) throw new Error("некорректно_дата");
    return new Date(value).toLocaleDateString("ru-RU", { day:"2-digit", month:"long", year:"numeric", timeZone:"UTC" });
  }
  async function load() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const to = new Date(); to.setUTCHours(0, 0, 0, 0); to.setUTCDate(to.getUTCDate() + 1);
      const from = new Date(to); from.setUTCDate(from.getUTCDate() - 365);
      const wire = value => value.toISOString().slice(0, 19) + "Z";
      const query = new URLSearchParams({ limit:"3", kind:"announcement", from:wire(from), to:wire(to) });
      const response = await fetch(API + "content?" + query, { method:"GET", credentials:"omit", cache:"no-store", redirect:"error", signal:controller.signal, headers:{ Accept:"application/json" } });
      if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") || "")) throw new Error("Недоступно");
      const body = await response.text(); if (body.length > 256 * 1024) throw new Error("Превышен допустимый размер");
      const data = JSON.parse(body);
      if (!data || !Array.isArray(data.items) || data.items.length > 3 || data.limit !== 3 || typeof data.hasMore !== "boolean" || typeof data.nextCursor !== "string") throw new Error("некорректно_ответ");
      stamp(data.snapshotAt);
      const rows = data.items.map(item => {
        if (!item || item.kind !== "announcement" || !["Published", "Archived"].includes(item.state) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200 || typeof item.body !== "string" || item.body.length > 8000 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id)) throw new Error("некорректно_элемент");
        return { ...item, date:stamp(item.publishedAt) };
      }).filter(item => item.state === "Published");
      if (!rows.length) { message("Новых объявлений в последней выборке нет. Сохранённые публикации доступны в архиве."); return; }
      const cards = rows.map(item => {
        const card = el("article", "", "rv-news-item"), date = el("time", item.date), title = el("h3", item.title), link = el("a", "Читать в архиве →");
        date.dateTime = item.publishedAt; link.href = "/services#archive"; card.append(date, title, link); return card;
      });
      host.replaceChildren(...cards);
    } catch (_) { message("Не удалось загрузить объявления. Попробуйте открыть архив."); }
    finally { clearTimeout(timer); }
  }
  load();
})();
