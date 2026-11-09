// Разбор транзитного документа для показа на столе караульного.
// Только отображение: подлинность печати проверяет канцелярия (/checkpoint/verify).

function maybeBase64(s) {
  const compact = s.replace(/\s+/g, '');
  if (compact.length < 40 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  try {
    const bin = atob(compact.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes).trim();
    return text.startsWith('<') ? text : null;
  } catch {
    return null;
  }
}

export function parsePass(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, raw };
  const xml = raw.startsWith('<') ? raw : maybeBase64(raw);
  if (!xml) return { ok: false, raw };

  let doc;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return { ok: false, raw };
  }
  if (doc.getElementsByTagName('parsererror').length) return { ok: false, raw };

  const first = (name) => doc.getElementsByTagNameNS('*', name)[0] || null;
  const txt = (name) => {
    const el = first(name);
    return el && el.textContent ? el.textContent.trim() : null;
  };
  const attrs = {};
  for (const a of doc.getElementsByTagNameNS('*', 'Attribute')) {
    const key = a.getAttribute('Name') || a.getAttribute('FriendlyName');
    if (!key) continue;
    const values = [...a.getElementsByTagNameNS('*', 'AttributeValue')].map((v) => v.textContent.trim());
    attrs[key] = values.join(', ');
  }
  const cond = first('Conditions');
  const root = doc.documentElement;
  return {
    ok: true,
    raw,
    xml,
    id: root.getAttribute('ID') || root.getAttribute('Id') || null,
    issued: root.getAttribute('IssueInstant') || null,
    subject: txt('NameID'),
    issuer: txt('Issuer'),
    attrs,
    notBefore: cond ? cond.getAttribute('NotBefore') : null,
    notAfter: cond ? cond.getAttribute('NotOnOrAfter') : null,
    sealed: doc.getElementsByTagNameNS('*', 'Signature').length > 0,
  };
}

export function passRole(p) {
  if (!p || !p.ok) return null;
  for (const [k, v] of Object.entries(p.attrs)) {
    if (/role|rank|level|category/i.test(k)) return v;
  }
  return null;
}

export function passSummary(text) {
  const p = parsePass(text);
  return { subject: p.ok ? p.subject : null, role: passRole(p) };
}
