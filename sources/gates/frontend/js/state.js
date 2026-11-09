import { api } from './api.js';

export const state = {
  me: null,        // { inspector_id, callsign, rank, active_shift_id }
  zones: [],
  rules: null,     // { checkpoint, directives, levels }
  shift: null,
  scene: null,
  purse: null,     // GET /quarters: жалованье, покупки, приказ дня, тайник
};

const bus = new EventTarget();
export function on(type, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}
export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export async function refreshShift() {
  try {
    state.shift = await api.shiftCurrent();
  } catch {
    state.shift = null;
  }
  emit('shift', state.shift);
  return state.shift;
}

export async function refreshZones() {
  try {
    state.zones = await api.zones();
  } catch {
    state.zones = state.zones || [];
  }
  emit('zones', state.zones);
  return state.zones;
}

export async function loadRules() {
  try {
    state.rules = await api.rules();
  } catch {
    state.rules = state.rules || { directives: [], levels: {} };
  }
  return state.rules;
}

export async function refreshPurse() {
  try {
    state.purse = await api.quarters();
  } catch {
    /* оставляем прежнее */
  }
  emit('purse', state.purse);
  return state.purse;
}

// Ответ на штамп приходит вместе с записью журнала — обновляем кошелёк без лишнего запроса.
export function applyPay(pay) {
  if (!pay || !state.purse) return;
  state.purse = { ...state.purse, balance: pay.balance, streak: pay.streak, suspicion: pay.suspicion };
  emit('purse', state.purse);
}

export function owns(code) {
  return !!(state.purse && state.purse.catalog.some((c) => c.code === code && c.owned));
}

export function zoneName(id) {
  const z = state.zones.find((x) => x.zone === Number(id));
  return z ? z.name : `Квартал №${id}`;
}

export function levelName(level) {
  const levels = (state.rules && state.rules.levels) || {};
  return levels[String(level)] ?? `уровень ${level}`;
}
