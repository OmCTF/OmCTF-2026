// Журнал входов: кто вошёл, когда и куда.

import { api } from '../api.js';
import { state, zoneName } from '../state.js';
import {
  h, mount, modal, dl, stamp, select, typing, empty, errorBox, pager, clickableRow, debounce, fmtDate,
  INC_STATUS,
} from '../ui.js';
import { openIncident, openNewIncident } from './incidents.js';

export function journalView(container) {
  const q = { offset: 0, limit: 25, zone: '', granted: '', watchlist_hit: false, traveler: '', mine: false };
  const list = h('div', typing());
  const reload = () => { q.offset = 0; load(); };

  const zoneSel = select([['', 'Все места'], ...state.zones.map((z) => [z.zone, `№${z.zone} · ${z.name}`])], '', {
    onchange: (e) => { q.zone = e.target.value; reload(); },
  });
  const outcomeSel = select([['', 'Любое решение'], ['true', 'Допущен'], ['false', 'Отказано']], '', {
    onchange: (e) => { q.granted = e.target.value; reload(); },
  });
  const search = h('input.input', {
    type: 'search', placeholder: 'фамилия или имя', maxlength: 128,
    oninput: debounce((e) => { q.traveler = e.target.value.trim(); reload(); }, 350),
  });
  const wanted = h('input', { type: 'checkbox', onchange: (e) => { q.watchlist_hit = e.target.checked; reload(); } });
  const mine = h('input', { type: 'checkbox', onchange: (e) => { q.mine = e.target.checked; reload(); } });

  async function load() {
    mount(list, typing());
    try {
      const data = await api.crossings({
        offset: q.offset, limit: q.limit, zone: q.zone, granted: q.granted, traveler: q.traveler,
        watchlist_hit: q.watchlist_hit ? 'true' : '', mine: q.mine ? 'true' : '',
      });
      if (!data.items.length) {
        mount(list, empty('Записей по таким приметам нет.'));
        return;
      }
      mount(list,
        h('div.ledger-wrap', h('table.ledger',
          h('thead', h('tr', h('th', 'Запись'), h('th', 'Время'), h('th', 'Посетитель'), h('th', 'Куда'), h('th', 'Решение'), h('th', 'Розыск'))),
          h('tbody', data.items.map((c) => clickableRow(() => openCrossing(c.id),
            h('td.mono-id', c.id),
            h('td', fmtDate(c.created_at)),
            h('td', c.traveler_name),
            h('td', zoneName(c.zone)),
            h(`td.verdict.${c.granted ? 'verdict--ok' : 'verdict--deny'}`, c.granted ? 'Допущен' : 'Отказано'),
            h('td', c.watchlist_hit ? h('span.pill.pill--critical', 'розыск') : '—')))))),
        pager(data, (o) => { q.offset = o; load(); }));
    } catch (e) {
      mount(list, errorBox(e, load));
    }
  }

  mount(container,
    h('div.view-head', h('div', h('h2', 'Журнал входов'), h('p', 'Каждое решение у ворот записывается сюда. Нажмите на запись, чтобы открыть её и завести по ней дело.'))),
    h('div.toolbar.dark',
      h('label.field.field--grow', h('span.field__label', 'Посетитель'), search),
      h('label.field', h('span.field__label', 'Куда'), zoneSel),
      h('label.field', h('span.field__label', 'Решение'), outcomeSel),
      h('label.check', wanted, 'только розыск'),
      h('label.check', mine, 'только мои')),
    h('div.paper.paper--white.ledger-paper', list));
  load();
  return { onShift: load };
}

export async function openCrossing(id) {
  const body = h('div', typing());
  const m = modal(body, { title: `Запись журнала ${id}`, size: 'md' });
  try {
    const [c, inc] = await Promise.all([
      api.crossingById(id),
      api.incidents({ crossing_id: id, limit: 20 }).catch(() => ({ items: [] })),
    ]);
    mount(body,
      h('div', { style: { position: 'relative' } },
        dl([
          ['Посетитель', c.traveler_name],
          ['Куда', `№${c.zone} · ${c.zone_name}`],
          ['Пропуск', c.document_level_name],
          ['Решение', c.granted ? 'допущен' : 'отказано'],
          c.deny_reason ? ['Причина', c.deny_reason] : null,
          ['Розыск', c.watchlist_hit ? 'совпадение' : 'нет'],
          ['Караульный', c.inspector_callsign],
          ['Время', fmtDate(c.created_at)],
          c.notes ? ['Пометки', c.notes] : null,
        ]),
        h('div.crossing-stamp',
          stamp(c.granted ? 'Допущен' : 'Отказано', c.granted ? 'ok' : 'deny', 'stamp--oval'))),
      h('h3', { style: { margin: '18px 0 8px', fontSize: '13px' } }, 'Дела по этой записи'),
      inc.items.length
        ? h('table.ledger', h('tbody', inc.items.map((i) => clickableRow(() => { m.close(); openIncident(i.id); },
          h('td.mono-id', i.id), h('td', i.title), h('td', INC_STATUS[i.status] || i.status)))))
        : h('p.empty', 'Дел не заводили.'),
      h('div.row.row--end', { style: { marginTop: '14px' } },
        h('button.btn.btn--ink', {
          type: 'button',
          onclick: () => { m.close(); openNewIncident({ crossing_id: c.id, title: `По записи ${c.id}: ${c.traveler_name}` }); },
        }, 'Завести дело')));
  } catch (e) {
    mount(body, errorBox(e));
  }
}
