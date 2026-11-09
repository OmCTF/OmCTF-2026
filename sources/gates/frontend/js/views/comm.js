// Комендатура: двери кабинета коменданта. Внутрь пускают только по пропуску
// коменданта — депеши и ночная книга выдаются по предъявлении.

import { api } from '../api.js';
import { local } from '../store.js';
import { state, on } from '../state.js';
import { h, mount, stamp, select, typing, errorBox, fail, can } from '../ui.js';
import { sfx } from '../art.js';
import { envelopes } from './docs.js';

export function commView(container) {
  const me = state.me;
  const verdict = h('div');
  const results = h('div.comm-results');
  const slot = h('div');
  let docSource = '';
  let manual = '';

  function currentDoc() {
    if (docSource === 'manual') return manual;
    const p = local.folder(me.callsign).find((x) => x.id === docSource);
    return p ? p.xml : '';
  }

  function renderSlot() {
    const folder = local.folder(me.callsign);
    if (!docSource || (docSource !== 'manual' && !folder.some((p) => p.id === docSource))) {
      docSource = folder[0] ? folder[0].id : 'manual';
    }
    const sel = select([...folder.map((p) => [p.id, p.label]), ['manual', 'Вписать текст вручную…']], docSource, {
      onchange: (e) => { docSource = e.target.value; renderSlot(); },
    });
    const area = docSource === 'manual'
      ? h('textarea.input', { rows: 4, value: manual, placeholder: 'Текст пропуска', oninput: (e) => { manual = e.target.value; } })
      : null;
    mount(slot, h('label.field', h('span.field__label', 'Пропуск в окошко'), sel), area);
  }

  async function present(kind) {
    const doc = currentDoc().trim();
    if (!doc) { fail(new Error('Окошко пустое — вложите пропуск.')); return; }
    mount(results, typing('Часовой разглядывает печать'));
    mount(verdict);
    try {
      if (kind === 'dispatches') {
        const items = await api.dispatchesAccess(doc);
        sfx.stamp();
        mount(verdict, stamp('Пропустить', 'ok', 'stamp--land'));
        mount(results, h('div.paper', h('div.paper__head', h('h3', 'Депеши коменданта'), h('span.paper__kicker', `${items.length} конв.`)), envelopes(items)));
      } else {
        const r = await api.briefingsAccess(doc);
        sfx.stamp();
        mount(verdict, stamp('Пропустить', 'ok', 'stamp--land'));
        mount(results, h('div.paper', h('div.paper__head', h('h3', 'Ночная книга'), h('span.paper__kicker', `записей: ${r.count}`)), envelopes(r.items, { kind: 'Запись' })));
      }
    } catch (e) {
      sfx.denied();
      mount(verdict, stamp(e.status === 403 ? 'Вход воспрещён' : 'Не принято', 'deny', 'stamp--land'));
      mount(results, h('div.paper.paper--note', h('b', 'Часовой у дверей: '), e.message));
    }
  }

  async function byRank() {
    mount(results, typing());
    try {
      const r = await api.dispatches({ limit: 50 });
      mount(results, h('div.paper', h('div.paper__head', h('h3', 'Депеши по чину'), h('span.paper__kicker', `всего ${r.total}`)), envelopes(r.items)));
    } catch (e) {
      mount(results, errorBox(e, byRank));
    }
  }

  mount(container,
    h('div.view-head', h('div', h('h2', 'Комендатура'), h('p', 'У дверей кабинета стоит часовой. Депеши и ночную книгу выдают только тому, кто предъявит пропуск коменданта.'))),
    h('section.door',
      h('div.door__plaque', 'Кабинетъ коменданта', h('small', 'входъ по особому пропуску')),
      h('div.door__slot.dark.stack',
        slot,
        h('div.row',
          h('button.btn.btn--amber', { type: 'button', onclick: () => present('dispatches') }, 'Предъявить: депеши'),
          h('button.btn', { type: 'button', onclick: () => present('briefings') }, 'Предъявить: ночная книга'))),
      verdict,
      can(me, 'commandant')
        ? h('div.row', { style: { justifyContent: 'center', marginTop: '16px' } },
          h('button.btn.btn--sm', { type: 'button', onclick: byRank }, 'Депеши по чину коменданта'))
        : null),
    results);
  renderSlot();
  const off = on('folder', renderSlot);
  return { destroy: off };
}
