// Караул: принять, сдать, расчёт, послужной список, записки сменщиков.

import { api } from '../api.js';
import { state, refreshShift, refreshPurse } from '../state.js';
import {
  h, mount, modal, toast, fail, field, dl, typing, empty, errorBox, pager, clickableRow,
  fmtDate, fmtLongDate, pct, kop, RANK,
} from '../ui.js';
import { sfx } from '../art.js';
import { openCrossing } from './journal.js';

// Как строки расчётной книжки сводятся в листке расчёта.
const SETTLEMENT = [
  ['stamp_ok', 'Верные штампы'],
  ['samovar', 'Самовар'],
  ['streak', 'Премии за усердие'],
  ['wanted', 'Награды за поимку'],
  ['bounty', 'Приказ дня'],
  ['bribe', 'Подношения'],
  ['wage', 'Казённое жалованье'],
  ['stamp_miss', 'Замечания'],
  ['bribe_seized', 'Изъятые подношения'],
  ['audit', 'Ревизия'],
  ['rent', 'Квартирные'],
  ['wood', 'Дрова'],
  ['bread', 'Хлеб и щи'],
];

export async function lastHandoff(exceptId = null) {
  try {
    const r = await api.shifts({ limit: 20 });
    return r.items.find((x) => x.id !== exceptId && x.ended_at && x.handoff_notes) || null;
  } catch {
    return null;
  }
}

export async function startShiftFlow() {
  try {
    const sh = await api.shiftStart();
    sfx.stamp();
    toast(`Караул №${sh.id} принят. Окно открыто.`, 'ok');
    await refreshShift();
    const prev = await lastHandoff(sh.id);
    if (prev) {
      modal(h('div.stack',
        h('p.small.muted', `${prev.inspector_callsign} · сдал караул №${prev.id} · ${fmtDate(prev.ended_at)}`),
        h('div.paper.paper--note.pre', prev.handoff_notes)),
      { title: 'Записка от сменщика', size: 'sm' });
    }
  } catch (e) {
    fail(e);
  }
}

export function openEndShift() {
  const sh = state.shift;
  if (!sh) { toast('Караул не принят.'); return; }
  const notes = h('textarea.input', { maxlength: 2048, rows: 5, placeholder: 'Что передать сменщику: кто подозрителен, какие ворота закрыты…' });
  const submit = h('button.btn.btn--red', { type: 'submit' }, 'Сдать караул');
  const rates = state.purse ? state.purse.rates : null;
  let m = null;
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const ended = await api.shiftEnd(notes.value.trim());
        m.close();
        sfx.stamp();
        await Promise.all([refreshShift(), refreshPurse()]);
        openShiftReport(ended.id, { settlement: true });
      } catch (err) {
        fail(err);
        submit.disabled = false;
      }
    },
  },
  h('p', `Караул №${sh.id}: допущено ${sh.crossings_granted}, отказано ${sh.crossings_denied}, задержаний ${sh.incidents_count}.`),
  rates ? h('p.small.muted', `При сдаче: казённое жалованье +${rates.wage} коп., если поставлено не меньше ${rates.wage_min_stamps} штампов; квартирные, дрова и хлеб — из жалованья.`) : null,
  field('Записка сменщику', notes, 'Её прочтёт следующий караульный, когда заступит на пост.'),
  h('div.row.row--end',
    h('button.btn.btn--ink', { type: 'button', onclick: () => m.close() }, 'Остаться на посту'),
    submit));
  m = modal(form, { title: 'Сдать караул', size: 'md' });
  notes.focus();
}

function settlementTable(entries) {
  const sums = new Map();
  for (const e of entries) {
    const cur = sums.get(e.kind) || { amount: 0, count: 0 };
    cur.amount += e.amount;
    cur.count += 1;
    sums.set(e.kind, cur);
  }
  const rows = SETTLEMENT.filter(([kind]) => sums.has(kind)).map(([kind, label]) => {
    const { amount, count } = sums.get(kind);
    return h('tr', h('td', count > 1 ? `${label} (${count})` : label), h(`td.num${amount < 0 ? '.minus' : ''}`, `${amount > 0 ? '+' : ''}${amount}`));
  });
  const total = entries.reduce((a, e) => a + e.amount, 0);
  if (!sums.has('wage')) rows.push(h('tr', h('td.muted', 'Казённое жалованье — не положено, мало штампов'), h('td.num', '0')));
  return h('div.ledger-wrap', h('table.ledger', h('tbody', rows,
    h('tr', h('td', h('b', 'Итого за караул')), h('td.num', h('b', kop(total)))))));
}

function reportBody(r, entries) {
  const byZone = r.crossings_by_zone.length
    ? h('div.ledger-wrap', h('table.ledger',
      h('thead', h('tr', h('th', 'Место'), h('th.num', 'Допущено'), h('th.num', 'Отказано'))),
      h('tbody', r.crossings_by_zone.map((z) => h('tr', h('td', `№${z.zone} · ${z.zone_name}`), h('td.num', z.granted), h('td.num', z.denied))))))
    : empty('За караул никто не проходил.');
  const denials = r.recent_denials.length
    ? h('div.ledger-wrap', h('table.ledger',
      h('thead', h('tr', h('th', 'Запись'), h('th', 'Посетитель'), h('th', 'Причина'))),
      h('tbody', r.recent_denials.map((d) => clickableRow(() => openCrossing(d.crossing_id),
        h('td.mono-id', d.crossing_id), h('td', d.traveler, d.watchlist_hit ? h('span.pill.pill--critical', { style: { marginLeft: '6px' } }, 'розыск') : null), h('td', d.reason || '—'))))))
    : empty('Отказов не было.');
  return h('div.stack',
    dl([
      ['Караульный', r.inspector_callsign],
      ['Заступил', fmtDate(r.started_at)],
      ['Сдал', r.ended_at ? fmtDate(r.ended_at) : 'в карауле'],
      ['Допущено', r.crossings_granted],
      ['Отказано', r.crossings_denied],
      ['Доля отказов', pct(r.denial_rate)],
      ['Задержаний', r.incidents_count],
    ]),
    entries ? h('div', h('h3', 'Расчёт'), settlementTable(entries),
      state.purse ? h('p.small.muted', { style: { marginTop: '6px' } }, `На руках после расчёта: ${kop(state.purse.balance)}.`) : null) : null,
    h('div', h('h3', 'По местам назначения'), byZone),
    h('div', h('h3', 'Отказы'), denials));
}

export async function openShiftReport(id, { settlement = false } = {}) {
  const body = h('div', typing());
  modal(body, { title: settlement ? `Расчёт за караул №${id}` : `Рапорт о карауле №${id}`, size: 'lg' });
  try {
    const r = await api.shiftReport(id);
    let entries = null;
    if (state.me && r.inspector_callsign === state.me.callsign) {
      entries = (await api.ledger({ shift_id: id, limit: 200 })).items;
    }
    mount(body, reportBody(r, entries));
  } catch (e) {
    mount(body, errorBox(e));
  }
}

export function shiftView(container) {
  const me = state.me;
  const current = h('div.paper.tilt-l');
  const mine = h('div');
  const record = h('div');
  const handoffs = h('div');
  let offset = 0;

  function renderCurrent() {
    const sh = state.shift;
    if (sh) {
      mount(current,
        h('div.paper__head', h('h2', `Караул №${sh.id}`), h('span.paper__kicker', 'в карауле')),
        dl([
          ['Заступил', fmtDate(sh.started_at)],
          ['Допущено', sh.crossings_granted],
          ['Отказано', sh.crossings_denied],
          ['Задержаний', sh.incidents_count],
          ['На руках', state.purse ? kop(state.purse.balance) : '—'],
        ]),
        h('div.row', { style: { marginTop: '14px' } },
          h('button.btn.btn--red', { type: 'button', onclick: () => openEndShift() }, 'Сдать караул'),
          h('button.btn.btn--ink', { type: 'button', onclick: () => openShiftReport(sh.id) }, 'Рапорт')));
    } else {
      mount(current,
        h('div.paper__head', h('h2', 'Караул не принят'), h('span.paper__kicker', fmtLongDate())),
        h('p', 'Заступите в караул, чтобы открыть окно и вести журнал входов.'),
        h('button.btn.btn--amber', { type: 'button', onclick: () => startShiftFlow() }, 'Заступить в караул'));
    }
  }

  async function loadMine() {
    mount(mine, typing());
    try {
      const r = await api.shifts({ inspector: me.callsign, offset, limit: 8 });
      if (!r.items.length) { mount(mine, empty('Караулов ещё не было.')); return; }
      mount(mine,
        h('div.ledger-wrap', h('table.ledger',
          h('thead', h('tr', h('th', '№'), h('th', 'Заступил'), h('th', 'Сдал'), h('th.num', 'Доп.'), h('th.num', 'Отк.'), h('th.num', 'Розыск'))),
          h('tbody', r.items.map((x) => clickableRow(() => openShiftReport(x.id, { settlement: !!x.ended_at }),
            h('td.mono-id', x.id), h('td', fmtDate(x.started_at)), h('td', x.ended_at ? fmtDate(x.ended_at) : 'в карауле'),
            h('td.num', x.crossings_granted), h('td.num', x.crossings_denied), h('td.num', x.incidents_count)))))),
        pager(r, (o) => { offset = o; loadMine(); }));
    } catch (e) {
      mount(mine, errorBox(e, loadMine));
    }
  }

  async function loadRecord() {
    mount(record, typing());
    try {
      const p = await api.performance(me.callsign);
      mount(record, dl([
        ['Чин', RANK[me.rank] || me.rank],
        ['Караулов', `${p.total_shifts} (сдано ${p.completed_shifts})`],
        ['Записей в журнале', p.total_crossings],
        ['Допущено', p.crossings_granted],
        ['Отказано', p.crossings_denied],
        ['Доля отказов', pct(p.denial_rate)],
        ['Задержано по розыску', p.watchlist_hits],
        state.purse ? ['Лучшее усердие', `×${state.purse.best_streak}`] : null,
      ]));
    } catch (e) {
      mount(record, errorBox(e, loadRecord));
    }
  }

  async function loadHandoffs() {
    try {
      const r = await api.shifts({ limit: 30 });
      const notes = r.items.filter((x) => x.handoff_notes).slice(0, 6);
      mount(handoffs, notes.length
        ? h('div.notes', notes.map((x) => h('div.note',
          h('div.note__meta', `${x.inspector_callsign} · караул №${x.id} · ${fmtDate(x.ended_at)}`),
          h('div.note__text', x.handoff_notes))))
        : empty('Записок не оставляли.'));
    } catch (e) {
      mount(handoffs, errorBox(e, loadHandoffs));
    }
  }

  const oldPw = h('input.input', { type: 'password', autocomplete: 'current-password', required: true });
  const newPw = h('input.input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 4, maxlength: 128 });
  const pwForm = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.changePassword(oldPw.value, newPw.value);
        oldPw.value = '';
        newPw.value = '';
        toast('Пароль сменён.', 'ok');
      } catch (err) { fail(err); }
    },
  }, field('Нынешний пароль', oldPw), field('Новый пароль', newPw), h('div.row.row--end', h('button.btn.btn--ink', { type: 'submit' }, 'Сменить')));

  mount(container,
    h('div.view-head', h('div', h('h2', 'Караул'), h('p', 'Приём и сдача караула, рапорты и расчёты прошлых караулов, записки сменщиков и послужной список.'))),
    h('div.office',
      h('div.stack', current,
        h('div.paper', h('div.paper__head', h('h3', 'Записки сменщиков')), handoffs)),
      h('div.paper.paper--white', h('div.paper__head', h('h3', 'Мои караулы'), h('span.paper__kicker', me.callsign)), mine),
      h('div.stack',
        h('div.paper', h('div.paper__head', h('h3', 'Послужной список')), record),
        h('div.paper', h('div.paper__head', h('h3', 'Пароль')), pwForm))));

  renderCurrent();
  loadMine();
  loadRecord();
  loadHandoffs();
  return { onShift: () => { renderCurrent(); offset = 0; loadMine(); } };
}
