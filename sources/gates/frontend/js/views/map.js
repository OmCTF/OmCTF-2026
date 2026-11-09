// План крепости: места назначения, их порядок и наполненность.

import { api } from '../api.js';
import { state, refreshZones, levelName } from '../state.js';
import {
  h, mount, toast, fail, field, dl, select, typing, empty, errorBox, clickableRow, confirmBox,
  fmtDate, can, ZONE_STATUS,
} from '../ui.js';
import { svg, sfx } from '../art.js';
import { openCrossing } from './journal.js';

const CX = 360;
const CY = 195;
const RX = 190;
const RY = 140;
const POS = {
  0: [0, -0.02], 1: [-0.5, -0.32], 2: [0.5, 0.28], 3: [0.5, -0.32], 4: [-0.55, 0.28], 5: [-0.02, 0.4], 9: [0, -0.56],
};
const LAMP = { open: '#4f8a2a', restricted: '#c8862a', lockdown: '#b0261e' };

function tracePoints(n = 6, rot = 0) {
  const half = Math.PI / n;
  const spec = [[-0.55, 0.8], [-0.42, 0.93], [0, 1.12], [0.42, 0.93], [0.55, 0.8]];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    for (const [da, r] of spec) {
      const ang = a + da * half;
      pts.push([CX + Math.cos(ang) * RX * r, CY + Math.sin(ang) * RY * r]);
    }
  }
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function wrap(text, max = 14) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    if ((cur ? `${cur} ${w}` : w).length > max && cur) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function gateMark(angleDeg, label, here = false, labelR = 1.06) {
  const a = (angleDeg * Math.PI) / 180;
  const x = CX + Math.cos(a) * RX * 0.79;
  const y = CY + Math.sin(a) * RY * 0.79;
  const lx = CX + Math.cos(a) * RX * labelR;
  const ly = CY + Math.sin(a) * RY * labelR + 4;
  const t = svg('text', { x: lx, y: ly, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: here ? '#8b0000' : '#3a2a18', 'font-family': 'Courier New, monospace' });
  t.textContent = label;
  return svg('g', {},
    svg('rect', { x: x - 7, y: y - 5, width: 14, height: 10, fill: '#f2ead8', stroke: '#3a2a18', 'stroke-width': 1.5 }),
    svg('rect', { x: x - 2.5, y: y - 1, width: 5, height: 6, fill: '#3a2a18' }),
    here ? svg('circle', { cx: x, cy: y, r: 11, fill: 'none', stroke: '#8b0000', 'stroke-width': 2, 'stroke-dasharray': '3 2' }) : null,
    t);
}

export function mapView(container) {
  const me = state.me;
  let selected = state.zones[0] ? state.zones[0].zone : null;
  const planSlot = h('div');
  const panel = h('div');
  const table = h('div');

  function plan() {
    const marks = [];
    let extra = 0;
    for (const z of state.zones) {
      const [dx, dy] = POS[z.zone] || [-0.6 + 0.3 * extra++, 0.72];
      const x = CX + dx * RX;
      const y = CY + dy * RY;
      const label = svg('text', { x, y: y + 20, 'text-anchor': 'middle', 'font-size': 10, fill: '#2a1e10', 'font-family': 'Courier New, monospace' });
      wrap(z.name).forEach((line, i) => {
        const ts = svg('tspan', { x, dy: i === 0 ? 0 : 11 });
        ts.textContent = line;
        label.append(ts);
      });
      const num = svg('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#2a1e10', 'font-family': 'Courier New, monospace' });
      num.textContent = z.zone;
      const g = svg('g', {
        class: `zone-mark${z.zone === selected ? ' zone-mark--sel' : ''}`,
        tabindex: 0, role: 'button', 'aria-label': `${z.name}: ${ZONE_STATUS[z.status]}`,
      },
      svg('polygon', { points: `${x - 13},${y - 6} ${x},${y - 15} ${x + 13},${y - 6}`, fill: '#8a5a3a', stroke: '#3a2a18', 'stroke-width': 1 }),
      svg('rect', { class: 'zone-mark__box', x: x - 12, y: y - 6, width: 24, height: 14, fill: '#efe4c8', stroke: '#3a2a18', 'stroke-width': 1.2 }),
      num,
      svg('circle', { cx: x + 14, cy: y - 10, r: 4, fill: LAMP[z.status] || '#777', stroke: '#1a1a1a', 'stroke-width': 0.8 }),
      label);
      const pick = () => { selected = z.zone; sfx.paper(); render(); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      marks.push(g);
    }
    const irtysh = svg('path', { d: 'M60,0 C40,120 110,220 70,400', fill: 'none', stroke: '#8fa5aa', 'stroke-width': 46, opacity: 0.55 });
    const om = svg('path', { d: 'M640,350 C520,330 300,390 90,345', fill: 'none', stroke: '#8fa5aa', 'stroke-width': 20, opacity: 0.55 });
    const riverLabel = (x, y, text, rot = 0) => {
      const t = svg('text', { x, y, 'font-size': 12, 'font-style': 'italic', fill: '#3d5560', 'font-family': 'Georgia, serif', transform: `rotate(${rot} ${x} ${y})` });
      t.textContent = text;
      return t;
    };
    const titleT = svg('text', { x: 620, y: 24, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 700, fill: '#3a2a18', 'font-family': 'Courier New, monospace', 'letter-spacing': 1 });
    titleT.textContent = 'ПЛАНЪ ОМСКОЙ КРѢПОСТИ';
    return svg('svg', { viewBox: '0 0 640 400', role: 'img', 'aria-label': 'План крепости с местами назначения' },
      irtysh, om,
      riverLabel(52, 200, 'р. Иртышъ', -78),
      riverLabel(470, 362, 'р. Омь', -3),
      svg('polygon', { points: tracePoints(), fill: 'none', stroke: '#c9b88f', 'stroke-width': 18, 'stroke-linejoin': 'round' }),
      svg('polygon', { points: tracePoints(), fill: '#e6d7b2', stroke: '#5d4a30', 'stroke-width': 2.2 }),
      gateMark(90, 'Тобольскія ворота · вы здѣсь', true, 1.08),
      gateMark(270, 'Тарскія ворота', false, 1.1),
      ...marks,
      titleT);
  }

  async function renderPanel() {
    const z = state.zones.find((x) => x.zone === selected);
    if (!z) { mount(panel, h('div.paper', empty('Выберите место на плане.'))); return; }
    const recent = h('div', typing());
    const full = z.capacity && z.current_count >= z.capacity;
    const pct = z.capacity ? Math.min(100, Math.round((z.current_count / z.capacity) * 100)) : 0;
    const controls = h('div.stack');
    if (can(me, 'commandant')) {
      const st = select(Object.entries(ZONE_STATUS), z.status);
      const cap = h('input.input', { type: 'number', min: 0, value: z.capacity ?? '', placeholder: 'без предела' });
      controls.append(
        h('form.row', {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await api.setZoneStatus(z.zone, st.value);
              toast(`${z.name}: ${ZONE_STATUS[st.value].toLowerCase()}.`, 'ok');
              await refreshZones();
              render(true);
            } catch (err) { fail(err); }
          },
        }, h('label.field.grow', h('span.field__label', 'Порядок прохода'), st), h('button.btn.btn--ink.btn--sm', { type: 'submit' }, 'Утвердить')),
        h('form.row', {
          onsubmit: async (e) => {
            e.preventDefault();
            try {
              await api.setZoneCapacity(z.zone, cap.value === '' ? null : Number(cap.value));
              toast('Предел наполненности утверждён.', 'ok');
              await refreshZones();
              render(true);
            } catch (err) { fail(err); }
          },
        }, h('label.field.grow', h('span.field__label', 'Предел (человек)'), cap), h('button.btn.btn--ink.btn--sm', { type: 'submit' }, 'Утвердить')));
    } else {
      controls.append(h('p.small.muted', 'Порядок прохода и пределы наполненности утверждает комендант.'));
    }
    mount(panel, h('div.paper.tilt-r', { class: panel.dataset.flash ? 'flash' : '' },
      h('div.paper__head', h('h3', `№${z.zone} · ${z.name}`), h(`span.lamp.lamp--${z.status}`, { title: ZONE_STATUS[z.status] })),
      dl([
        ['Порядок', ZONE_STATUS[z.status] || z.status],
        ['Требуемый пропуск', levelName(z.min_level)],
        ['Внутри', z.capacity ? `${z.current_count} из ${z.capacity}` : `${z.current_count} (без предела)`],
        ['Изменено', fmtDate(z.updated_at)],
      ]),
      z.capacity ? h(`div.capbar${full ? '.capbar--full' : ''}`, h('span', { style: { width: `${pct}%` } })) : null,
      h('h3', { style: { fontSize: '13px', margin: '16px 0 6px' } }, 'Последние проходы'),
      recent,
      h('div', { style: { marginTop: '14px' } }, controls)));
    delete panel.dataset.flash;
    try {
      const r = await api.crossings({ zone: z.zone, limit: 6 });
      mount(recent, r.items.length
        ? h('table.ledger', h('tbody', r.items.map((c) => clickableRow(() => openCrossing(c.id),
          h('td', c.traveler_name), h(`td.verdict.${c.granted ? 'verdict--ok' : 'verdict--deny'}`, c.granted ? 'доп.' : 'отк.'), h('td.small', fmtDate(c.created_at))))))
        : empty('Сюда ещё никто не проходил.'));
    } catch (e) {
      mount(recent, errorBox(e));
    }
  }

  function renderTable() {
    mount(table, h('div.paper.paper--white.zone-list',
      h('div.paper__head', h('h3', 'Ведомость мест назначения'),
        can(me, 'commandant') ? h('button.btn.btn--ink.btn--sm', {
          type: 'button',
          onclick: async () => {
            if (!(await confirmBox('Обнулить счётчики наполненности всех мест?', { ok: 'Обнулить' }))) return;
            try {
              await api.resetZoneCounts();
              toast('Счётчики обнулены.', 'ok');
              await refreshZones();
              render();
            } catch (e) { fail(e); }
          },
        }, 'Обнулить счётчики') : null),
      h('div.ledger-wrap', h('table.ledger',
        h('thead', h('tr', h('th', '№'), h('th', 'Место'), h('th', 'Пропуск'), h('th', 'Порядок'), h('th.num', 'Внутри'), h('th.num', 'Предел'))),
        h('tbody', state.zones.map((z) => clickableRow(() => { selected = z.zone; render(); },
          h('td', z.zone), h('td', z.name), h('td', levelName(z.min_level)),
          h('td', h('span.row', { style: { gap: '6px', flexWrap: 'nowrap' } }, h(`span.lamp.lamp--${z.status}`), ZONE_STATUS[z.status])),
          h('td.num', z.current_count), h('td.num', z.capacity ?? '—'))))))));
  }

  function render(flash = false) {
    mount(planSlot, h('div.paper.blueprint', plan()));
    if (flash) panel.dataset.flash = '1';
    renderPanel();
    renderTable();
  }

  mount(container,
    h('div.view-head', h('div', h('h2', 'Крепость'), h('p', 'Места назначения за воротами: какой пропуск требуется, открыт ли проход и сколько народу внутри.'))),
    h('div.map-layout', planSlot, panel),
    table);
  if (!state.zones.length) mount(planSlot, typing());
  refreshZones().then(() => render());
}
