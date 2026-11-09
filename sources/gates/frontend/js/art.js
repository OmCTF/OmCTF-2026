// Пиксельная графика и звук. Никаких внешних ресурсов: игровая сеть может быть
// отрезана от интернета, поэтому всё рисуется и синтезируется на месте.

import { hash, rng } from './ui.js';
import { local } from './store.js';

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v));
  const r = cl((n >> 16) + amt);
  const g = cl(((n >> 8) & 255) + amt);
  const b = cl((n & 255) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/* ==========================================================================
   Портрет посетителя (24×28 пикселей)
   ========================================================================== */
const SKIN = ['#e0bf98', '#d2a77c', '#c2946a', '#a8774f', '#e6c8a6'];
const HAIR = ['#21170f', '#4a2f1b', '#7a5a32', '#a9a294', '#121212', '#5e3b1e'];
const COATS = [
  ['#4b4f46', '#3a3d36'], ['#5c4532', '#46331f'], ['#2e3a4e', '#222b3b'],
  ['#5a4a35', '#463826'], ['#3a3838', '#2a2828'], ['#5e2f2a', '#46211d'], ['#465a4a', '#344436'],
];
const MALE_HATS = ['none', 'cap', 'papakha', 'ushanka', 'cap', 'none', 'papakha'];

export function portrait(seedText, { px = 4, bg = '#2b2f36', female = false } = {}) {
  const W = 24;
  const H = 28;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'pixel';
  c.style.width = `${W * px}px`;
  c.style.height = `${H * px}px`;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `Портрет: ${seedText}`);
  const g = c.getContext('2d');
  const r = rng(hash(seedText));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  fill(0, 0, W, H, bg);
  for (let i = 0; i < 16; i++) fill(Math.floor(r() * W), Math.floor(r() * H), 1, 1, shade(bg, r() < 0.5 ? -7 : 7));

  const skin = pick(SKIN);
  const skinD = shade(skin, -24);
  const hair = pick(HAIR);
  const [coat, coatD] = pick(COATS);
  const hat = female ? (r() < 0.75 ? 'scarf' : 'none') : pick(MALE_HATS);

  // плечи и шинель
  for (let y = 20; y < H; y++) {
    const inset = y === 20 ? 5 : y === 21 ? 3 : 2;
    fill(inset, y, W - inset * 2, 1, coat);
  }
  fill(W - 5, 22, 3, H - 22, coatD);
  fill(11, 21, 2, H - 21, coatD);
  if (r() < 0.6) for (let y = 22; y < H; y += 2) fill(10, y, 1, 1, '#b8a46a');
  if (r() < 0.35) {
    fill(6, 19, 12, 2, '#d9d2c3');
    fill(5, 21, 4, 1, '#d9d2c3');
    fill(15, 21, 4, 1, '#d9d2c3');
  } else {
    fill(8, 19, 3, 2, coatD);
    fill(13, 19, 3, 2, coatD);
  }
  fill(10, 17, 4, 3, skinD);

  // голова
  const rows = { 6: [9, 14], 7: [8, 15], 8: [7, 16], 9: [7, 16], 10: [7, 16], 11: [7, 16], 12: [7, 16], 13: [7, 16], 14: [7, 16], 15: [7, 16], 16: [8, 15], 17: [9, 14] };
  for (const [y, [a, b]] of Object.entries(rows)) {
    fill(a, +y, b - a + 1, 1, skin);
    fill(b, +y, 1, 1, skinD);
  }
  fill(6, 11, 1, 3, skinD);
  fill(17, 11, 1, 3, skinD);
  fill(9, 11, 2, 1, '#1b1612');
  fill(13, 11, 2, 1, '#1b1612');
  fill(9, 10, 2, 1, shade(hair, -10));
  fill(13, 10, 2, 1, shade(hair, -10));
  fill(11, 12, 2, 2, skinD);
  fill(10, 15, 4, 1, '#7a3f35');
  if (r() < 0.25) fill(8, 13, 1, 1, '#c97a6a');

  if (!female) {
    const beard = r();
    if (beard < 0.35) {
      for (let y = 14; y <= 19; y++) {
        const a = y < 16 ? 7 : y < 18 ? 8 : 9;
        const b = y < 16 ? 16 : y < 18 ? 15 : 14;
        fill(a, y, b - a + 1, 1, hair);
      }
      fill(10, 15, 4, 1, '#4a2a22');
    } else if (beard < 0.6) {
      fill(9, 14, 6, 1, hair);
    } else if (beard < 0.75) {
      fill(9, 14, 6, 1, hair);
      fill(10, 16, 4, 2, hair);
    }
  }

  if (hat === 'none') {
    fill(8, 5, 8, 1, hair);
    fill(7, 6, 10, 3, hair);
    fill(7, 9, 1, 3, hair);
    fill(16, 9, 1, 3, hair);
    if (female) { fill(6, 8, 2, 11, hair); fill(16, 8, 2, 11, hair); }
  } else if (hat === 'cap') {
    const cc = pick(['#2a2d33', '#3d3328', '#24303f']);
    fill(8, 3, 8, 1, cc);
    fill(7, 4, 10, 4, cc);
    fill(7, 7, 10, 1, r() < 0.5 ? '#8a2a22' : shade(cc, 20));
    fill(6, 8, 10, 1, '#111111');
    fill(7, 9, 1, 2, hair);
    fill(16, 9, 1, 2, hair);
  } else if (hat === 'papakha') {
    const fc = pick(['#2a2622', '#4c4640', '#191715', '#5a4a3a']);
    fill(6, 1, 12, 8, fc);
    for (let i = 0; i < 14; i++) fill(6 + Math.floor(r() * 12), 1 + Math.floor(r() * 8), 1, 1, shade(fc, 18));
  } else if (hat === 'ushanka') {
    const fc = pick(['#4b3b2b', '#3b3632', '#6a5a48']);
    fill(6, 3, 12, 6, fc);
    fill(5, 8, 3, 7, fc);
    fill(16, 8, 3, 7, fc);
    fill(7, 3, 10, 1, shade(fc, 22));
  } else {
    const sc = pick(['#7a2e2e', '#3f5a3a', '#6a5a2a', '#4a3a5a', '#8a6a3a', '#2f4a6a']);
    fill(7, 4, 10, 2, sc);
    fill(6, 6, 12, 3, sc);
    fill(6, 9, 2, 9, sc);
    fill(16, 9, 2, 9, sc);
    fill(8, 18, 8, 2, sc);
    for (let i = 0; i < 9; i++) fill(6 + Math.floor(r() * 12), 4 + Math.floor(r() * 5), 1, 1, shade(sc, 28));
  }
  return c;
}

/* ==========================================================================
   Вид на ворота (верхняя полоса экрана)
   ========================================================================== */
const PERSON_COATS = ['#4b4f46', '#5c4532', '#2e3a4e', '#5a4a35', '#3a3838', '#5e2f2a', '#6b5a3e', '#465a4a'];
const PERSON_SKIN = ['#e0bf98', '#d2a77c', '#c2946a', '#a8774f'];

function sky(hour) {
  if (hour < 6 || hour >= 21) return { top: '#0b0e1c', bottom: '#1f2740', night: 0.5 };
  if (hour < 8) return { top: '#2a3150', bottom: '#b07a5a', night: 0.22 };
  if (hour < 17) return { top: '#66727f', bottom: '#aab3b9', night: 0 };
  return { top: '#2c2f4a', bottom: '#a8664a', night: 0.22 };
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export class GateScene {
  constructor(canvas, { queue = 5, auto = false } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.queueSize = queue;
    this.auto = auto;
    this.people = [];
    this.walkers = [];
    this.flakes = [];
    this.smoke = [];
    this.atWindow = null;
    this.barrier = 0;
    this.barrierTarget = 0;
    this.time = 0;
    this.last = performance.now();
    this.acc = 0;
    this.autoTimer = 2;
    this.seed = 1;
    this.bg = document.createElement('canvas');
    this.skyHour = -1;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    this.ro = null;
  }

  makePerson(x) {
    const r = rng(hash(`p${this.seed++}${Math.random()}`));
    return {
      x,
      tx: x,
      coat: PERSON_COATS[Math.floor(r() * PERSON_COATS.length)],
      skin: PERSON_SKIN[Math.floor(r() * PERSON_SKIN.length)],
      hat: Math.floor(r() * 4),
      bag: r() < 0.35,
      bob: r() * 10,
      alpha: 1,
    };
  }

  queueX(i) { return this.gx - 30 - i * 7; }
  windowX() { return this.gx - 21; }

  resize() {
    const rect = this.c.getBoundingClientRect();
    const H = 56;
    const scale = Math.max(1, rect.height / H || 3);
    const W = Math.max(120, Math.round((rect.width || 900) / scale));
    this.W = W;
    this.H = H;
    this.c.width = W;
    this.c.height = H;
    this.bg.width = W;
    this.bg.height = H;
    this.gx = Math.round(W * 0.62);
    this.groundY = 45;
    if (!this.flakes.length) {
      for (let i = 0; i < 80; i++) this.flakes.push({ x: Math.random() * W, y: Math.random() * H, v: 3 + Math.random() * 6, p: Math.random() * 6.28 });
    }
    while (this.people.length < this.queueSize) this.people.push(this.makePerson(this.queueX(this.people.length)));
    this.people.forEach((p, i) => { p.x = this.queueX(i); p.tx = p.x; });
    if (this.atWindow) { this.atWindow.x = this.windowX(); this.atWindow.tx = this.atWindow.x; }
    this.skyHour = -1;
    this.paintStatic();
  }

  setQueue(n) {
    this.queueSize = Math.max(0, Math.min(12, n));
    while (this.people.length > this.queueSize) this.people.pop();
    while (this.people.length < this.queueSize) {
      const p = this.makePerson(-6 - this.people.length * 7);
      p.tx = this.queueX(this.people.length);
      this.people.push(p);
    }
  }

  call() {
    if (this.atWindow) this.reject();
    const p = this.people.shift() || this.makePerson(-6);
    p.tx = this.windowX();
    this.atWindow = p;
    this.walkers.push(p);
    this.people.forEach((q, i) => { q.tx = this.queueX(i); });
    const fresh = this.makePerson(-6);
    fresh.tx = this.queueX(this.people.length);
    if (this.people.length < this.queueSize) this.people.push(fresh);
  }

  admit() {
    const p = this.atWindow;
    if (!p) return;
    this.atWindow = null;
    this.barrierTarget = 1;
    p.tx = this.gx + 20;
    p.onArrive = () => { p.fading = true; };
  }

  reject() {
    const p = this.atWindow;
    if (!p) return;
    this.atWindow = null;
    p.tx = -10;
    p.onArrive = () => { p.gone = true; };
  }

  paintStatic() {
    const hour = new Date().getHours();
    this.skyHour = hour;
    const g = this.bg.getContext('2d');
    const { W, H, gx } = this;
    const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const s = sky(hour);
    this.night = s.night;

    // небо полосами
    const bands = 8;
    for (let i = 0; i < bands; i++) fill(0, Math.floor((i * 30) / bands), W, Math.ceil(30 / bands) + 1, mix(s.top, s.bottom, i / (bands - 1)));
    fill(0, 30, W, H - 30, s.bottom);

    // собор за валом
    const cx = Math.round(W * 0.28);
    const dome = s.night ? '#3d4a3e' : '#4f6b52';
    fill(cx, 10, 8, 14, '#cfc8ba');
    fill(cx + 7, 10, 1, 14, '#aaa294');
    fill(cx + 1, 7, 6, 3, dome);
    fill(cx + 2, 5, 4, 2, dome);
    fill(cx + 3, 4, 2, 1, dome);
    fill(cx + 3, 1, 2, 3, '#c9a227');
    fill(cx + 2, 2, 4, 1, '#c9a227');
    fill(cx + 3, 15, 2, 3, '#2a2622');
    fill(cx - 6, 16, 6, 8, '#cfc8ba');
    fill(cx - 5, 14, 4, 2, dome);
    fill(cx + 8, 17, 9, 7, '#bfb8aa');

    // крыши слободы
    const rr = rng(hash(`roofs${W}`));
    this.chimneys = [];
    for (let x = 4; x < W - 8; x += 11 + Math.floor(rr() * 9)) {
      if (Math.abs(x - cx) < 14 || (x > gx - 6 && x < gx + 50)) continue;
      const hgt = 4 + Math.floor(rr() * 4);
      const col = ['#5a4a3e', '#4a4038', '#6a5646'][Math.floor(rr() * 3)];
      fill(x, 24 - hgt, 9, hgt, col);
      for (let i = 0; i < 3; i++) fill(x + i, 24 - hgt - 3 + i, 9 - i * 2, 1, '#3a3530');
      fill(x - 1, 24 - hgt - 1, 11, 1, '#dfe3e8');
      if (rr() < 0.6) {
        fill(x + 6, 24 - hgt - 4, 2, 3, '#3a3530');
        this.chimneys.push({ x: x + 6, y: 24 - hgt - 5 });
      }
    }

    // вал
    fill(0, 22, W, 2, '#dfe3e8');
    fill(0, 24, W, this.groundY - 24, '#6d5e52');
    for (let y = 26; y < this.groundY; y += 3) {
      fill(0, y, W, 1, '#5b4e44');
      const off = (y / 3) % 2 ? 0 : 4;
      for (let x = off; x < W; x += 8) fill(x, y - 2, 1, 2, '#5f5248');
    }
    fill(0, 24, W, 1, '#8a7c70');

    // Тобольские ворота
    const gw = 44;
    const top = 9;
    fill(gx, top, gw, this.groundY - top, '#d9d4c8');
    fill(gx + gw - 3, top, 3, this.groundY - top, '#b9b2a4');
    fill(gx - 2, top - 1, gw + 4, 2, '#b9b2a4');
    for (let i = 0; i < 7; i++) {
      const inset = Math.round((i + 1) * 3);
      fill(gx + inset - 1, top - 2 - i, gw + 2 - inset * 2, 1, i === 0 ? '#c9c3b6' : '#d9d4c8');
    }
    fill(gx + gw / 2 - 1, top - 6, 2, 2, '#9a7a3a');
    fill(gx + 3, top + 2, 2, this.groundY - top - 2, '#ebe7de');
    fill(gx + gw - 7, top + 2, 2, this.groundY - top - 2, '#c7c0b2');
    const ax = gx + gw / 2 - 7;
    fill(ax, 26, 14, this.groundY - 26, '#1d1915');
    fill(ax + 1, 25, 12, 1, '#1d1915');
    fill(ax + 3, 24, 8, 1, '#1d1915');
    fill(ax + 6, 21, 2, 3, '#bdb6a8');
    fill(gx + gw / 2 - 7, 14, 14, 4, '#3b3a36');
    fill(gx + gw / 2 - 5, 15, 10, 1, '#9a8a5a');
    fill(gx + 8, 28, 3, 6, '#2a2622');
    fill(gx + gw - 12, 28, 3, 6, '#2a2622');
    this.lampX = ax - 3;
    this.lampY = 24;
    fill(this.lampX, this.lampY, 2, 3, '#2a2622');

    // будка часового — полосатая
    const bx = gx - 13;
    const stripes = ['#1a1a1a', '#e9e4d6', '#c46a2a'];
    for (let i = 0; i < 6; i++) fill(bx + i, 30, 1, this.groundY - 30, stripes[Math.floor(i / 2) % 3]);
    for (let i = 0; i < 3; i++) fill(bx - 1 + i, 29 - i, 8 - i * 2, 1, '#2a2622');
    fill(bx + 2, 34, 2, this.groundY - 34, '#141210');

    // земля и тропа
    fill(0, this.groundY, W, H - this.groundY, '#c9cdd2');
    fill(0, this.groundY, gx + gw, 3, '#a9aeb4');
    fill(ax, this.groundY, 14, 4, '#9aa0a8');
    for (let i = 0; i < W / 3; i++) fill(Math.floor(rr() * W), this.groundY + 3 + Math.floor(rr() * (H - this.groundY - 3)), 1, 1, '#b5bac0');

    // дальний караульный домик справа — пост караульного
    const hx = gx + gw + 18;
    if (hx + 22 < W) {
      fill(hx, 31, 20, this.groundY - 31, '#7a6a5a');
      for (let i = 0; i < 4; i++) fill(hx - 2 + i, 30 - i, 24 - i * 2, 1, '#4a3a30');
      fill(hx + 4, 35, 6, 5, '#26221f');
      this.boothWin = { x: hx + 5, y: 36 };
    } else {
      this.boothWin = null;
    }
  }

  drawPerson(p, t) {
    const g = this.g;
    const X = Math.round(p.x);
    const Y = this.groundY;
    const walking = Math.abs(p.tx - p.x) > 0.5;
    const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    g.globalAlpha = p.alpha;
    const bob = !walking && Math.sin(t * 1.3 + p.bob) > 0.96 ? 1 : 0;
    const step = walking ? Math.floor(t * 6 + p.bob) % 2 : 0;
    fill(X + (step ? 0 : 1), Y - 2, 1, 2, '#1d1a18');
    fill(X + (step ? 3 : 2), Y - 2, 1, 2, '#1d1a18');
    fill(X, Y - 7 - bob, 4, 5 + bob, p.coat);
    fill(X + 3, Y - 7 - bob, 1, 4, shade(p.coat, -18));
    fill(X + 1, Y - 9 - bob, 2, 2, p.skin);
    if (p.hat === 1) fill(X + 1, Y - 10 - bob, 2, 1, '#222222');
    else if (p.hat === 2) fill(X, Y - 11 - bob, 4, 2, '#2c2824');
    else if (p.hat === 3) { fill(X, Y - 10 - bob, 4, 2, '#7a2e2e'); fill(X, Y - 8 - bob, 1, 2, '#7a2e2e'); }
    else fill(X + 1, Y - 10 - bob, 2, 1, '#3a2a1a');
    if (p.bag) fill(X - 1, Y - 5 - bob, 1, 3, '#6a4a2a');
    g.globalAlpha = 1;
  }

  drawSoldier(X, t) {
    const g = this.g;
    const Y = this.groundY;
    const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    fill(X + 1, Y - 2, 1, 2, '#141414');
    fill(X + 2, Y - 2, 1, 2, '#141414');
    fill(X, Y - 8, 4, 6, '#4b4f46');
    fill(X, Y - 5, 4, 1, '#c9c3b5');
    fill(X + 1, Y - 10, 2, 2, '#d2a77c');
    fill(X + 1, Y - 13, 2, 3, '#151515');
    fill(X + 1, Y - 14, 2, 1, '#c9c3b5');
    fill(X + 4, Y - 14, 1, 12, '#5a3a22');
    fill(X + 4, Y - 17, 1, 3, Math.sin(t * 2 + X) > 0.9 ? '#ffffff' : '#c8ccd2');
  }

  drawBarrier() {
    const g = this.g;
    const px = this.gx - 3;
    const py = 37;
    g.fillStyle = '#3a3532';
    g.fillRect(px, py, 2, this.groundY - py);
    const a = this.barrier * (Math.PI * 0.45);
    for (let i = 0; i < 16; i++) {
      const x = Math.round(px - Math.cos(a) * i);
      const y = Math.round(py - Math.sin(a) * i);
      g.fillStyle = Math.floor(i / 2) % 2 ? '#e9e4d6' : '#b0261e';
      g.fillRect(x, y, 1, 1);
    }
  }

  step(dt) {
    this.time += dt;
    const speed = 13;
    const move = (p) => {
      const d = p.tx - p.x;
      if (Math.abs(d) > 0.3) p.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
      else if (p.onArrive) { const fn = p.onArrive; p.onArrive = null; fn(); }
    };
    this.people.forEach(move);
    for (const w of this.walkers) {
      move(w);
      if (w.fading) {
        w.alpha -= dt * 1.5;
        if (w.alpha <= 0) { w.gone = true; this.barrierTarget = 0; }
      }
    }
    this.walkers = this.walkers.filter((w) => !w.gone);
    const bd = this.barrierTarget - this.barrier;
    this.barrier += Math.sign(bd) * Math.min(Math.abs(bd), dt * 1.6);

    for (const f of this.flakes) {
      f.y += f.v * dt;
      f.x += Math.sin(this.time + f.p) * 2 * dt;
      if (f.y > this.H) { f.y = -1; f.x = Math.random() * this.W; }
    }
    if (this.chimneys && Math.random() < dt * 3 && this.chimneys.length) {
      const ch = this.chimneys[Math.floor(Math.random() * this.chimneys.length)];
      this.smoke.push({ x: ch.x, y: ch.y, life: 0 });
    }
    for (const s of this.smoke) { s.life += dt; s.y -= dt * 3; s.x += dt * 1.5; }
    this.smoke = this.smoke.filter((s) => s.life < 3);

    if (this.auto) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        if (this.atWindow) { if (Math.random() < 0.6) this.admit(); else this.reject(); this.autoTimer = 2 + Math.random() * 2; }
        else { this.call(); this.autoTimer = 3 + Math.random() * 2; }
      }
    }
  }

  render() {
    const g = this.g;
    const { W, H } = this;
    if (new Date().getHours() !== this.skyHour) this.paintStatic();
    g.drawImage(this.bg, 0, 0);
    const t = this.time;

    if (this.night > 0.3) {
      for (let i = 0; i < 26; i++) {
        const x = (i * 37 + 11) % W;
        const y = (i * 13 + 3) % 18;
        if (Math.sin(t * 2 + i * 1.7) > -0.6) { g.fillStyle = i % 5 ? '#c8cde0' : '#ffffff'; g.fillRect(x, y, 1, 1); }
      }
    }
    for (const s of this.smoke) {
      g.fillStyle = `rgba(160,160,165,${0.45 * (1 - s.life / 3)})`;
      g.fillRect(Math.round(s.x), Math.round(s.y), s.life > 1.5 ? 2 : 1, 1);
    }
    this.drawSoldier(this.gx + 5, t);
    this.drawSoldier(this.gx + 35, t + 1);
    for (let i = this.people.length - 1; i >= 0; i--) this.drawPerson(this.people[i], t);
    for (const w of this.walkers) this.drawPerson(w, t);
    this.drawBarrier();

    if (this.night > 0) {
      g.fillStyle = `rgba(8,12,34,${this.night})`;
      g.fillRect(0, 0, W, H);
      const flick = 0.75 + Math.sin(t * 9) * 0.08 + Math.random() * 0.06;
      const lamp = g.createRadialGradient(this.lampX + 1, this.lampY + 1, 0, this.lampX + 1, this.lampY + 1, 16);
      lamp.addColorStop(0, `rgba(255,200,110,${0.55 * flick})`);
      lamp.addColorStop(1, 'rgba(255,200,110,0)');
      g.fillStyle = lamp;
      g.fillRect(this.lampX - 16, this.lampY - 16, 34, 34);
      g.fillStyle = '#ffd27a';
      g.fillRect(this.lampX, this.lampY, 2, 2);
    }
    if (this.boothWin) {
      g.fillStyle = this.night > 0 ? '#f0c060' : '#d8c070';
      g.fillRect(this.boothWin.x, this.boothWin.y, 4, 3);
    }
    g.fillStyle = '#f4f6fa';
    for (const f of this.flakes) g.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
  }

  loop(now) {
    if (!this.c.isConnected) { this.destroy(); return; }
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    if (this.acc >= 1 / 15) {
      this.step(this.acc);
      this.render();
      this.acc = 0;
    }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }
}

/* ==========================================================================
   Товары лавки интенданта (12×12 пикселей)
   ========================================================================== */
const SPRITES = {
  rulebook: {
    pal: { a: '#4a1c12', b: '#7a3a28', g: '#d4a72c', p: '#e8dcc1' },
    rows: ['............', '.aaaaaaaaa..', '.abbbbbbbap.', '.abgggggbap.', '.abbbbbbbap.', '.abbgggbbap.', '.abbbbbbbap.', '.abbbbbbbap.', '.abbbbbbbap.', '.aaaaaaaaap.', '..ppppppppp.', '............'],
  },
  wanted_copy: {
    pal: { f: '#5a3f27', p: '#e3d4ae', k: '#2a2218', s: '#a07a5a', r: '#8b0000' },
    rows: ['ffffffffffff', 'fppppppppppf', 'fprrrrrrrrpf', 'fppppppppppf', 'fpppsssspppf', 'fpppskkspppf', 'fpppsssspppf', 'fppkkkkkkppf', 'fppppppppppf', 'fppkkkkkkppf', 'fppppppppppf', 'ffffffffffff'],
  },
  magnifier: {
    pal: { m: '#8a8f96', g: '#9fc3d1', w: '#eef6fa', h: '#5a3a22' },
    rows: ['...mmmm.....', '..mggggm....', '.mggwgggm...', '.mgwggggm...', '.mggggggm...', '.mggggggm...', '..mggggm....', '...mmmmh....', '.......hh...', '........hh..', '.........hh.', '..........h.'],
  },
  tulup: {
    pal: { w: '#e6dfcf', c: '#7a5a3a', d: '#5a4028' },
    rows: ['....wwww....', '..wwwccwww..', '.ccwccccwcc.', '.ccccwwcccc.', 'cccccwdccccc', 'cc.ccwdccc.c', 'cc.ccwdccc.c', 'cc.ccwdccc.c', '...ccwdccc..', '...ccwdccc..', '...ccwdccc..', '...wwwwwww..'],
  },
  samovar: {
    pal: { b: '#c08a2a', y: '#f0d070', d: '#3a2a18' },
    rows: ['.....dd.....', '....bbbb....', '.....bb.....', '...bbbbbb...', '..bbbyybbb..', '..bbyybbbb..', 'd.bbbbbbbb.d', 'dddbbbbbbddd', '..bbbbbbbb..', '...bbddbb...', '...dd..dd...', '..dddddddd..'],
  },
  stove: {
    pal: { k: '#3a3532', t: '#e8e4da', b: '#3f6aa0', o: '#e8742a', y: '#f2c04a' },
    rows: ['..kkkkkkkk..', '..kttttttk..', '..ktbttbtk..', '..kttttttk..', '..ktbttbtk..', '..kttttttk..', '..kkkkkkkk..', '..kkoyyokk..', '..kkooookk..', '..kkkkkkkk..', '.kkkkkkkkkk.', '............'],
  },
  stash: {
    pal: { w: '#8a6a45', d: '#4a3622', k: '#1a120a', g: '#c9a227' },
    rows: ['wwwwwwwwwwww', 'dddddddddddd', 'wwwwwwwwwwww', 'wwwwggwwwwww', 'wwwgkkgwwwww', 'wwwwkkwwwwww', 'wwwwkkwwwwww', 'dddddddddddd', 'wwwwwwwwwwww', 'wwwwwwwwwwww', 'dddddddddddd', 'wwwwwwwwwwww'],
  },
};

export function sprite(code, { px = 4 } = {}) {
  const def = SPRITES[code];
  const c = document.createElement('canvas');
  c.width = 12;
  c.height = 12;
  c.className = 'pixel';
  c.style.width = `${12 * px}px`;
  c.style.height = `${12 * px}px`;
  c.setAttribute('aria-hidden', 'true');
  if (!def) return c;
  const g = c.getContext('2d');
  def.rows.forEach((row, y) => {
    [...row].slice(0, 12).forEach((ch, x) => {
      const col = def.pal[ch];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    });
  });
  return c;
}

/* ==========================================================================
   Печать коменданта (SVG)
   ========================================================================== */
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
}

export function seal({ size = 84, color = '#8b1a1a', text = 'КОМЕНДАНТЪ ОМСКОЙ КРѢПОСТИ · ' } = {}) {
  const id = `seal${Math.random().toString(36).slice(2, 9)}`;
  const path = svg('path', { id, d: 'M50,50 m-35,0 a35,35 0 1,1 70,0 a35,35 0 1,1 -70,0' });
  const tp = svg('textPath', { href: `#${id}` });
  tp.textContent = text;
  const label = svg('text', { fill: color, 'font-size': 10, 'font-weight': 700, 'letter-spacing': 1.1, 'font-family': 'Courier New, monospace' }, tp);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 21 : 10;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  return svg('svg', { viewBox: '0 0 100 100', width: size, height: size, 'aria-hidden': 'true', class: 'seal' },
    svg('defs', {}, path),
    svg('circle', { cx: 50, cy: 50, r: 46, fill: 'none', stroke: color, 'stroke-width': 3 }),
    svg('circle', { cx: 50, cy: 50, r: 27, fill: 'none', stroke: color, 'stroke-width': 1.5 }),
    label,
    svg('polygon', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2 }),
    svg('circle', { cx: 50, cy: 50, r: 3, fill: color }));
}

export { svg };

/* ==========================================================================
   Звуки
   ========================================================================== */
let ctx = null;
function audio() {
  if (!local.sound) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(a, dur) {
  const b = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = b;
  return src;
}

function env(a, gainNode, t0, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

export const sfx = {
  get on() { return local.sound; },
  toggle() { local.sound = !local.sound; return local.sound; },

  stamp() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    const og = a.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    env(a, og, t, 0.7, 0.2);
    o.connect(og).connect(a.destination);
    o.start(t);
    o.stop(t + 0.22);
    const n = noise(a, 0.12);
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const ng = a.createGain();
    env(a, ng, t, 0.45, 0.1);
    n.connect(f).connect(ng).connect(a.destination);
    n.start(t);
  },

  bell() {
    const a = audio();
    if (!a) return;
    for (let k = 0; k < 3; k++) {
      const t = a.currentTime + k * 0.32;
      [[1, 0.22], [2.76, 0.1], [5.4, 0.05]].forEach(([mul, vol]) => {
        const o = a.createOscillator();
        const g = a.createGain();
        o.frequency.value = 680 * mul;
        env(a, g, t, vol, 1.1);
        o.connect(g).connect(a.destination);
        o.start(t);
        o.stop(t + 1.2);
      });
    }
  },

  paper() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const n = noise(a, 0.2);
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 0.6;
    const g = a.createGain();
    env(a, g, t, 0.12, 0.18);
    n.connect(f).connect(g).connect(a.destination);
    n.start(t);
  },

  call() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 1.2;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.09, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    f.connect(g).connect(a.destination);
    [196, 247].forEach((hz) => {
      const o = a.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.42);
    });
    try {
      if ('speechSynthesis' in window) {
        const voice = speechSynthesis.getVoices().find((v) => /^ru/i.test(v.lang));
        if (voice) {
          const u = new SpeechSynthesisUtterance('Следующий!');
          u.voice = voice;
          u.lang = voice.lang;
          u.rate = 0.95;
          u.pitch = 0.6;
          setTimeout(() => speechSynthesis.speak(u), 380);
        }
      }
    } catch { /* без голоса */ }
  },

  denied() {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    env(a, g, t, 0.12, 0.5);
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    o.connect(f).connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.5);
  },
};
