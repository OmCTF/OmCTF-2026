// Пост у ворот: будка караульного (слева) и досмотровый стол (вкладка «Пост»).
// Решение о допуске принимает журнал по своду правил; караульный ставит свой
// штамп заранее. Расчёт ведёт канцелярия: за совпадение платят, за расхождение —
// замечание, подношения копятся до ревизии. Покупки из лавки помогают на посту.

import { api } from '../api.js';
import { local } from '../store.js';
import {
  state, on, refreshShift, refreshPurse, applyPay, owns, zoneName, levelName,
} from '../state.js';
import {
  h, mount, toast, fail, field, stamp, dl, select, fmtClock, fmtLongDate, kop,
  pickFrom, isFemaleName, ZONE_STATUS,
} from '../ui.js';
import { portrait, sfx } from '../art.js';
import { passPaper, envelopes } from './docs.js';
import { openRulebook } from './rulebook.js';
import { openCrossing } from './journal.js';
import { openIncident } from './incidents.js';
import { startShiftFlow, openEndShift, lastHandoff } from './shift.js';

const MALE = ['Пётр', 'Иван', 'Аким', 'Фрол', 'Савва', 'Терентий', 'Порфирий', 'Ермолай', 'Ефим', 'Степан', 'Кондратий', 'Елисей', 'Касым', 'Ахмет', 'Юзеф', 'Казимир', 'Игнатий', 'Мирон', 'Тимофей', 'Никифор', 'Арсений', 'Фёдор', 'Нурлан', 'Прохор'];
const FEMALE = ['Евдокия', 'Аграфена', 'Матрёна', 'Прасковья', 'Агафья', 'Лукерья', 'Анисья', 'Пелагея', 'Фёкла', 'Марфа', 'Устинья', 'Ядвига', 'Зейнеп', 'Олимпиада'];
const SURNAMES = ['Кожевников', 'Сыромятников', 'Ямщиков', 'Тобольцев', 'Иртышев', 'Колмогоров', 'Белослюдов', 'Барабинцев', 'Кулундин', 'Тарский', 'Ишимцев', 'Ковальский', 'Сенкевич', 'Мусин', 'Абдрахманов', 'Жолдасбеков', 'Шерстобитов', 'Пимокатов', 'Сургутский', 'Черепанов', 'Ерофеев', 'Немчинов', 'Бухтарминский', 'Омельченко'];
const GREET = ['Здравия желаю.', 'Доброго здоровья, ваше благородие.', 'Бог в помощь.', 'Мороз-то нынче…', 'Пропустите, сделайте милость.', ''];
const LINES = {
  0: ['На молебен, в собор.', 'Объявление на площади прочесть.', 'Праздник нынче, на площадь иду.'],
  1: ['К сестре, в слободу.', 'Живу я там, с ярмарки ворочаюсь.', 'К куму на именины.'],
  2: ['Обоз с пенькой, торговать.', 'Чай везу из Кяхты, в Гостиный двор.', 'Лавка у меня там, ваше благородие.'],
  3: ['Наняли в мастерские, кузнецом.', 'Порох сдать, по подряду.', 'Сапоги чинить солдатам.'],
  4: ['По этапу иду, дальше на Тобольск.', 'Пересыльный я. Бумаги вот.', 'Свидание с арестантом. Брат он мне.'],
  5: ['В канцелярию, с прошением.', 'Жалобу подать на подрядчика.', 'Вызвали меня, повесткой.'],
  9: ['К господину коменданту. Лично.', 'Срочное донесение. Только коменданту.', 'Мне назначено. Ночью.'],
};
const NO_DOC_LINES = ['Бумаги? Дома позабыл, ваше благородие…', 'Пропуск в дороге украли, вот те крест.', 'Да какие бумаги, меня тут каждая собака знает.'];
const BRIBE_LINES = ['…А это вам, на чай.', '…Вот, возьмите, за беспокойство.', '…Монетка-то лишней не будет, а?'];
const NO_DOC = '(документ не предъявлен)';
const ZONE_WEIGHT = { 0: 3, 1: 3, 2: 3, 3: 2, 4: 2, 5: 1, 9: 0.4 };

function femSurname(s) {
  if (/ский$/.test(s)) return s.replace(/ский$/, 'ская');
  if (/цкий$/.test(s)) return s.replace(/цкий$/, 'цкая');
  if (/(ов|ев|ин|ын)$/.test(s)) return `${s}а`;
  return s;
}

function forgery(name) {
  return `ПРОПУСКЪ\n\nПредъявитель сего, ${name},\nпропускается въ крѣпость безпрепятственно.\n\nКомендантъ ____________\n(подпись неразборчива)`;
}

function payLines(entries) {
  return h('table.paylines', h('tbody', entries.map((e) => h('tr',
    h('td', e.memo),
    h(`td.num${e.amount < 0 ? '.minus' : ''}`, `${e.amount > 0 ? '+' : ''}${e.amount}`)))));
}

export function createPost() {
  const s = {
    queue: [],
    current: null,   // посетитель у окна
    form: null,      // { traveler, zone, doc, docSource, manualDoc, notes, bribe }
    choice: null,    // штамп караульного
    stampFresh: false,
    result: null,
    busy: false,
    checks: {},
    wanted: [],
    deskEl: null,
    docSlot: null,
  };
  const callsign = () => (state.me ? state.me.callsign : '');

  /* ---------- очередь ---------- */
  async function loadWanted() {
    try {
      const r = await api.watchlist({ limit: 100 });
      s.wanted = r.items.map((e) => e.name);
    } catch {
      s.wanted = [];
    }
  }

  function pickZone() {
    const zs = state.zones.length ? state.zones : [{ zone: 0 }];
    const w = (z) => ZONE_WEIGHT[z.zone] ?? 1;
    let x = Math.random() * zs.reduce((a, z) => a + w(z), 0);
    for (const z of zs) {
      x -= w(z);
      if (x <= 0) return z.zone;
    }
    return zs[0].zone;
  }

  function makeTraveler() {
    let name;
    let female;
    let wanted = false;
    if (s.wanted.length && Math.random() < 0.15) {
      name = pickFrom(s.wanted);
      female = isFemaleName(name);
      wanted = true;
    } else {
      female = Math.random() < 0.3;
      const sur = pickFrom(SURNAMES);
      name = female ? `${femSurname(sur)} ${pickFrom(FEMALE)}` : `${sur} ${pickFrom(MALE)}`;
    }
    const zone = pickZone();
    const folder = local.folder(callsign());
    const roll = Math.random();
    let doc;
    let kind;
    if (folder.length && roll < 0.72) { doc = pickFrom(folder).xml; kind = 'pass'; }
    else if (roll < 0.9) { doc = forgery(name); kind = 'forgery'; }
    else { doc = NO_DOC; kind = 'none'; }
    // кто не уверен в своих бумагах — тот и суёт монету
    const bribe = Math.random() < (wanted ? 0.5 : kind === 'pass' ? 0.12 : 0.35);
    const lines = LINES[zone] || [`Мне в «${zoneName(zone)}».`];
    let line = kind === 'none' ? pickFrom(NO_DOC_LINES) : `${pickFrom(GREET)} ${pickFrom(lines)}`.trim();
    if (bribe) line = `${line} ${pickFrom(BRIBE_LINES)}`;
    return { key: `${Date.now()}${Math.random()}`, name, female, zone, doc, kind, line, bribe, manual: false };
  }

  function ensureQueue() {
    while (s.queue.length < 6) s.queue.push(makeTraveler());
    if (state.scene) state.scene.setQueue(s.queue.length);
  }

  function seat(traveler) {
    s.current = traveler;
    const first = local.folder(callsign())[0];
    s.form = {
      traveler: traveler.name,
      zone: traveler.zone,
      doc: traveler.manual ? (first ? first.xml : '') : (traveler.doc ?? ''),
      docSource: traveler.manual ? (first ? `f:${first.id}` : 'manual') : 'presented',
      manualDoc: '',
      notes: '',
      bribe: false,
    };
    s.choice = null;
    s.result = null;
    s.checks = {};
    if (!traveler.manual) autoChecks();
  }

  // Покупки из лавки делают часть работы сами.
  function autoChecks() {
    if (owns('wanted_copy')) checkWanted({ quiet: true });
    if (owns('magnifier')) checkSeal({ quiet: true });
  }

  async function callNext() {
    if (!state.shift) { toast('Сперва заступите в караул.'); return; }
    if (s.busy) return;
    if (s.current && !s.result && !s.current.manual) {
      toast('Посетитель ещё у окна — поставьте штамп.');
      return;
    }
    if (!s.wanted.length) await loadWanted();
    ensureQueue();
    const t = s.queue.shift();
    ensureQueue();
    seat(t);
    sfx.call();
    if (state.scene) state.scene.call();
    setTimeout(() => sfx.paper(), 450);
    renderBooth();
    renderDesk();
  }

  function manualInspection() {
    if (!state.shift) { toast('Сперва заступите в караул.'); return; }
    if (s.current && !s.result && !s.current.manual) {
      toast('Сначала решите судьбу посетителя у окна.');
      return;
    }
    seat({ key: `m${Date.now()}`, name: '', zone: state.zones[0] ? state.zones[0].zone : 0, doc: null, kind: 'manual', line: '', bribe: false, manual: true });
    renderBooth();
    renderDesk();
  }

  /* ---------- проверки ---------- */
  async function checkWanted({ quiet = false } = {}) {
    const name = s.form.traveler.trim();
    if (!name) { if (!quiet) toast('Впишите имя посетителя.', 'error'); return; }
    try {
      s.checks.wanted = await api.watchlistCheck(name);
      if (s.checks.wanted.found) sfx.bell(); else if (!quiet) sfx.paper();
      renderDesk();
    } catch (e) { if (!quiet) fail(e); }
  }

  async function checkSeal({ quiet = false } = {}) {
    if (!s.form.doc.trim()) { if (!quiet) toast('Нет документа для проверки.', 'error'); return; }
    try {
      s.checks.seal = await api.verify(s.form.doc);
      if (!quiet) sfx.paper();
      renderDesk();
    } catch (e) { if (!quiet) fail(e); }
  }

  async function stampIt(choice) {
    if (s.busy || !s.current || s.result) return;
    const f = s.form;
    if (!f.traveler.trim()) { toast('Впишите имя посетителя.', 'error'); return; }
    if (!f.doc.trim()) { toast('Положите на стол документ.', 'error'); return; }
    s.busy = true;
    s.choice = choice;
    s.stampFresh = true;
    sfx.stamp();
    renderDesk();
    try {
      const notes = [`Штамп караульного: ${choice === 'ok' ? 'впустить' : 'отказать'}`, f.notes.trim()].filter(Boolean).join('. ').slice(0, 1000);
      const res = await api.crossing({
        traveler: f.traveler.trim(), document: f.doc, zone: Number(f.zone), notes,
        stamp: choice === 'ok' ? 'admit' : 'deny',
        bribe: !!(s.current.bribe && f.bribe),
      });
      s.result = res;
      applyPay(res.pay);
      if (res.watchlist_hit) sfx.bell();
      else if (res.pay && !res.pay.agree) setTimeout(() => sfx.denied(), 250);
      if (state.scene && !s.current.manual) {
        if (res.granted) state.scene.admit(); else state.scene.reject();
      }
      s.wanted = [];
      await refreshShift();
    } catch (e) {
      s.choice = null;
      fail(e);
    } finally {
      s.busy = false;
      s.stampFresh = false;
      renderBooth();
      renderDesk();
    }
  }

  /* ---------- будка ---------- */
  const win = h('div.booth__window');
  const plate = h('div.nameplate', '—');
  const speech = h('div.speech', { 'aria-live': 'polite' });
  const tOk = h('b', '0');
  const tDeny = h('b', '0');
  const tWanted = h('b', '0');
  const clock = h('span.booth__clock', fmtClock());
  const shiftNo = h('b');
  const payEl = h('b');
  const streakEl = h('b');
  const queueEl = h('b');
  const orderEl = h('div.booth__order');
  const warnEl = h('div.booth__warn');
  const nextBtn = h('button.btn.btn--speaker', { type: 'button', onclick: callNext },
    h('span.speaker-icon', { 'aria-hidden': 'true' }), 'Следующий!');
  const footStart = h('button.btn.btn--amber', { type: 'button', onclick: () => startShiftFlow() }, 'Заступить в караул');
  const footEnd = h('button.btn.btn--sm', { type: 'button', onclick: () => openEndShift() }, 'Сдать караул');
  const footRules = h('button.btn.btn--sm', { type: 'button', onclick: () => openRulebook() }, 'Свод правил');

  const booth = h('aside.booth', { 'aria-label': 'Будка караульного' },
    h('div.booth__left', win, plate),
    speech,
    h('div.tablo', { role: 'group', 'aria-label': 'Табло караула' },
      h('div.tablo__cell', h('span', 'Допущено'), tOk),
      h('div.tablo__cell.tablo__cell--deny', h('span', 'Отказано'), tDeny),
      h('div.tablo__cell.tablo__cell--wanted', h('span', 'Розыск'), tWanted)),
    h('div.booth__meta',
      h('div.booth__wide', clock),
      h('div', 'Караул', h('br'), shiftNo),
      h('div', 'В очереди', h('br'), queueEl),
      h('div', 'Жалованье', h('br'), payEl),
      h('div', 'Усердие', h('br'), streakEl),
      orderEl,
      warnEl),
    nextBtn,
    h('div.booth__foot', footRules, footEnd, footStart));

  const clockTimer = setInterval(() => { clock.textContent = fmtClock(); }, 10000);

  function renderBooth() {
    const sh = state.shift;
    const purse = state.purse;
    tOk.textContent = sh ? sh.crossings_granted : 0;
    tDeny.textContent = sh ? sh.crossings_denied : 0;
    tWanted.textContent = sh ? sh.incidents_count : 0;
    shiftNo.textContent = sh ? `№${sh.id}` : 'не принят';
    payEl.textContent = purse ? kop(purse.balance) : '—';
    payEl.classList.toggle('minus', !!purse && purse.balance < 0);
    streakEl.textContent = purse ? `×${purse.streak}` : '—';
    queueEl.textContent = sh ? String(s.queue.length) : '—';
    if (purse && purse.bounty) {
      orderEl.replaceChildren('Приказ дня: ', h('b', purse.bounty.zone_name), ` +${purse.bounty.bonus}`);
      orderEl.hidden = false;
    } else {
      orderEl.hidden = true;
    }
    const audit = purse ? purse.rates.audit_from : 3;
    if (purse && purse.suspicion > 0) {
      warnEl.textContent = purse.suspicion >= audit - 1
        ? `Подношений за караул: ${purse.suspicion}. Ещё — и ревизия.`
        : `Подношений за караул: ${purse.suspicion}.`;
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
    nextBtn.disabled = !sh || s.busy;
    footStart.classList.toggle('hidden', !!sh);
    footEnd.classList.toggle('hidden', !sh);

    mount(win);
    if (!sh) {
      win.append(h('div.shutter', h('div.shutter__sign', 'Окно закрыто')));
      plate.textContent = '—';
      speech.className = 'speech';
      speech.textContent = 'Караул не принят. Очередь мёрзнет у ворот.';
      return;
    }
    if (!s.current) {
      win.append(h('div.booth__empty', 'Окно свободно'));
      plate.textContent = '—';
      speech.className = 'speech';
      speech.textContent = `${fmtLongDate()} У ворот ${s.queue.length} человек.`;
      return;
    }
    if (s.current.manual) {
      win.append(h('div.booth__empty', 'Ручной досмотр'));
      plate.textContent = s.form.traveler || 'посетитель';
    } else {
      const face = portrait(s.current.name, { px: 4, bg: '#2b2f36', female: s.current.female });
      face.style.width = '';
      face.style.height = '';
      win.append(face);
      if (s.current.bribe && !s.result) win.append(h('div.coins', { 'aria-hidden': 'true' }));
      plate.textContent = s.current.name;
    }
    speech.className = 'speech';
    if (!s.result) {
      speech.textContent = s.current.manual ? 'Впишите посетителя и положите его пропуск на стол.' : s.current.line;
    } else if (s.result.watchlist_hit) {
      speech.className = 'speech speech--alarm';
      speech.textContent = 'Караул! Задержать! — Пустите, я не тот, за кого вы меня…';
    } else if (s.result.granted) {
      speech.textContent = 'Благодарствую, ваше благородие.';
    } else {
      speech.textContent = 'Да как же так… Ну, воля ваша.';
    }
  }

  /* ---------- стол ---------- */
  function idleNoShift() {
    const note = h('div');
    lastHandoff().then((prev) => {
      if (prev && note.isConnected) {
        mount(note, h('div.paper.paper--note',
          h('b', `Записка сменщику от ${prev.inspector_callsign}, ${fmtLongDate(new Date(prev.ended_at))}`),
          h('p.pre', prev.handoff_notes)));
      }
    });
    return h('div.post-idle',
      h('div.paper.tilt-l',
        h('div.paper__head', h('h2', 'Караул не принят'), h('span.paper__kicker', fmtLongDate())),
        h('p', 'Окно закрыто. Пока караул не принят, журнал входов не ведётся и посетителей не пускают.'),
        h('p.small.muted', 'За верные штампы платят, за ошибки пишут замечания. В конце караула — расчёт: квартирные, дрова, хлеб. На скопленное в лавке интенданта продаются вещи, облегчающие службу.'),
        note,
        h('div.row',
          h('button.btn.btn--amber', { type: 'button', onclick: () => startShiftFlow() }, 'Заступить в караул'),
          h('button.btn.btn--ink', { type: 'button', onclick: () => openRulebook() }, 'Свод правил'))));
  }

  function idleWindow() {
    const bounty = state.purse && state.purse.bounty;
    return h('div.post-idle',
      h('div.paper.tilt-r',
        h('div.paper__head', h('h2', 'Окно свободно'), h('span.paper__kicker', `Караул №${state.shift.id}`)),
        h('p', `У ворот ждут ${s.queue.length} человек. Позовите следующего: он подаст бумаги, вы проверите их по своду правил и поставите штамп.`),
        bounty ? h('p', `Приказ дня: верные штампы в «${bounty.zone_name}» — ещё +${bounty.bonus} коп.`) : null,
        h('p.small.muted', 'Если посетитель пришёл со своим пропуском — проведите ручной досмотр и вложите пропуск из папки или вставьте его текст.'),
        h('div.row',
          h('button.btn.btn--amber', { type: 'button', onclick: callNext }, 'Следующий!'),
          h('button.btn.btn--ink', { type: 'button', onclick: manualInspection }, 'Ручной досмотр'),
          h('button.btn.btn--ink', { type: 'button', onclick: () => openRulebook() }, 'Свод правил'))));
  }

  function docStamps() {
    if (!s.choice) return null;
    const kind = s.choice === 'ok' ? 'ok' : 'deny';
    return stamp(s.choice === 'ok' ? 'Впустить' : 'Отказать', kind, s.stampFresh ? 'stamp--land' : '');
  }

  function renderDocSlot() {
    if (!s.docSlot) return;
    mount(s.docSlot, passPaper(s.form.doc, { stamps: docStamps() }));
  }

  function zoneHint(zoneId) {
    const z = state.zones.find((x) => x.zone === Number(zoneId));
    if (!z) return '';
    const parts = [];
    if (owns('rulebook')) {
      parts.push(`требуется: ${levelName(z.min_level)}`);
      if (z.status !== 'open') parts.push(ZONE_STATUS[z.status].toLowerCase());
      if (z.capacity) parts.push(`занято ${z.current_count} из ${z.capacity}`);
    } else {
      parts.push('требования — в своде правил');
    }
    const bounty = state.purse && state.purse.bounty;
    if (bounty && bounty.zone === z.zone) parts.push(`приказ дня +${bounty.bonus}`);
    return parts.join(' · ');
  }

  function inspectionCard() {
    const f = s.form;
    const locked = !!s.result || s.busy;
    const folder = local.folder(callsign());

    const nameIn = h('input.input', {
      value: f.traveler, maxlength: 128, disabled: locked, autocomplete: 'off',
      oninput: (e) => { f.traveler = e.target.value; if (s.current.manual) plate.textContent = f.traveler || 'посетитель'; },
      onchange: () => { if (owns('wanted_copy')) checkWanted({ quiet: true }); },
    });
    const hint = h('span.field__hint', zoneHint(f.zone));
    const zoneSel = select(state.zones.map((z) => [z.zone, `№${z.zone} · ${z.name}`]), f.zone, {
      disabled: locked,
      onchange: (e) => { f.zone = Number(e.target.value); hint.textContent = zoneHint(f.zone); },
    });

    const docOptions = [];
    if (!s.current.manual) docOptions.push(['presented', 'Предъявлен посетителем']);
    folder.forEach((p) => docOptions.push([`f:${p.id}`, `Из папки: ${p.label}`]));
    docOptions.push(['manual', 'Вписать текст вручную…']);
    const docSel = select(docOptions, f.docSource, {
      disabled: locked,
      onchange: (e) => {
        const v = e.target.value;
        f.docSource = v;
        if (v === 'presented') f.doc = s.current.doc || '';
        else if (v.startsWith('f:')) f.doc = (folder.find((p) => `f:${p.id}` === v) || {}).xml || '';
        else f.doc = f.manualDoc;
        s.checks.seal = null;
        renderDesk();
        if (owns('magnifier') && f.doc.trim()) checkSeal({ quiet: true });
      },
    });
    const docArea = f.docSource === 'manual'
      ? h('textarea.input', {
        rows: 4, value: f.manualDoc, disabled: locked, placeholder: 'Вставьте текст пропуска',
        oninput: (e) => { f.manualDoc = e.target.value; f.doc = e.target.value; },
        onchange: () => { s.checks.seal = null; renderDocSlot(); if (owns('magnifier') && f.doc.trim()) checkSeal({ quiet: true }); },
      })
      : null;
    const notesIn = h('input.input', { value: f.notes, maxlength: 900, disabled: locked, placeholder: 'необязательно', oninput: (e) => { f.notes = e.target.value; } });

    const checks = h('div.checks');
    const w = s.checks.wanted;
    if (w) {
      checks.append(w.found
        ? h('div.check-line.check-line--bad', `РАЗЫСКИВАЕТСЯ: ${w.name}.${w.reason ? ` ${w.reason}` : ''}`)
        : h('div.check-line.check-line--ok', `«${w.name}» в розыскных листах не значится.`));
    }
    const seal = s.checks.seal;
    if (seal) {
      checks.append(seal.valid
        ? h('div.check-line.check-line--ok', `Печать подлинная. Категория пропуска: ${seal.level_name}.`)
        : h('div.check-line.check-line--bad', 'Печать недействительна — бумага подложная или испорчена.'));
    }

    const offer = s.current.bribe && !s.current.manual && !s.result
      ? h('label.offer',
        h('input', { type: 'checkbox', checked: f.bribe, disabled: locked, onchange: (e) => { f.bribe = e.target.checked; } }),
        h('span',
          h('b', 'На стойке звенят монеты. '),
          'Взять подношение? Деньги ваши, пока ревизия не нагрянет; от разыскиваемого — отберут и оштрафуют.'))
      : null;

    const tray = s.result
      ? h('div.stamp-tray', { style: { gridTemplateColumns: '1fr' } },
        h('button.btn.btn--speaker', { type: 'button', onclick: callNext }, h('span.speaker-icon', { 'aria-hidden': 'true' }), 'Следующий!'))
      : h('div.stamp-tray',
        h('button.stamper.stamper--ok', { type: 'button', disabled: locked, onclick: () => stampIt('ok') },
          h('span.stamper__knob'), h('span.stamper__neck'), h('span.stamper__face', 'Впустить')),
        h('button.stamper.stamper--deny', { type: 'button', disabled: locked, onclick: () => stampIt('deny') },
          h('span.stamper__knob'), h('span.stamper__neck'), h('span.stamper__face', 'Отказать')));

    const auto = [owns('wanted_copy') && 'розыск под стеклом', owns('magnifier') && 'лупа'].filter(Boolean);
    return h('div',
      h('div.paper.paper--white.inspect',
        h('div.paper__head', h('h2', 'Досмотровый лист'), h('span.paper__kicker', s.current.manual ? 'ручной досмотр' : 'у окна')),
        h('div.inspect__grid',
          field('Посетитель', nameIn),
          h('label.field', h('span.field__label', 'Место назначения'), zoneSel, hint),
          h('label.field.field--wide', h('span.field__label', 'Документ на столе'), docSel, docArea),
          h('label.field.field--wide', h('span.field__label', 'Пометки в журнал'), notesIn)),
        h('div.inspect__tools',
          h('button.btn.btn--ink.btn--sm', { type: 'button', disabled: locked, onclick: () => checkWanted() }, 'Сверить с розыском'),
          h('button.btn.btn--ink.btn--sm', { type: 'button', disabled: locked, onclick: () => checkSeal() }, 'Проверить печать'),
          h('button.btn.btn--ink.btn--sm', { type: 'button', onclick: () => openRulebook() }, 'Свод правил')),
        auto.length ? h('p.small.muted', { style: { marginTop: '8px' } }, `Само проверяет: ${auto.join(', ')}.`) : null,
        checks,
        offer),
      tray);
  }

  function resultPapers() {
    const res = s.result;
    const pay = res.pay;
    const out = [];
    out.push(h('div.paper.receipt.tilt-l',
      h('div.paper__kicker', 'Журнал входов · запись'),
      h('div.receipt__no', res.crossing_id),
      dl([
        ['Посетитель', res.traveler],
        ['Куда', `№${res.zone} · ${res.zone_name}`],
        ['Пропуск', res.document_level],
        ['Решение', res.granted ? 'допущен' : 'отказано'],
        res.deny_reason ? ['Причина', res.deny_reason] : null,
      ]),
      stamp(res.granted ? 'Допущен' : 'Отказано', res.granted ? 'ok' : 'deny', 'stamp--land'),
      h('div.row', { style: { marginTop: '10px' } },
        h('button.link', { type: 'button', onclick: () => openCrossing(res.crossing_id) }, 'Открыть запись'))));
    if (res.watchlist_hit) {
      out.push(h('div.paper.alarm',
        h('div.alarm__head', 'Тревога · розыск'),
        h('p', `«${res.traveler}» значится в розыскных листах. Посетитель задержан караулом.`),
        res.auto_incident_id
          ? h('button.btn.btn--red.btn--sm', { type: 'button', onclick: () => openIncident(res.auto_incident_id) }, `Дело ${res.auto_incident_id}`)
          : null));
    }
    if (pay) {
      const miss = pay.entries.filter((e) => e.kind === 'stamp_miss');
      const rest = pay.entries.filter((e) => e.kind !== 'stamp_miss');
      if (!pay.agree) {
        out.push(h('div.citation',
          h('div.citation__head', 'Замечание'),
          h('p', `Штамп караульного «${s.choice === 'ok' ? 'впустить' : 'отказать'}» расходится с решением журнала.`),
          miss.length ? h('p.small', `Из жалованья удержано ${-miss[0].amount} коп. Усердие начинается заново.`) : null));
      }
      if (rest.length || pay.agree) {
        out.push(h('div.paper.paper--note.paysheet',
          h('b', pay.agree ? 'Решение верное.' : 'Прочее по записи.'),
          rest.length ? payLines(rest) : null,
          h('div.paysheet__total', `На руках: ${kop(pay.balance)} · усердие ×${pay.streak}`)));
      }
    }
    if (res.dispatches && Object.keys(res.dispatches).length) {
      out.push(h('div', h('div.paper__kicker', { style: { color: 'var(--faded)', marginBottom: '6px' } }, 'Посетитель передал конверты'), envelopes(res.dispatches)));
    }
    return out;
  }

  function renderDesk() {
    const el = s.deskEl;
    if (!el || !el.isConnected) return;
    if (!state.shift) { mount(el, idleNoShift()); return; }
    if (!s.current) { mount(el, idleWindow()); return; }
    s.docSlot = h('div');
    renderDocSlot();
    mount(el, h('div.post-grid',
      h('div.doc-stack',
        h('div.paper__kicker', { style: { color: 'var(--faded)' } }, 'Документ на столе'),
        s.docSlot),
      inspectionCard(),
      s.result ? h('div.post-results', resultPapers()) : null));
  }

  const offs = [
    on('shift', (sh) => {
      if (!sh) { s.current = null; s.result = null; }
      else ensureQueue();
      renderBooth();
      if (!s.busy) renderDesk(); // во время штампа стол перерисует stampIt — один раз
    }),
    on('purse', () => renderBooth()),
    on('folder', () => { if (!s.result) renderDesk(); }),
    on('zones', () => { if (!s.result) renderDesk(); }),
  ];

  if (state.shift) ensureQueue();
  renderBooth();
  loadWanted();
  if (!state.purse) refreshPurse();

  return {
    booth,
    renderDesk(container) {
      s.deskEl = container;
      renderDesk();
    },
    destroy() {
      offs.forEach((off) => off());
      clearInterval(clockTimer);
    },
  };
}
