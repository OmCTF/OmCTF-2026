import { api } from '../api.js';
import { local } from '../store.js';
import { mount, h, field, stamp, fail } from '../ui.js';
import { GateScene, sfx } from '../art.js';

export function titleScreen({ onEnter }) {
  const canvas = h('canvas.pixel');
  let mode = 'login';

  const callsign = h('input.input', { name: 'callsign', autocomplete: 'username', required: true, minlength: 2, maxlength: 64, placeholder: 'например, Часовой-12' });
  const password = h('input.input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 4, maxlength: 128 });
  const password2 = h('input.input', { name: 'password2', type: 'password', autocomplete: 'new-password', minlength: 4, maxlength: 128 });
  const repeatField = field('Пароль ещё раз', password2);
  const submit = h('button.btn.btn--amber', { type: 'submit' }, 'Заступить на пост');
  const stampSlot = h('div.enlist__stamp');
  const loginTab = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => setMode('login') }, 'Заступить');
  const regTab = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setMode('register') }, 'Поступить на службу');
  const intro = h('p.small.muted');

  function setMode(m) {
    mode = m;
    loginTab.setAttribute('aria-pressed', String(m === 'login'));
    regTab.setAttribute('aria-pressed', String(m === 'register'));
    repeatField.classList.toggle('hidden', m === 'login');
    password2.required = m === 'register';
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    submit.textContent = m === 'login' ? 'Заступить на пост' : 'Подать прошение';
    intro.textContent = m === 'login'
      ? 'Караульный предъявляет позывной и пароль. Пропуск с печатью выдаётся при каждом заступлении.'
      : 'Новобранец получает чин караульного и гостевой пропуск. Позывной должен быть единственным в крепости.';
    sfx.paper();
  }

  const form = h('form.paper.enlist', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (mode === 'register' && password.value !== password2.value) {
        fail(new Error('Пароли не совпадают.'));
        return;
      }
      submit.disabled = true;
      try {
        const cs = callsign.value.trim();
        const res = mode === 'login' ? await api.login(cs, password.value) : await api.register(cs, password.value);
        local.token = res.token;
        if (res.transit_pass) {
          local.addPass(res.callsign, { label: `Личный пропуск · ${res.callsign}`, xml: res.transit_pass, subject: res.callsign, role: res.rank === 'commandant' ? 'commandant' : 'guest' });
        }
        sfx.stamp();
        mount(stampSlot, stamp(mode === 'login' ? 'Допущен' : 'Принят', 'ok', 'stamp--land'));
        setTimeout(() => onEnter(), 650);
      } catch (err) {
        sfx.denied();
        mount(stampSlot, stamp('Отказано', 'deny', 'stamp--land'));
        fail(err);
        submit.disabled = false;
      }
    },
  },
  h('div.paper__head', h('h2', 'Лист допуска к караульной службе'), h('span.paper__kicker', 'Форма №7')),
  h('div.seg', loginTab, regTab),
  h('div.stack',
    intro,
    field('Позывной', callsign),
    field('Пароль', password),
    repeatField,
    h('div.row.row--end', submit)),
  stampSlot,
  h('p.enlist__foot', 'Подписью удостоверяю, что о всём виденном у ворот доложу коменданту.'));

  setMode('login');
  repeatField.classList.add('hidden');

  const root = h('div.title',
    h('div.title__scene', canvas),
    h('main.title__body',
      h('section',
        h('h1.brand__name', 'Ворота'),
        h('div.brand__sub', 'Омская крепость · пропускная система'),
        h('div.legend',
          h('p', 'Тобольские ворота, через которые Достоевский шёл на каторгу. Тарские, снесённые и потом отстроенные заново. Крепость Вобана, которую Шпрингер строил как окно в Азию.'),
          h('p', 'Стража на постах, журнал входов, пропуска с печатью коменданта. Жители получают пропуска, караул записывает, кто вошёл, когда и куда.'),
          h('p', 'Ночным гостям выдают особые пропуска, о которых знает только комендант.')),
        h('blockquote.epigraph',
          '«Острог наш стоял в конце крепости, у самого вала».',
          h('cite', 'Ф. М. Достоевский, «Записки из Мёртвого дома»'))),
      form));

  requestAnimationFrame(() => {
    if (canvas.isConnected) new GateScene(canvas, { queue: 4, auto: true });
    callsign.focus();
  });
  return root;
}
