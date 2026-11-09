
(() => {
  "use strict";
  const BASE = "/public-hydrology/hs/hydrology/v1/", LIMIT = 1024 * 1024;
  const PATH = /^(?:reference|posts|posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/series)(?:\?[^#]*)?$/i;
  const failure = (status, code) => Object.assign(new Error("Запрос публичной гидрологии не выполнен"), { status, code });
  async function request(path, options = {}) {
    if (!PATH.test(path) || options.method && options.method !== "GET" || options.body || options.headers) throw failure(400, "некорректно_публичный_запрос");
    const url = new URL(BASE + path, location.origin), query = [...url.searchParams.keys()];
    const allowed = url.pathname.endsWith("/series") ? ["from", "to", "afterTime", "limit", "cursor"] : url.pathname.endsWith("/posts") ? ["limit", "cursor", "riverCode"] : [];
    if (query.some(key => !allowed.includes(key)) || new Set(query).size !== query.length) throw failure(400, "некорректно_публичный_запрос");
    const controller = new AbortController(), abort = () => controller.abort(), timeout = setTimeout(abort, 15000);
    if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw failure(response.status, "хттп_ошибка");
      if (Number(response.headers.get("content-length") || 0) > LIMIT) throw failure(response.status, "некорректно_ответ");
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > LIMIT) { await reader.cancel(); throw failure(response.status, "некорректно_ответ"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let value;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw failure(response.status, "некорректно_ответ"); }
      if (!response.ok) {
        const code = typeof value?.error?.code === "string" ? value.error.code : value?.error;
        const error = failure(response.status, typeof code === "string" && code.length <= 120 ? code : "хттп_ошибка");
        if (typeof value?.requestId === "string" && value.requestId.length <= 80) error.requestId = value.requestId;
        throw error;
      }
      return value;
    } catch (error) {
      if (Number.isInteger(error.status)) throw error;
      throw failure(0, error.name === "AbortError" ? "запрос_прервано" : "сеть_ошибка");
    } finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); }
  }
  globalThis.VodokanalHydrologyPublic = Object.freeze({ request });
  const root = document.getElementById("hydrology-app");
  if (root && globalThis.VodokanalHydrology) {
    const view = globalThis.VodokanalHydrology.createPublic({ root, request });
    view.load();
  }
})();
