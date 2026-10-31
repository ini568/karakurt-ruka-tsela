// Own check of client texts and handlers: start screen, final screen, Enter restart, pause on blur/tab switch.
import assert from 'node:assert/strict';
import { mountGame } from '../../src/client/app.js';

class Target {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.listeners = new Map();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.textContent = '';
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data = {}) {
    const event = { target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  descendants() { return this.children.flatMap((n) => [n, ...n.descendants()]); }
  querySelectorAll(sel) { return this.descendants().filter((n) => sel === '[data-mute]' && 'mute' in n.dataset); }
}

const saved = new Map(['window', 'document', 'AudioContext', 'webkitAudioContext'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
const window = new Target('window');
const document = new Target('document');
document.hidden = false;
document.createElement = (tag) => new Target(tag);
window.matchMedia = () => Object.assign(new Target('media'), { matches: false });
window.getComputedStyle = () => ({ position: 'static' });
const frames = new Map();
let fid = 0;
window.requestAnimationFrame = (fn) => { frames.set(++fid, fn); return fid; };
window.cancelAnimationFrame = (k) => frames.delete(k);
let stored = null;
window.localStorage = { getItem: () => stored, setItem: (_k, v) => { stored = v; } };
const host = new Target(); const canvas = new Target('canvas'); const overlay = new Target(); const hud = new Target();
const grad = { addColorStop() {} };
const noop = new Set('save restore translate rotate scale setTransform clearRect fillRect strokeRect beginPath closePath rect clip moveTo lineTo arc arcTo ellipse bezierCurveTo quadraticCurveTo fill stroke fillText strokeText setLineDash'.split(' '));
canvas.getContext = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if (noop.has(k)) return () => {};
    return undefined;
  },
  set(t, k, v) { t[k] = v; return true; },
});
host.append(canvas, overlay, hud);
globalThis.window = window;
globalThis.document = document;
globalThis.AudioContext = class { constructor() { throw new Error('no audio in test'); } };
delete globalThis.webkitAudioContext;

const panelText = () => overlay.descendants().filter((n) => n.tagName === 'P' || n.tagName === 'H1').map((n) => n.textContent).join('\n');
const hudNow = () => Object.fromEntries(hud.children.filter((n) => n.dataset.hud).map((n) => [n.dataset.hud, n.textContent]));
let now = 100;
const tick = (dt = 1000 / 60) => { const cbs = [...frames.values()]; frames.clear(); now += dt; for (const fn of cbs) fn(now); };

let app;
try {
  app = mountGame({ canvas, overlay, hud });

  // 1. Start screen before any input.
  assert.equal(overlay.hidden, false, 'start panel visible');
  const start = panelText();
  for (const needle of ['3:00', 'ЛКМ', 'паутина', 'рывок', 'Shift', 'Escape', 'Enter']) {
    assert.ok(start.toLowerCase().includes(needle.toLowerCase()), `start screen mentions "${needle}"`);
  }

  // 2. Enter starts the party; a second Enter during play does nothing.
  const enter = window.emit('keydown', { code: 'Enter', repeat: false });
  assert.equal(enter.defaultPrevented, true, 'Enter on the start panel is consumed');
  assert.equal(overlay.hidden, true, 'Enter starts the party');
  tick();
  window.emit('keyup', { code: 'Enter' });

  // 3. Tab switch pauses and freezes the timer.
  for (let i = 0; i < 120; i++) tick();
  const before = hudNow();
  document.hidden = true;
  document.emit('visibilitychange');
  assert.equal(overlay.hidden, false, 'hidden tab pauses');
  assert.ok(panelText().includes('Пауза'), 'pause panel shown');
  for (let i = 0; i < 300; i++) tick(1000);
  assert.deepEqual(hudNow(), before, 'timer and score frozen while hidden');
  document.hidden = false;
  window.emit('keyup', { code: 'Escape' });
  window.emit('keydown', { code: 'Escape', repeat: false });
  assert.equal(overlay.hidden, true, 'Escape resumes');
  window.emit('blur');
  assert.equal(overlay.hidden, false, 'blur pauses');
  window.emit('keydown', { code: 'Enter', repeat: false });
  assert.equal(overlay.hidden, false, 'Enter does not resume/restart from pause');
  window.emit('keyup', { code: 'Enter' });
  window.emit('keydown', { code: 'Escape', repeat: false });
  assert.equal(overlay.hidden, true, 'Escape resumes after blur pause');

  // 4. A passive spider loses; the final screen shows score, dodges and the restart action.
  let guard = 0;
  while (overlay.hidden && guard++ < 20000) tick();
  assert.equal(overlay.hidden, false, 'party ends');
  const end = panelText();
  assert.ok(end.includes('Паук попался'), 'loss title');
  assert.match(end, /Счёт: \d+/, 'score on loss screen');
  assert.match(end, /Уклонения: \d+/, 'dodges on loss screen');
  assert.ok(end.includes('Enter'), 'restart key named on loss screen');
  const button = overlay.descendants().find((n) => n.tagName === 'BUTTON');
  assert.equal(button.textContent, 'Новая партия');

  // 5. One action (Enter) restarts with 3/3, 3:00, score 0.
  window.emit('keydown', { code: 'Enter', repeat: false });
  assert.equal(overlay.hidden, true, 'Enter restarts');
  tick();
  const fresh = hudNow();
  assert.ok(fresh.hp.includes('3/3'), fresh.hp);
  assert.ok(fresh.time.includes('3:00'), fresh.time);
  assert.ok(fresh.score.endsWith(' 0'), fresh.score);
  console.log('FLOW OK');
} finally {
  app?.destroy();
  for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
}
