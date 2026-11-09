// Канцелярия: папка пропусков, выдача пропусков, личный состав.

import { api } from '../api.js';
import { local } from '../store.js';
import { state, emit } from '../state.js';
import {
  h, mount, modal, toast, fail, field, dl, select, typing, empty, errorBox, pager, clickableRow, confirmBox,
  fmtDate, pct, can, RANK, PASS_ROLE,
} from '../ui.js';
import { passSummary } from '../pass.js';
import { openPass } from './docs.js';
import { sfx } from '../art.js';

export function officeView(container) {
  const me = state.me;
  const folderBox = h('div');
  const roster = h('div', typing());
  let offset = 0;

  function renderFolder() {
    const items = local.folder(me.callsign);
    mount(folderBox, items.length
      ? h('div.passes', items.map((p) => {
        const sum = passSummary(p.xml);
        const role = sum.role || p.role;
        return h('div.pass-chip',
          h('div.pass-chip__label', p.label),
          h('div.pass-chip__meta', `${sum.subject || p.subject || 'предъявитель не указан'} · ${PASS_ROLE[role] || role || 'категория не указана'} · вложен ${fmtDate(p.added)}`),
          h('div.row',
            h('button.btn.btn--ink.btn--sm', { type: 'button', onclick: () => openPass(p.xml, p.label) }, 'Открыть'),
            h('button.btn.btn--ink.btn--red.btn--sm', {
              type: 'button',
              'aria-label': `Выбросить ${p.label}`,
              onclick: async () => {
                if (!(await confirmBox(`Выбросить «${p.label}» из папки? Это касается только вашего браузера.`, { ok: 'Выбросить' }))) return;
                local.removePass(me.callsign, p.id);
                emit('folder');
                renderFolder();
              },
            }, '×')));
      }))
      : empty('Папка пуста. Личный пропуск выдаётся при каждом заступлении на пост.'));
  }

  const pasteLabel = h('input.input', { maxlength: 60, placeholder: 'например, пропуск купца Ямщикова' });
  const pasteText = h('textarea.input', { rows: 4, required: true, placeholder: 'Текст пропуска' });
  const pasteForm = h('form.stack', {
    onsubmit: (e) => {
      e.preventDefault();
      const xml = pasteText.value.trim();
      const sum = passSummary(xml);
      local.addPass(me.callsign, { label: pasteLabel.value.trim() || (sum.subject ? `Пропуск · ${sum.subject}` : 'Пропуск'), xml, subject: sum.subject, role: sum.role });
      pasteLabel.value = '';
      pasteText.value = '';
      sfx.paper();
      toast('Пропуск вложен в папку.', 'ok');
      emit('folder');
      renderFolder();
    },
  }, field('Надпись на обороте', pasteLabel), field('Пропуск', pasteText), h('div.row.row--end', h('button.btn.btn--ink', { type: 'submit' }, 'Вложить в папку')));

  let issueBox;
  if (can(me, 'senior')) {
    const subject = h('input.input', { required: true, maxlength: 128, placeholder: 'на чьё имя' });
    const role = select(Object.entries(PASS_ROLE), 'guest');
    const submit = h('button.btn.btn--amber', { type: 'submit' }, 'Выдать пропуск');
    issueBox = h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const r = await api.issuePass(subject.value.trim(), role.value);
          if (!r.transit_pass) throw new Error('Канцелярия не смогла выписать пропуск.');
          local.addPass(me.callsign, { label: `${PASS_ROLE[r.role] || r.role} · ${r.subject}`, xml: r.transit_pass, subject: r.subject, role: r.role });
          sfx.stamp();
          emit('folder');
          renderFolder();
          openPass(r.transit_pass, `Выписан пропуск: ${r.subject}`);
          subject.value = '';
        } catch (err) {
          fail(err);
        } finally {
          submit.disabled = false;
        }
      },
    }, h('p.small.muted', 'Выписанный пропуск ложится в вашу папку: его можно вручить посетителю при ручном досмотре.'),
    h('div.inspect__grid', field('Предъявитель', subject), field('Категория', role)),
    h('div.row.row--end', submit));
  } else {
    issueBox = h('p.small.muted', 'Пропуска выписывает начальник караула. Ваш личный гостевой пропуск выдаётся при каждом заступлении на пост и уже лежит в папке.');
  }

  async function loadRoster() {
    mount(roster, typing());
    try {
      const r = await api.inspectors({ offset, limit: 15 });
      mount(roster,
        h('div.ledger-wrap', h('table.ledger',
          h('thead', h('tr', h('th', 'Позывной'), h('th', 'Чин'), h('th', 'На службе с'))),
          h('tbody', r.items.map((i) => clickableRow(() => openProfile(i.callsign, loadRoster),
            h('td', h('b', i.callsign), i.callsign === me.callsign ? ' (вы)' : ''),
            h('td', RANK[i.rank] || i.rank),
            h('td', fmtDate(i.created_at, false))))))),
        pager(r, (o) => { offset = o; loadRoster(); }));
    } catch (e) {
      mount(roster, errorBox(e, loadRoster));
    }
  }

  const findIn = h('input.input', { required: true, maxlength: 64, placeholder: 'позывной' });
  const findForm = h('form.row', {
    onsubmit: (e) => { e.preventDefault(); openProfile(findIn.value.trim(), loadRoster); },
  }, h('label.field.grow', h('span.field__label', 'Найти по позывному'), findIn), h('button.btn.btn--ink', { type: 'submit' }, 'Найти'));

  mount(container,
    h('div.view-head', h('div', h('h2', 'Канцелярия'), h('p', 'Папка пропусков хранится только в этом браузере. Пропуск из папки можно положить на стол при досмотре или предъявить у дверей комендатуры.'))),
    h('div.office',
      h('div.paper', h('div.paper__head', h('h3', 'Папка пропусков'), h('span.paper__kicker', me.callsign)), folderBox,
        h('details', h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Вложить пропуск вручную'), h('div', { style: { marginTop: '10px' } }, pasteForm))),
      h('div.stack',
        h('div.paper.paper--white', h('div.paper__head', h('h3', 'Выдача пропусков')), issueBox),
        h('div.paper.paper--white', h('div.paper__head', h('h3', 'Личный состав')), roster, h('div', { style: { marginTop: '12px' } }, findForm)))));
  renderFolder();
  loadRoster();
}

async function openProfile(callsign, onChange) {
  const me = state.me;
  const body = h('div', typing());
  modal(body, { title: `Послужной лист: ${callsign}`, size: 'md' });

  async function render() {
    try {
      const [i, perf] = await Promise.all([api.inspector(callsign), api.performance(callsign).catch(() => null)]);
      const actions = h('div.stack');
      if (can(me, 'commandant') && i.callsign !== me.callsign) {
        const rank = select(Object.entries(RANK), i.rank);
        actions.append(
          h('form.row', {
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                await api.promote(i.callsign, rank.value);
                toast(`${i.callsign}: чин «${RANK[rank.value]}». Вступит в силу со следующего заступления.`, 'ok');
                render();
                if (onChange) onChange();
              } catch (err) { fail(err); }
            },
          }, h('label.field.grow', h('span.field__label', 'Чин'), rank), h('button.btn.btn--ink.btn--sm', { type: 'submit' }, 'Утвердить чин')),
          h('div.row.row--end', i.is_active
            ? h('button.btn.btn--red.btn--sm', {
              type: 'button',
              onclick: async () => {
                if (!(await confirmBox(`Отстранить ${i.callsign} от службы? Его сеансы будут прерваны.`, { ok: 'Отстранить' }))) return;
                try { await api.deactivate(i.callsign); toast('Отстранён.', 'ok'); render(); if (onChange) onChange(); } catch (err) { fail(err); }
              },
            }, 'Отстранить от службы')
            : h('button.btn.btn--green.btn--sm', {
              type: 'button',
              onclick: async () => {
                try { await api.reactivate(i.callsign); toast('Возвращён на службу.', 'ok'); render(); if (onChange) onChange(); } catch (err) { fail(err); }
              },
            }, 'Вернуть на службу')));
      }
      mount(body,
        dl([
          ['Позывной', i.callsign],
          ['Чин', RANK[i.rank] || i.rank],
          ['Состояние', i.is_active ? 'на службе' : 'отстранён'],
          ['На службе с', fmtDate(i.created_at)],
        ]),
        perf ? h('div', { style: { marginTop: '14px' } }, dl([
          ['Караулов', `${perf.total_shifts} (сдано ${perf.completed_shifts})`],
          ['Записей в журнале', perf.total_crossings],
          ['Допущено / отказано', `${perf.crossings_granted} / ${perf.crossings_denied}`],
          ['Доля отказов', pct(perf.denial_rate)],
          ['Задержано по розыску', perf.watchlist_hits],
        ])) : null,
        actions.childNodes.length ? h('div', { style: { marginTop: '16px' } }, actions) : null);
    } catch (e) {
      mount(body, errorBox(e));
    }
  }
  render();
}
