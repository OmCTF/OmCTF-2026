// Бумаги, которые кладутся на стол: пропуск, депеши, записки.

import { h, dl, fmtDate, modal, toast, PASS_ROLE } from '../ui.js';
import { parsePass, passRole } from '../pass.js';
import { seal } from '../art.js';

export function passPaper(text, { stamps = null, caption = null } = {}) {
  const p = parsePass(text);
  if (!p.ok) {
    return h('div.paper.doc.doc--scrap',
      h('pre.doc__hand', p.raw || '(документ не предъявлен)'),
      stamps ? h('div.doc__stamps', stamps) : null);
  }
  const role = passRole(p);
  const extra = Object.entries(p.attrs).filter(([k]) => !/role|rank|level|category/i.test(k));
  const front = h('div.doc__front',
    h('div.doc__title', 'Пропускъ'),
    h('div.doc__sub', caption || 'въ Омскую крѣпость'),
    dl([
      ['№', p.id],
      ['Предъявитель', p.subject],
      ['Категория', role ? (PASS_ROLE[role] || role) : null],
      ['Выдан', fmtDate(p.issued)],
      ['Годен с', p.notBefore ? fmtDate(p.notBefore) : null],
      ['Годен по', p.notAfter ? fmtDate(p.notAfter) : null],
      ['Выдал', p.issuer],
      ...extra.map(([k, v]) => [k, v]),
      ['Печать', p.sealed ? 'приложена' : 'отсутствует'],
    ]),
    p.sealed ? h('div.doc__seal', seal({ size: 78 })) : null,
    stamps ? h('div.doc__stamps', stamps) : null);
  const back = h('pre.doc__raw.hidden', p.xml);
  const flipBtn = h('button.link.small', {
    type: 'button',
    onclick: () => {
      const showBack = back.classList.contains('hidden');
      back.classList.toggle('hidden', !showBack);
      front.classList.toggle('hidden', showBack);
      flipBtn.textContent = showBack ? 'Лицевая сторона' : 'Оборот (текст документа)';
    },
  }, 'Оборот (текст документа)');
  const copyBtn = h('button.link.small', {
    type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(p.raw);
        toast('Текст пропуска скопирован.', 'ok');
      } catch {
        toast('Не удалось скопировать — выделите текст на обороте вручную.', 'error');
      }
    },
  }, 'Копировать');
  return h('div.paper.doc', h('div.doc__band'), front, back, h('div.doc__flip', flipBtn, copyBtn));
}

export function openPass(text, title = 'Пропуск') {
  modal(passPaper(text), { title, size: 'md' });
}

export function envelopes(items, { kind = 'Депеша' } = {}) {
  const entries = Array.isArray(items)
    ? items.map((d) => [d.id ?? d.key, d.content, d.created_at])
    : Object.entries(items || {}).map(([k, v]) => [k, v, null]);
  if (!entries.length) return h('p.empty', 'Конвертов нет.');
  return h('div', entries.map(([id, content, at]) =>
    h('div.envelope',
      h('div.envelope__head', h('span', `${kind} · ${id}`), h('span.wax', { 'aria-hidden': 'true' })),
      h('p.pre', content),
      at ? h('p.small.muted', fmtDate(at)) : null)));
}
