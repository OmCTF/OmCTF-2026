// DOM-помощники. Все строки вставляются как текст — серверные данные никогда
// не попадают в innerHTML.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'required', 'readOnly']);

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = el.className ? `${el.className} ${v}` : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function mount(container, ...nodes) {
  container.replaceChildren();
  append(container, nodes);
  return container;
}

/* ---------- телеграммы ---------- */
let toastBox = null;
export function toast(message, kind = 'info', ms = 4200) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const head = kind === 'error' ? 'ТЕЛЕГРАММА · СРОЧНО' : kind === 'ok' ? 'ТЕЛЕГРАММА · ИСПОЛНЕНО' : 'ТЕЛЕГРАММА';
  const t = h(`div.toast.toast--${kind}`, h('span.toast__head', head), h('span', message));
  toastBox.append(t);
  setTimeout(() => {
    t.classList.add('toast--out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}
export function fail(err) {
  toast(err && err.message ? err.message : String(err), 'error');
}

/* ---------- модальные окна ---------- */
export function modal(content, { title, size = 'md', onClose } = {}) {
  const previous = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
    if (previous && previous.focus && previous.isConnected) previous.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && overlay === document.querySelector('.modal:last-of-type')) close();
  };
  const box = h(`div.modal__box.modal--${size}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Документ', tabindex: '-1' },
    h('button.modal__close', { type: 'button', 'aria-label': 'Закрыть', onclick: close }, '×'),
    title ? h('h2.modal__title', title) : null,
    content);
  const overlay = h('div.modal', { onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  box.focus();
  return { close, box, get closed() { return closed; } };
}

export function confirmBox(text, { ok = 'Подтвердить', cancel = 'Отмена', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal(
      h('div.confirm',
        h('p', text),
        h('div.row.row--end',
          h('button.btn.btn--ink', { type: 'button', onclick: () => finish(false) }, cancel),
          h(`button.btn${danger ? '.btn--red' : '.btn--green'}`, { type: 'button', onclick: () => finish(true) }, ok))),
      { title: 'Подтверждение', size: 'sm', onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

/* ---------- форматирование ---------- */
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}
export function fmtLongDate(d = new Date()) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} г.`;
}
export function fmtClock(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function pct(x) {
  return `${Math.round((Number(x) || 0) * 100)}%`;
}
export function kop(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '−' : ''}${Math.abs(v)} коп.`;
}

/* ---------- словарь ---------- */
export const RANK = { inspector: 'Караульный', senior: 'Начальник караула', commandant: 'Комендант' };
const RANK_ORDER = { inspector: 0, senior: 1, commandant: 2 };
export const can = (me, need) => (RANK_ORDER[me && me.rank] ?? -1) >= RANK_ORDER[need];

export const INC_STATUS = { open: 'Открыто', investigating: 'Расследуется', resolved: 'Разрешено', closed: 'Закрыто' };
export const INC_PRIORITY = { low: 'Низкая', normal: 'Обычная', high: 'Высокая', critical: 'Критическая' };
export const BUL_PRIORITY = { normal: 'Обычный', urgent: 'Срочно', critical: 'Критично' };
export const ZONE_STATUS = { open: 'Открыто', restricted: 'По допуску', lockdown: 'Закрыто' };
export const PASS_ROLE = { guest: 'Гость', resident: 'Житель', commandant: 'Комендант' };

/* ---------- мелкие элементы ---------- */
export function stamp(text, kind = 'ok', extra = '') {
  return h(`div.stamp.stamp--${kind}${extra ? `.${extra}` : ''}`, text);
}
export function field(label, control, hint) {
  return h('label.field', h('span.field__label', label), control, hint ? h('span.field__hint', hint) : null);
}
export function typing(text = 'Писарь переписывает') {
  return h('div.typing', text, h('span.caret', { 'aria-hidden': 'true' }));
}
export function empty(text) {
  return h('p.empty', text);
}
export function dl(pairs) {
  const el = h('dl.dl');
  for (const pair of pairs) {
    if (!pair) continue;
    const [k, v] = pair;
    el.append(h('dt', k), h('dd', v === null || v === undefined || v === '' ? '—' : v));
  }
  return el;
}
export function select(options, value, attrs = {}) {
  return h('select.input', attrs,
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
}
export function pager({ total, offset, limit }, onPage) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return h('div.pager',
    h('button.btn.btn--ink.btn--sm', { type: 'button', disabled: offset <= 0, onclick: () => onPage(Math.max(0, offset - limit)) }, '‹ Назад'),
    h('span', `Лист ${page} из ${pages} · всего записей: ${total}`),
    h('button.btn.btn--ink.btn--sm', { type: 'button', disabled: offset + limit >= total, onclick: () => onPage(offset + limit) }, 'Далее ›'));
}
export function errorBox(err, retry) {
  return h('div.paper.paper--note',
    h('p', h('b', 'Канцелярия не отвечает. '), err && err.message ? err.message : String(err)),
    retry ? h('button.btn.btn--ink.btn--sm', { type: 'button', onclick: retry }, 'Повторить') : null);
}

export function clickableRow(onOpen, ...cells) {
  return h('tr.clickable', {
    tabindex: '0',
    onclick: onOpen,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } },
  }, ...cells);
}

export function debounce(fn, ms = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- детерминированный «случай» ---------- */
export function hash(s) {
  let x = 2166136261;
  for (const ch of String(s)) {
    x ^= ch.codePointAt(0);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}
export function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
export const pickFrom = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

export function isFemaleName(name) {
  const MALE_A = new Set(['илья', 'никита', 'фома', 'кузьма', 'савва', 'лука', 'ерёма', 'гаврила', 'данила', 'мина']);
  const words = String(name).toLowerCase().split(/\s+/).slice(0, 2);
  if (words.some((w) => MALE_A.has(w))) return false;
  return words.some((w) => /(ая|ья|ия|на|ва|ла|ра|та|да|са|за|фья|ина|ова|ева)$/.test(w));
}
