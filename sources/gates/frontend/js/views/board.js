// Доска приказов коменданта.

import { api } from '../api.js';
import { state } from '../state.js';
import {
  h, mount, modal, toast, fail, field, stamp, select, typing, empty, errorBox, pager, debounce, confirmBox,
  fmtDate, can, BUL_PRIORITY,
} from '../ui.js';
import { sfx } from '../art.js';

export function boardView(container) {
  const q = { offset: 0, limit: 24, q: '' };
  const board = h('div', typing());
  let freshId = null;

  const search = h('input.input', {
    type: 'search', placeholder: 'слово из заголовка или текста',
    oninput: debounce((e) => { q.q = e.target.value.trim(); q.offset = 0; load(); }, 350),
  });

  function notice(b) {
    const cls = ['paper', 'notice'];
    if (b.is_pinned) cls.push('notice--pinned');
    if (b.id === freshId) cls.push('notice--new');
    return h(`button.${cls.join('.')}`, {
      type: 'button',
      onclick: () => openBulletin(b.id, load),
      'aria-label': `Приказ ${b.title}`,
    },
    b.priority !== 'normal' ? stamp(BUL_PRIORITY[b.priority], b.priority === 'critical' ? 'deny' : 'gold', 'stamp--sm') : null,
    h('div.notice__meta', `№ ${b.id}${b.is_pinned ? ' · закреплён' : ''}`),
    h('div.notice__title', b.title),
    h('div.notice__meta', `${b.author_callsign} · ${fmtDate(b.created_at)}`),
    b.rendered ? h('div.notice__excerpt', b.rendered) : null);
  }

  async function load() {
    mount(board, typing());
    try {
      const data = await api.bulletins({ offset: q.offset, limit: q.limit, q: q.q });
      if (!data.items.length) {
        mount(board, h('div.cork', empty(q.q ? 'Приказов с такими словами нет.' : 'Доска пуста. Приказов не поступало.')));
        return;
      }
      mount(board, h('div.cork', data.items.map(notice)), data.total > q.limit ? h('div.paper.paper--white', { style: { marginTop: '14px' } }, pager(data, (o) => { q.offset = o; load(); })) : null);
      freshId = null;
    } catch (e) {
      mount(board, errorBox(e, load));
    }
  }

  mount(container,
    h('div.view-head',
      h('div', h('h2', 'Приказы по крепости'), h('p', 'Любой караульный может вывесить приказ. Закреплять, исправлять и снимать приказы с доски — дело начальника караула.')),
      h('button.btn.btn--amber', {
        type: 'button',
        onclick: () => openBulletinForm(null, (b) => { freshId = b.id; sfx.paper(); load(); }),
      }, 'Составить приказ')),
    h('div.toolbar.dark', h('label.field.field--grow', h('span.field__label', 'Поиск по доске'), search)),
    board);
  load();
}

export function openBulletinForm(existing, onSaved) {
  const title = h('input.input', { required: true, maxlength: 200, value: existing ? existing.title : '' });
  const prio = select(Object.entries(BUL_PRIORITY), existing ? existing.priority : 'normal');
  const body = h('textarea.input', { required: true, maxlength: 4096, rows: 8, value: existing ? existing.body : '' });
  const submit = h('button.btn.btn--amber', { type: 'submit' }, existing ? 'Исправить' : 'Вывесить на доску');
  let m = null;
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const payload = { title: title.value.trim(), body: body.value, priority: prio.value };
        const b = existing ? await api.updateBulletin(existing.id, payload) : await api.createBulletin(payload);
        m.close();
        toast(existing ? 'Приказ исправлен.' : `Приказ ${b.id} вывешен.`, 'ok');
        if (onSaved) onSaved(b);
      } catch (err) {
        fail(err);
        submit.disabled = false;
      }
    },
  },
  h('div.inspect__grid', field('Заголовок', title), field('Срочность', prio)),
  field('Текст приказа', body, 'Подстановки: {{ date }} — число, {{ time }} — время, {{ author }} — составитель, {{ checkpoint }} — пост.'),
  h('div.row.row--end', submit));
  m = modal(form, { title: existing ? `Исправление приказа ${existing.id}` : 'Новый приказ', size: 'md' });
  title.focus();
}

export async function openBulletin(id, onChange) {
  const body = h('div', typing());
  const m = modal(body, { title: 'Приказ', size: 'md' });

  function render(b) {
    const me = state.me;
    const source = h('pre.pre.paper.paper--white.small.hidden', b.body);
    const actions = h('div.row');
    if (can(me, 'senior')) {
      actions.append(
        h('button.btn.btn--ink.btn--sm', {
          type: 'button',
          onclick: async () => {
            try {
              const fresh = await api.pinBulletin(b.id, !b.is_pinned);
              render(fresh);
              if (onChange) onChange();
            } catch (e) { fail(e); }
          },
        }, b.is_pinned ? 'Открепить' : 'Закрепить'),
        h('button.btn.btn--ink.btn--sm', {
          type: 'button',
          onclick: () => { m.close(); openBulletinForm(b, () => { if (onChange) onChange(); }); },
        }, 'Исправить'),
        h('button.btn.btn--ink.btn--red.btn--sm', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmBox(`Снять приказ «${b.title}» с доски?`, { ok: 'Снять' }))) return;
            try {
              await api.deleteBulletin(b.id);
              m.close();
              toast('Приказ снят.', 'ok');
              if (onChange) onChange();
            } catch (e) { fail(e); }
          },
        }, 'Снять с доски'));
    }
    mount(body,
      h('div.row.row--between',
        h('span.paper__kicker', `Приказ № ${b.id}${b.is_pinned ? ' · закреплён' : ''}`),
        b.priority !== 'normal' ? stamp(BUL_PRIORITY[b.priority], b.priority === 'critical' ? 'deny' : 'gold', 'stamp--sm') : null),
      h('h3', { style: { margin: '10px 0 4px' } }, b.title),
      h('p.small.muted', `Составил ${b.author_callsign} · ${fmtDate(b.created_at)}`),
      h('div.bulletin-full__text', b.rendered),
      h('div.row.row--between',
        h('button.link.small', {
          type: 'button',
          onclick: (e) => {
            source.classList.toggle('hidden');
            e.target.textContent = source.classList.contains('hidden') ? 'Черновик приказа' : 'Скрыть черновик';
          },
        }, 'Черновик приказа'),
        actions),
      source);
  }

  try {
    render(await api.bulletin(id));
  } catch (e) {
    mount(body, errorBox(e));
  }
}
