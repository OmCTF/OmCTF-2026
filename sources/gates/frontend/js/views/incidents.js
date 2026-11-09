// Происшествия: дела, заметки, разрешение и закрытие.

import { api } from '../api.js';
import { state } from '../state.js';
import {
  h, mount, modal, toast, fail, field, dl, stamp, select, typing, empty, errorBox, pager, clickableRow,
  debounce, fmtDate, can, INC_STATUS, INC_PRIORITY,
} from '../ui.js';
import { openCrossing } from './journal.js';

const STATUS_ORDER = ['', 'open', 'investigating', 'resolved', 'closed'];

export function incidentsView(container) {
  const q = { offset: 0, limit: 20, status: '', priority: '', q: '', mine: false };
  const counters = h('div.counters');
  const list = h('div', typing());
  const reload = () => { q.offset = 0; load(); };

  const statusBtns = STATUS_ORDER.map((st) => h('button', {
    type: 'button',
    'aria-pressed': String(st === q.status),
    onclick: () => {
      q.status = st;
      statusBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(STATUS_ORDER[i] === st)));
      reload();
    },
  }, st ? INC_STATUS[st] : 'Все'));

  const prioSel = select([['', 'Любая важность'], ...Object.entries(INC_PRIORITY)], '', { onchange: (e) => { q.priority = e.target.value; reload(); } });
  const search = h('input.input', { type: 'search', placeholder: 'заголовок или описание', oninput: debounce((e) => { q.q = e.target.value.trim(); reload(); }, 350) });
  const mine = h('input', { type: 'checkbox', onchange: (e) => { q.mine = e.target.checked; reload(); } });

  async function loadStats() {
    try {
      const s = await api.incidentStats();
      mount(counters,
        ...['open', 'investigating', 'resolved', 'closed'].map((k) => h('div.counter', INC_STATUS[k], h('b', s[k] ?? 0))),
        h('div.counter', 'Всего дел', h('b', s.total ?? 0)));
    } catch { mount(counters); }
  }

  async function load() {
    mount(list, typing());
    try {
      const data = await api.incidents({ offset: q.offset, limit: q.limit, status: q.status, priority: q.priority, q: q.q, mine: q.mine ? 'true' : '' });
      if (!data.items.length) { mount(list, empty('Дел нет. Тихо у ворот.')); return; }
      mount(list,
        h('div.ledger-wrap', h('table.ledger',
          h('thead', h('tr', h('th', 'Дело'), h('th', 'Заголовок'), h('th', 'Важность'), h('th', 'Состояние'), h('th', 'Заявил'), h('th', 'Ведёт'), h('th', 'Заведено'))),
          h('tbody', data.items.map((i) => clickableRow(() => openIncident(i.id, { onChange: () => { load(); loadStats(); } }),
            h('td.mono-id', i.id),
            h('td', i.title),
            h('td', h(`span.pill.pill--${i.priority}`, INC_PRIORITY[i.priority] || i.priority)),
            h('td', INC_STATUS[i.status] || i.status),
            h('td', i.reporter_callsign),
            h('td', i.assignee_callsign || '—'),
            h('td', fmtDate(i.created_at))))))),
        pager(data, (o) => { q.offset = o; load(); }));
    } catch (e) {
      mount(list, errorBox(e, load));
    }
  }

  mount(container,
    h('div.view-head',
      h('div', h('h2', 'Происшествия'), h('p', 'Дела заводятся автоматически при задержании по розыску или вручную любым караульным. Разрешить дело может любой; назначать исполнителя и закрывать — начальник караула.')),
      h('button.btn.btn--amber', { type: 'button', onclick: () => openNewIncident({}, () => { load(); loadStats(); }) }, 'Завести дело')),
    counters,
    h('div.toolbar.dark',
      h('label.field.field--grow', h('span.field__label', 'Поиск'), search),
      h('label.field', h('span.field__label', 'Важность'), prioSel),
      h('label.check', mine, 'мои дела')),
    h('div.paper.paper--white.ledger-paper', h('div.statusbar', statusBtns), list));
  loadStats();
  load();
}

export function openNewIncident(prefill = {}, onCreated = null) {
  const title = h('input.input', { required: true, maxlength: 200, value: prefill.title || '' });
  const desc = h('textarea.input', { required: true, maxlength: 4096, rows: 5, placeholder: 'Что произошло, кто замешан, какие бумаги предъявлены…' });
  const prio = select(Object.entries(INC_PRIORITY), prefill.priority || 'normal');
  const crossing = h('input.input', { maxlength: 32, value: prefill.crossing_id || '', placeholder: 'CRS-…' });
  const submit = h('button.btn.btn--amber', { type: 'submit' }, 'Завести');
  let m = null;
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const i = await api.createIncident({
          title: title.value.trim(), description: desc.value.trim(), priority: prio.value,
          crossing_id: crossing.value.trim() || null,
        });
        m.close();
        toast(`Заведено дело ${i.id}.`, 'ok');
        if (onCreated) onCreated(i);
        openIncident(i.id, { onChange: onCreated });
      } catch (err) {
        fail(err);
        submit.disabled = false;
      }
    },
  },
  field('Заголовок', title),
  field('Обстоятельства', desc),
  h('div.inspect__grid', field('Важность', prio), field('Запись журнала', crossing, 'если дело связано с проходом через ворота')),
  h('div.row.row--end', submit));
  m = modal(form, { title: 'Новое дело', size: 'md' });
  title.focus();
}

export async function openIncident(id, { onChange = null } = {}) {
  const body = h('div', typing());
  modal(body, { title: `Дело № ${id}`, size: 'lg' });
  let roster = null;

  const changed = (i) => {
    render(i);
    if (onChange) onChange(i);
  };

  async function act(fn, okText) {
    try {
      const i = await fn();
      if (okText) toast(okText, 'ok');
      changed(i);
    } catch (e) { fail(e); }
  }

  function render(i) {
    const me = state.me;
    const notesList = i.notes.length
      ? h('div.notes', i.notes.map((n) => h('div.note', h('div.note__meta', `${n.author_callsign} · ${fmtDate(n.created_at)}`), h('div.note__text', n.content))))
      : h('p.empty', 'Заметок нет.');

    const noteIn = h('textarea.input', { rows: 3, maxlength: 2048, required: true, placeholder: 'Новая заметка к делу' });
    const noteForm = i.status !== 'closed' ? h('form.stack', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.addIncidentNote(i.id, noteIn.value.trim());
          const fresh = await api.incident(i.id);
          changed(fresh);
        } catch (err) { fail(err); }
      },
    }, noteIn, h('div.row.row--end', h('button.btn.btn--ink.btn--sm', { type: 'submit' }, 'Подшить заметку'))) : null;

    const actions = h('div.stack');
    if (i.status !== 'closed') {
      const reportSummary = h('textarea.input', {
        rows: 2,
        maxlength: 2048,
        required: true,
        value: 'Просьба сверить сведения по делу.',
      });
      const evidenceFile = h('input.input', {
        type: 'file',
        accept: '.pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain',
      });
      const reportSubmit = h('button.btn.btn--ink', { type: 'submit' }, 'Передать в канцелярию');
      actions.append(h('form.stack', {
        onsubmit: async (e) => {
          e.preventDefault();
          reportSubmit.disabled = true;
          try {
            const report = { summary: reportSummary.value.trim() };
            const file = evidenceFile.files?.[0];
            if (file) {
              if (file.size > 65536) throw new Error('Размер приложения не должен превышать 64 КиБ.');
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 8192) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              }
              report.attachment = {
                filename: file.name,
                content_type: file.type || 'application/octet-stream',
                data_base64: btoa(binary),
              };
            }
            await api.requestCorroboration(i.id, report);
            toast('Запрос сверки передан в канцелярию.', 'ok');
            setTimeout(async () => {
              try { changed(await api.incident(i.id)); } catch { /* The case view may have closed. */ }
            }, 250);
          } catch (err) {
            fail(err);
            reportSubmit.disabled = false;
          }
        },
      }, field('Сопроводительная записка', reportSummary),
      field('Скан или выписка (необязательно, до 64 КиБ)', evidenceFile),
      h('div.row.row--end', reportSubmit)));
    }
    if (i.status === 'open' || i.status === 'investigating') {
      const resolution = h('textarea.input', { rows: 3, maxlength: 4096, required: true, placeholder: 'Заключение: чем кончилось дело' });
      actions.append(h('form.stack', {
        onsubmit: (e) => { e.preventDefault(); act(() => api.resolveIncident(i.id, resolution.value.trim()), 'Дело разрешено.'); },
      }, field('Заключение', resolution), h('div.row.row--end', h('button.btn.btn--green', { type: 'submit' }, 'Разрешить дело'))));
    }
    if (can(me, 'senior') && (i.status === 'open' || i.status === 'investigating')) {
      const listId = `roster-${i.id}`;
      const who = h('input.input', { list: listId, placeholder: 'позывной', required: true, value: i.assignee_callsign || '' });
      const dlist = h('datalist', { id: listId });
      const fillRoster = async () => {
        if (!roster) {
          try { roster = (await api.inspectors({ limit: 200 })).items; } catch { roster = []; }
        }
        mount(dlist, ...roster.map((r) => h('option', { value: r.callsign })));
      };
      fillRoster();
      actions.append(h('form.row', {
        onsubmit: (e) => { e.preventDefault(); act(() => api.assignIncident(i.id, who.value.trim()), 'Исполнитель назначен.'); },
      }, h('label.field.grow', h('span.field__label', 'Поручить караульному'), who, dlist), h('button.btn.btn--ink', { type: 'submit' }, 'Поручить')));
    }
    if (can(me, 'senior') && i.status === 'resolved') {
      actions.append(h('div.row.row--end', h('button.btn.btn--red', { type: 'button', onclick: () => act(() => api.closeIncident(i.id), 'Дело сдано в архив.') }, 'Закрыть и сдать в архив')));
    }

    const finished = i.status === 'resolved' || i.status === 'closed';
    mount(body, h('div.casefile', { style: { marginTop: '30px' } },
      h('span.casefile__tab', `ДЕЛО № ${i.id}`),
      stamp(INC_STATUS[i.status] || i.status, finished ? 'ok' : 'deny', 'stamp--sm'),
      h('div.casefile__body.stack',
        h('h3', i.title),
        dl([
          ['Важность', INC_PRIORITY[i.priority] || i.priority],
          ['Заявил', i.reporter_callsign],
          ['Ведёт', i.assignee_callsign || 'не назначен'],
          ['Заведено', fmtDate(i.created_at)],
          ['Обновлено', fmtDate(i.updated_at)],
          i.crossing_id ? ['Запись журнала', h('button.link', { type: 'button', onclick: () => openCrossing(i.crossing_id) }, i.crossing_id)] : null,
          i.resolved_at ? ['Разрешено', fmtDate(i.resolved_at)] : null,
        ]),
        h('div.paper.paper--white', h('p.pre', i.description)),
        i.resolution_notes ? h('div.paper.paper--note', h('b', 'Заключение: '), h('span.pre', i.resolution_notes)) : null,
        h('h3', { style: { fontSize: '13px' } }, 'Заметки'),
        notesList,
        noteForm,
        actions.childNodes.length ? h('div', h('h3', { style: { fontSize: '13px', marginBottom: '8px' } }, 'Распоряжения'), actions) : null)));
  }

  try {
    render(await api.incident(id));
  } catch (e) {
    mount(body, errorBox(e));
  }
}
