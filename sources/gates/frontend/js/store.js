// Личные удобства караульного: токен, папка пропусков, звук, последняя папка.
// Всё живёт только в этом браузере и переживает отсутствие localStorage.

const PREFIX = 'vorota.';

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* приватный режим или запрет хранилища — просто не запоминаем */
  }
}

function remove(key) {
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* пусто */ }
}

const memory = { token: null };

export const local = {
  get token() { return memory.token ?? read('token', null); },
  set token(value) {
    memory.token = value || null;
    if (value) write('token', value); else remove('token');
  },

  get sound() { return read('sound', true); },
  set sound(on) { write('sound', !!on); },

  folder(callsign) {
    return read(`folder.${callsign}`, []);
  },
  saveFolder(callsign, items) {
    write(`folder.${callsign}`, items);
  },
  addPass(callsign, { label, xml, subject = null, role = null }) {
    if (!xml) return null;
    const items = local.folder(callsign);
    const existing = items.find((p) => p.xml === xml);
    if (existing) return existing;
    const item = {
      id: `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label: label || 'Пропуск',
      xml,
      subject,
      role,
      added: new Date().toISOString(),
    };
    items.unshift(item);
    local.saveFolder(callsign, items.slice(0, 40));
    return item;
  },
  removePass(callsign, id) {
    local.saveFolder(callsign, local.folder(callsign).filter((p) => p.id !== id));
  },

  get lastTab() { return read('tab', 'post'); },
  set lastTab(tab) { write('tab', tab); },

  gazetteSeen(callsign) { return read(`gazette.${callsign}`, ''); },
  markGazette(callsign, day) { write(`gazette.${callsign}`, day); },
};
