import { local } from './store.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const enc = encodeURIComponent;

function detailOf(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((d) => {
          const where = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body' && p !== 'query').join('.') : '';
          return where ? `${where}: ${d.msg}` : d.msg;
        })
        .join('; ');
    }
  }
  if (status === 0) return 'Связь с крепостью потеряна.';
  return `Канцелярия ответила ошибкой ${status}.`;
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, { body, query } = {}) {
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = local.token;
  if (token) headers['X-Token'] = token;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, detailOf(null, 0));
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, detailOf(data, res.status));
  }
  return data;
}

const get = (path, query) => request('GET', path, { query });
const post = (path, body) => request('POST', path, { body });
const put = (path, body) => request('PUT', path, { body });
const del = (path) => request('DELETE', path);

export const api = {
  // караульные
  register: (callsign, password) => post('/inspectors/register', { callsign, password }),
  login: (callsign, password) => post('/inspectors/login', { callsign, password }),
  logout: () => post('/inspectors/logout'),
  me: () => get('/inspectors/me'),
  changePassword: (old_password, new_password) => post('/inspectors/change-password', { old_password, new_password }),
  inspectors: (query) => get('/inspectors', query),
  inspector: (callsign) => get(`/inspectors/${enc(callsign)}`),
  performance: (callsign) => get(`/inspectors/${enc(callsign)}/performance`),
  promote: (callsign, rank) => post(`/inspectors/${enc(callsign)}/promote`, { rank }),
  deactivate: (callsign) => post(`/inspectors/${enc(callsign)}/deactivate`),
  reactivate: (callsign) => post(`/inspectors/${enc(callsign)}/reactivate`),

  // пост
  rules: () => get('/checkpoint/rules'),
  verify: (document) => post('/checkpoint/verify', { document }),
  crossing: (payload) => post('/checkpoint/crossing', payload),
  crossings: (query) => get('/checkpoint/crossings', query),
  crossingById: (id) => get(`/checkpoint/crossings/${enc(id)}`),
  issuePass: (subject, role) => post('/checkpoint/issue-pass', { subject, role }),

  // караул
  shiftStart: () => post('/shifts/start'),
  shiftEnd: (handoff_notes) => post('/shifts/end', { handoff_notes }),
  shiftCurrent: () => get('/shifts/current'),
  shifts: (query) => get('/shifts', query),
  shiftReport: (id) => get(`/shifts/report/${enc(id)}`),

  // приказы
  bulletins: (query) => get('/board', query),
  bulletin: (id) => get(`/board/${enc(id)}`),
  createBulletin: (payload) => post('/board', payload),
  updateBulletin: (id, payload) => put(`/board/${enc(id)}`, payload),
  deleteBulletin: (id) => del(`/board/${enc(id)}`),
  pinBulletin: (id, pinned) => post(`/board/${enc(id)}/${pinned ? 'pin' : 'unpin'}`),

  // розыск
  watchlist: (query) => get('/watchlist', query),
  watchlistCheck: (name) => get('/watchlist/check', { name }),
  watchlistAdd: (name, reason) => post('/watchlist', { name, reason }),
  watchlistRemove: (id) => del(`/watchlist/${enc(id)}`),

  // происшествия
  incidents: (query) => get('/incidents', query),
  incidentStats: () => get('/incidents/stats'),
  incident: (id) => get(`/incidents/${enc(id)}`),
  createIncident: (payload) => post('/incidents', payload),
  requestCorroboration: (id, report) => post(
    `/incidents/${enc(id)}/request-corroboration`,
    report,
  ),
  assignIncident: (id, assignee_callsign) => post(`/incidents/${enc(id)}/assign`, { assignee_callsign }),
  resolveIncident: (id, resolution_notes) => post(`/incidents/${enc(id)}/resolve`, { resolution_notes }),
  closeIncident: (id) => post(`/incidents/${enc(id)}/close`),
  addIncidentNote: (id, content) => post(`/incidents/${enc(id)}/notes`, { content }),

  // крепость
  zones: () => get('/zones'),
  setZoneStatus: (id, status) => post(`/zones/${enc(id)}/status`, { status }),
  setZoneCapacity: (id, capacity) => post(`/zones/${enc(id)}/capacity`, { capacity }),
  resetZoneCounts: () => post('/zones/reset-counts'),

  // квартира
  quarters: () => get('/quarters'),
  ledger: (query) => get('/quarters/ledger', query),
  buy: (code) => post('/quarters/buy', { code }),
  stashSetCode: (code, old_code = null) => post('/quarters/stash/code', { code, old_code }),
  stashOpen: (code) => post('/quarters/stash/open', { code }),
  stashPut: (code, label, content) => post('/quarters/stash/put', { code, label, content }),
  stashTake: (code, item_id) => post('/quarters/stash/take', { code, item_id }),

  // комендатура
  dispatchesAccess: (document) => post('/dispatches/access', { document }),
  dispatches: (query) => get('/dispatches', query),
  briefingsAccess: (document) => post('/briefings/access', { document }),

  // ведомости
  stats: () => get('/internal/stats'),
  zoneStats: () => get('/internal/stats/zones'),
  dailyStats: () => get('/internal/stats/daily'),
  leaderboard: (limit = 8) => get('/internal/stats/leaderboard', { limit }),
};
