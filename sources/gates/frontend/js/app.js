import { api, setUnauthorizedHandler } from './api.js';
import { local } from './store.js';
import { state, on, refreshShift, refreshZones, refreshPurse, loadRules } from './state.js';
import { h, mount, toast, confirmBox, RANK } from './ui.js';
import { GateScene, sfx } from './art.js';
import { titleScreen } from './views/title.js';
import { createPost } from './views/post.js';
import { journalView } from './views/journal.js';
import { boardView } from './views/board.js';
import { wantedView } from './views/wanted.js';
import { incidentsView } from './views/incidents.js';
import { mapView } from './views/map.js';
import { shiftView } from './views/shift.js';
import { quartersView } from './views/quarters.js';
import { gazetteView, openGazetteIntro } from './views/gazette.js';
import { officeView } from './views/office.js';
import { commView } from './views/comm.js';

const TABS = [
  { id: 'post', label: 'Пост' },
  { id: 'journal', label: 'Журнал', render: journalView },
  { id: 'board', label: 'Приказы', render: boardView },
  { id: 'wanted', label: 'Розыск', render: wantedView },
  { id: 'incidents', label: 'Происшествия', render: incidentsView },
  { id: 'map', label: 'Крепость', render: mapView },
  { id: 'shift', label: 'Караул', render: shiftView },
  { id: 'quarters', label: 'Квартира', render: quartersView },
  { id: 'gazette', label: 'Ведомости', render: gazetteView },
  { id: 'office', label: 'Канцелярия', render: officeView },
  { id: 'comm', label: 'Комендатура', render: commView },
];

const root = document.getElementById('app');
let view = null;
let post = null;
let offShift = null;

function teardown() {
  if (view && view.destroy) view.destroy();
  view = null;
  if (post) post.destroy();
  post = null;
  if (offShift) offShift();
  offShift = null;
  window.onhashchange = null;
  state.scene = null;
}

function showTitle() {
  teardown();
  state.me = null;
  state.shift = null;
  state.purse = null;
  mount(root, titleScreen({ onEnter: enterGame }));
}

async function enterGame() {
  try {
    state.me = await api.me();
  } catch {
    local.token = null;
    showTitle();
    return;
  }
  await Promise.all([refreshZones(), loadRules(), refreshShift(), refreshPurse()]);
  buildGame();
  const today = new Date().toDateString();
  if (local.gazetteSeen(state.me.callsign) !== today) {
    local.markGazette(state.me.callsign, today);
    openGazetteIntro();
  }
}

async function logout() {
  if (state.shift && !(await confirmBox('Караул не сдан. Уйти со службы, не сдав караул? Он останется открытым до вашего возвращения.', { ok: 'Уйти' }))) return;
  try { await api.logout(); } catch { /* сеанс и так мог истечь */ }
  local.token = null;
  showTitle();
}

function buildGame() {
  teardown();
  const me = state.me;
  const canvas = h('canvas.pixel');
  post = createPost();
  const surface = h('div.desk__surface', { id: 'desk', role: 'tabpanel', tabindex: '-1' });
  const tabButtons = TABS.map((t) => h('button.tab', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'desk', 'aria-selected': 'false',
    onclick: () => select(t.id, true),
  }, t.label));

  const soundBtn = h('button.icon-btn', {
    type: 'button',
    'aria-pressed': String(sfx.on),
    onclick: () => {
      const on = sfx.toggle();
      soundBtn.textContent = on ? 'Звук: вкл' : 'Звук: выкл';
      soundBtn.setAttribute('aria-pressed', String(on));
      if (on) sfx.paper();
    },
  }, sfx.on ? 'Звук: вкл' : 'Звук: выкл');

  const header = h('header.topbar',
    h('span.topbar__brand', 'Ворота', h('small', (state.rules && state.rules.checkpoint) || 'Омская крепость')),
    h('span.topbar__spacer'),
    h('span.topbar__who', h('span.rank-badge', RANK[me.rank] || me.rank), h('b', me.callsign)),
    soundBtn,
    h('button.icon-btn', { type: 'button', onclick: logout }, 'Уйти со службы'));

  mount(root, h('div.game',
    header,
    h('div.scene', { 'aria-hidden': 'true' }, canvas),
    h('div.workspace',
      post.booth,
      h('section.desk', { 'aria-label': 'Стол караульного' },
        h('nav.tabs', { role: 'tablist', 'aria-label': 'Папки на столе' }, tabButtons),
        surface))));
  state.scene = new GateScene(canvas, { queue: 6 });

  function select(id, sound = false) {
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    if (view && view.destroy) view.destroy();
    view = null;
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === tab.id)));
    surface.setAttribute('aria-labelledby', `tab-${tab.id}`);
    surface.replaceChildren();
    surface.scrollTop = 0;
    if (tab.id === 'post') post.renderDesk(surface);
    else view = tab.render(surface) || null;
    local.lastTab = tab.id;
    if (location.hash !== `#${tab.id}`) history.replaceState(null, '', `#${tab.id}`);
    if (sound) sfx.paper();
  }

  offShift = on('shift', () => { if (view && view.onShift) view.onShift(); });
  window.onhashchange = () => {
    const id = location.hash.slice(1);
    if (TABS.some((t) => t.id === id)) select(id);
  };
  const initial = location.hash.slice(1) || local.lastTab;
  select(TABS.some((t) => t.id === initial) ? initial : 'post');
}

setUnauthorizedHandler(() => {
  if (!state.me) return;
  local.token = null;
  toast('Сеанс окончен. Предъявите позывной заново.', 'error');
  showTitle();
});

if (local.token) enterGame();
else showTitle();
