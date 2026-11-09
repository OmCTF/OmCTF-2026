// Розыскные листы на стене караульной.

import { api } from '../api.js';
import { state } from '../state.js';
import {
  h, mount, modal, toast, fail, field, typing, empty, errorBox, pager, debounce, confirmBox,
  fmtDate, can, isFemaleName,
} from '../ui.js';
import { portrait, sfx } from '../art.js';

export function wantedView(container) {
  const me = state.me;
  const q = { offset: 0, limit: 24, q: '' };
  const wall = h('div', typing());
  const checkResult = h('div.checks');

  const checkIn = h('input.input', { required: true, maxlength: 128, placeholder: 'Фамилия Имя' });
  const checkForm = h('form.row', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api.watchlistCheck(checkIn.value.trim());
        if (r.found) sfx.bell(); else sfx.paper();
        mount(checkResult, r.found
          ? h('div.check-line.check-line--bad', `РАЗЫСКИВАЕТСЯ: ${r.name}. ${r.reason || ''}${r.added_by ? ` (объявил ${r.added_by})` : ''}`)
          : h('div.check-line.check-line--ok', `«${r.name}» в розыскных листах не значится.`));
      } catch (err) { fail(err); }
    },
  }, h('label.field.grow', h('span.field__label', 'Сверить имя'), checkIn), h('button.btn.btn--ink', { type: 'submit' }, 'Сверить'));

  const search = h('input.input', {
    type: 'search', placeholder: 'часть имени',
    oninput: debounce((e) => { q.q = e.target.value.trim(); q.offset = 0; load(); }, 350),
  });

  function poster(e) {
    return h('article.poster',
      h('div.poster__head', 'Разыскивается'),
      h('div.poster__face', portrait(e.name, { px: 4, bg: '#cbb994', female: isFemaleName(e.name) })),
      h('div.poster__name', e.name),
      h('div.poster__reason', e.reason),
      h('div.poster__meta', `объявил ${e.added_by_callsign} · ${fmtDate(e.created_at, false)}`),
      can(me, 'senior') ? h('button.btn.btn--ink.btn--sm', {
        type: 'button',
        onclick: async () => {
          if (!(await confirmBox(`Снять «${e.name}» с розыска?`, { ok: 'Снять с розыска' }))) return;
          try {
            await api.watchlistRemove(e.id);
            toast('Снят с розыска.', 'ok');
            load();
          } catch (err) { fail(err); }
        },
      }, 'Снять с розыска') : null);
  }

  async function load() {
    mount(wall, typing());
    try {
      const data = await api.watchlist({ offset: q.offset, limit: q.limit, q: q.q });
      if (!data.items.length) {
        mount(wall, empty(q.q ? 'Никого с таким именем не ищут.' : 'Розыскных листов нет.'));
        return;
      }
      mount(wall, h('div.wanted-wall', data.items.map(poster)),
        data.total > q.limit ? h('div.paper.paper--white', { style: { marginTop: '14px' } }, pager(data, (o) => { q.offset = o; load(); })) : null);
    } catch (e) {
      mount(wall, errorBox(e, load));
    }
  }

  mount(container,
    h('div.view-head',
      h('div', h('h2', 'Розыскные листы'), h('p', 'Имена сверяются без учёта регистра и лишних пробелов. Совпадение у ворот — задержание и дело о происшествии.')),
      can(me, 'senior')
        ? h('button.btn.btn--red', { type: 'button', onclick: () => openWantedForm(load) }, 'Объявить в розыск')
        : h('span.small', { style: { color: 'var(--faded-d)' } }, 'Объявлять в розыск может начальник караула.')),
    h('div.paper.quickcheck', { style: { marginBottom: '18px' } }, checkForm, checkResult),
    h('div.toolbar.dark', h('label.field.field--grow', h('span.field__label', 'Поиск по листам'), search)),
    wall);
  load();
}

function openWantedForm(onSaved) {
  const name = h('input.input', { required: true, maxlength: 128, placeholder: 'Фамилия Имя' });
  const reason = h('textarea.input', { required: true, maxlength: 512, rows: 3, placeholder: 'За что разыскивается' });
  const submit = h('button.btn.btn--red', { type: 'submit' }, 'Объявить');
  let m = null;
  const form = h('form.stack', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api.watchlistAdd(name.value.trim(), reason.value.trim());
        m.close();
        toast('Розыскной лист вывешен.', 'ok');
        onSaved();
      } catch (err) {
        fail(err);
        submit.disabled = false;
      }
    },
  }, field('Имя', name), field('Основание', reason),
    h('div.row.row--end', submit));
  m = modal(form, { title: 'Объявить в розыск', size: 'sm' });
  name.focus();
}
