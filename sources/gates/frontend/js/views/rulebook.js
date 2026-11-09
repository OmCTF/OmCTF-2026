import { h, modal, ZONE_STATUS } from '../ui.js';
import { state, levelName, refreshZones } from '../state.js';

const PROCEDURE = [
  'Караульный должен состоять в карауле — без принятого караула журнал не ведётся.',
  'Печать на пропуске сверяется канцелярией. Поддельная бумага — отказ.',
  'Имя посетителя сверяется с розыскными листами. Совпадение — задержание и дело о происшествии.',
  'Закрытое место назначения — отказ любому.',
  'Категория пропуска должна быть не ниже требуемой для места назначения.',
  'Если место назначения заполнено до предела — отказ до освобождения.',
  'Во всех прочих случаях посетитель допускается, запись вносится в журнал входов.',
];

export async function openRulebook() {
  await refreshZones();
  const levels = (state.rules && state.rules.levels) || {};
  const directives = (state.rules && state.rules.directives) || [];
  const zonesTable = h('table.ledger',
    h('thead', h('tr', h('th', '№'), h('th', 'Место'), h('th', 'Допуск'), h('th', 'Порядок'))),
    h('tbody', state.zones.map((z) => h('tr',
      h('td', z.zone),
      h('td', z.name),
      h('td', levelName(z.min_level)),
      h('td', h('span.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, h(`span.lamp.lamp--${z.status}`), ZONE_STATUS[z.status] || z.status),
        z.capacity ? h('div.small.muted', `занято ${z.current_count} из ${z.capacity}`) : null)))));

  const book = h('div.book',
    h('section.book__page',
      h('h3', 'Места назначения'),
      zonesTable,
      h('h3', 'Категории пропусков'),
      h('table.ledger', h('tbody', Object.entries(levels)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([lvl, name]) => h('tr', h('td', lvl), h('td', name)))))),
    h('section.book__page',
      h('h3', 'Порядок досмотра'),
      h('ol', PROCEDURE.map((p) => h('li', p))),
      directives.length ? [h('h3', 'Директивы коменданта'), h('ol', directives.map((d) => h('li', d)))] : null));
  modal(book, { title: 'Свод правил караульной службы', size: 'xl' });
}
