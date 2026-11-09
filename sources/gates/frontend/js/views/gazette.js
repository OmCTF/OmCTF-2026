// «Омскія вѣдомости» — сводка по крепости в виде утренней газеты.

import { api } from '../api.js';
import { h, mount, modal, typing, errorBox, fmtLongDate, pct } from '../ui.js';

const ADS = [
  'Продаётся тулуп, почти новый, в рукаве дыра. Спросить в Гостином дворе.',
  'Утерян кисет вышитый. Нашедшего просят вернуть к Тарским воротам.',
  'Ищу попутчика до Тобольска. Обоз с пенькой, выезд на Покров.',
  'Караульным со скидкою: валенки, рукавицы, башлыки. Лавка Пимокатова.',
  'Лечу зубы, пускаю кровь, пишу прошения. Спросить писаря при канцелярии.',
  'Сдаётся угол в Офицерской слободе. Тихому и непьющему.',
];

function headline(daily, stats) {
  if (!daily || !daily.crossings_total) return ['У ворот тихо', 'С утра через Тобольские ворота не прошёл ни один проситель.'];
  if (stats && stats.watchlist_hits > 0 && daily.crossings_denied > 0 && Math.random() < 0.5) {
    return ['Караул задержал разыскиваемых', `За всё время у ворот по розыскным листам задержано ${stats.watchlist_hits} человек.`];
  }
  if (daily.denial_rate > 0.5) return ['Стража бдит: отказано большинству', `За сутки отказано ${pct(daily.denial_rate)} просителей.`];
  return ['Крепость живёт обычным порядком', `За сутки через ворота прошло ${daily.crossings_granted} человек.`];
}

function fig(label, value) {
  return h('div.gazette__fig', h('span', label), h('b', value));
}

export function gazettePaper({ stats, zones, daily, leaders }) {
  const [head, lede] = headline(daily, stats);
  const maxZone = Math.max(1, ...(zones || []).map((z) => z.crossings_total));
  return h('article.gazette',
    h('div.gazette__mast', h('h1', 'Омскія Вѣдомости')),
    h('div.gazette__dateline', h('span', fmtLongDate()), h('span', 'Издаются при комендантском управлении'), h('span', 'Цена 3 коп.')),
    h('h2.gazette__headline', head),
    h('p.gazette__lede', lede),
    h('div.gazette__cols',
      h('section.gazette__col',
        h('h3', 'Сводка за сутки'),
        daily ? [
          fig('Записей в журнале', daily.crossings_total),
          fig('Допущено', daily.crossings_granted),
          fig('Отказано', daily.crossings_denied),
          fig('Заведено дел', daily.incidents_created),
          fig('Принято караулов', daily.shifts_started),
        ] : h('p', 'Сводка не поступила.'),
        h('h3', { style: { marginTop: '14px' } }, 'С основания крепости'),
        stats ? [
          fig('Караульных на службе', stats.inspectors_registered),
          fig('Караулов сейчас', stats.active_shifts),
          fig('Всего записей', stats.crossings_total),
          fig('Доля отказов', pct(stats.denial_rate)),
          fig('Розыскных листов', stats.watchlist_entries),
          fig('Открытых дел', stats.open_incidents),
        ] : h('p', 'Сведений нет.')),
      h('section.gazette__col',
        h('h3', 'Движение по крепости'),
        zones && zones.length ? zones.map((z) => h('div',
          h('div.small', `№${z.zone} · ${z.name}`),
          h('div.gazette__bar',
            h('div', { style: { display: 'flex', gap: '1px' } },
              h('i', { style: { width: `${(z.crossings_granted / maxZone) * 100}%` }, title: `допущено ${z.crossings_granted}` }),
              h('i.deny', { style: { width: `${(z.crossings_denied / maxZone) * 100}%` }, title: `отказано ${z.crossings_denied}` })),
            h('span', `${z.crossings_granted}/${z.crossings_denied}`)))) : h('p', 'Нет сведений.'),
        h('p.small', { style: { marginTop: '8px', fontStyle: 'italic' } }, 'Чёрным — допущено, красным — отказано.')),
      h('section.gazette__col',
        h('h3', 'Лучшие караулы'),
        leaders && leaders.length ? h('table.ledger', { style: { fontFamily: 'var(--font)', fontSize: '13px' } },
          h('thead', h('tr', h('th', 'Караульный'), h('th.num', 'Записей'), h('th.num', 'Отк.'))),
          h('tbody', leaders.map((l) => h('tr',
            h('td', l.inspector_callsign || `№${l.inspector_id}`),
            h('td.num', l.total_crossings),
            h('td.num', pct(l.denial_rate)))))) : h('p', 'Ни один караул ещё не сдан.'),
        h('div.gazette__ads', ADS.map((a) => h('p', a))))));
}

async function loadGazette() {
  const [stats, zones, daily, leaders] = await Promise.allSettled([api.stats(), api.zoneStats(), api.dailyStats(), api.leaderboard(8)]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  if ([stats, zones, daily, leaders].every((r) => r.status === 'rejected')) throw stats.reason;
  return { stats: v(stats), zones: v(zones), daily: v(daily), leaders: v(leaders) };
}

export function gazetteView(container) {
  mount(container, typing('Типография печатает'));
  const load = () => loadGazette()
    .then((data) => mount(container, gazettePaper(data)))
    .catch((e) => mount(container, errorBox(e, load)));
  load();
}

export async function openGazetteIntro(onDone) {
  try {
    const data = await loadGazette();
    let m = null;
    m = modal(h('div.stack',
      gazettePaper(data),
      h('div.row', { style: { justifyContent: 'center' } }, h('button.btn.btn--amber', { type: 'button', onclick: () => m.close() }, 'К посту'))),
    { size: 'xl', onClose: onDone });
    m.box.classList.add('modal--bare');
  } catch {
    if (onDone) onDone();
  }
}
