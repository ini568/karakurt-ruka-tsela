// Node DOM/RAF adapter only: real client, input, model and renderer; NOT browser acceptance.
import assert from 'node:assert/strict';
import { mountGame } from '../../../src/client/app.js';
import { createInput } from '../../../src/client/input.js';

class Target {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.listeners = new Map(); this.children = [];
    this.style = {}; this.dataset = {}; this.attributes = new Map(); this.captures = new Set();
    this.hidden = false; this.textContent = '';
  }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...data };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  getBoundingClientRect() { return { left: 20, top: 30, width: 640, height: 500 }; }
  descendants() { return this.children.flatMap(n => [n, ...n.descendants()]); }
  querySelectorAll(selector) { assert.equal(selector, '[data-mute]', 'adapter only supports the existing client selector'); return this.descendants().filter(n => 'mute' in n.dataset); }
}
function environment(blocked) {
  const saved = new Map(['window', 'document', 'AudioContext', 'webkitAudioContext'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const window = new Target(), document = new Target();
  document.hidden = false; document.createElement = tag => new Target(tag);
  window.matchMedia = () => Object.assign(new Target(), { matches: false });
  window.getComputedStyle = () => ({ position: 'static' });
  let id = 0, value = null, attempts = 0, draws = 0;
  const frames = new Map(), writes = [];
  window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  window.cancelAnimationFrame = key => frames.delete(key);
  window.localStorage = {
    getItem() { if (blocked === 'read') throw Error('denied read'); return value; },
    setItem(key, text) { attempts++; if (blocked) throw Error('denied write'); value = text; writes.push({ key, text }); },
  };
  const host = new Target(), canvas = new Target('canvas'), overlay = new Target(), hud = new Target();
  const gradient = { addColorStop() {} };
  const methods = new Set('save restore translate rotate scale setTransform clearRect fillRect strokeRect beginPath closePath rect clip moveTo lineTo arc arcTo ellipse bezierCurveTo quadraticCurveTo fill stroke fillText strokeText setLineDash'.split(' '));
  const ctx = new Proxy({}, { get(t, key) {
    if (key in t) return t[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 8 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
    if (methods.has(key)) return () => { if (key === 'fillRect') draws++; };
    throw Error(`Unsupported Canvas method ${String(key)}`);
  } });
  canvas.getContext = () => ctx; host.append(canvas, overlay, hud);
  globalThis.window = window; globalThis.document = document;
  globalThis.AudioContext = class { constructor() { throw Error('audio device blocked'); } };
  delete globalThis.webkitAudioContext;
  return { window, document, host, canvas, overlay, hud, frames, writes,
    get attempts() { return attempts; }, get draws() { return draws; },
    tick(now) { const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn(now); },
    restore() { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

// Check input independently: capture release, fresh-key requirement and letterboxing.
{
  const env = environment(false); let input;
  try {
    input = createInput({ ...env, isActive: () => true, unlock() {} });
    env.window.emit('keydown', { code: 'KeyD', repeat: false });
    env.window.emit('keydown', { code: 'ShiftLeft', repeat: false });
    env.canvas.emit('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 0, buttons: 1, clientX: 340, clientY: 280 });
    let sample = input.consume();
    assert.equal(sample.moveX, 1); assert.equal(sample.webHeld, true); assert.equal(sample.dashPressed, true);
    assert.equal(sample.aimX, 640); assert.equal(sample.aimY, 360, 'letterbox offset is removed');
    assert.equal(input.consume().dashPressed, false, 'dash is one-shot');
    for (const event of ['blur', 'pagehide', 'visibilitychange']) {
      env.window.emit('keydown', { code: 'Space', repeat: false });
      env.window.emit('keydown', { code: 'ShiftLeft', repeat: false });
      env.canvas.emit('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 0, buttons: 1, clientX: 340, clientY: 280 });
      if (event === 'visibilitychange') { env.document.hidden = true; env.document.emit(event); }
      else env.window.emit(event);
      sample = input.consume();
      assert.deepEqual([sample.moveX, sample.moveY, sample.webHeld, sample.dashPressed], [0, 0, false, false], `${event} clears all actions`);
      assert.equal(env.canvas.captures.size, 0, `${event} releases capture`);
      env.window.emit('keydown', { code: 'KeyD', repeat: true });
      assert.equal(input.consume().moveX, 0, 'OS repeat must not revive cleared movement');
      env.document.hidden = false;
    }
    env.canvas.getBoundingClientRect = () => ({ left: 10, top: 10, width: 1280, height: 720 });
    env.window.emit('pointermove', { pointerId: 5, pointerType: 'mouse', buttons: 0, clientX: 110, clientY: 210 });
    sample = input.consume(); assert.equal(sample.aimX, 100); assert.equal(sample.aimY, 200, 'coordinates recomputed after resize');
    env.canvas.getBoundingClientRect = () => ({ left: 10, top: 10, width: 640, height: 360 });
    sample = input.consume();
    assert.equal(sample.aimX, 200); assert.equal(sample.aimY, 400, 'resize without pointermove recomputes aim from last client coordinates');
  } finally { input?.destroy(); env.restore(); }
}

for (const blocked of [false, 'read', 'write']) {
  const env = environment(blocked); let app;
  try {
    app = mountGame(env);
    const primary = () => { const node = env.overlay.descendants().find(n => n.tagName === 'BUTTON'); assert.ok(node, 'panel exposes an action'); node.emit('click'); };
    const hud = () => Object.fromEntries(env.hud.children.filter(n => n.dataset.hud).map(n => [n.dataset.hud, n.textContent]));
    let now = 0; primary(); env.tick(now);
    for (let i = 0; i < 58; i++) env.tick(now += 1000 / 60);
    const running = hud();
    for (const pause of ['escape', 'blur', 'visibility']) {
      if (pause === 'escape') env.window.emit('keydown', { code: 'Escape', repeat: false });
      if (pause === 'blur') env.window.emit('blur');
      if (pause === 'visibility') { env.document.hidden = true; env.document.emit('visibilitychange'); }
      assert.equal(env.overlay.hidden, false, `${pause} pauses`);
      const before = hud();
      for (let i = 0; i < 120; i++) env.tick(now += 2000);
      assert.deepEqual(hud(), before, `${pause}: timer, score and health frozen during pause`);
      env.document.hidden = false; primary(); env.tick(now += 60000);
      assert.deepEqual(hud(), before, `${pause}: first resumed frame must not catch up`);
      // Repeated pause/resume with no elapsed simulation must not accumulate small capped jumps.
      for (let i = 0; i < 25; i++) {
        env.window.emit('blur'); primary(); env.tick(now += 60000);
      }
      assert.deepEqual(hud(), before, `${pause}: repeated resume cannot accrue simulation time`);
    }
    assert.deepEqual(hud(), running);
    for (let i = 0; i < 90; i++) env.tick(now += 20);
    assert.notEqual(hud().time, running.time, 'timer actually runs after resume');
    let count = 0;
    while (env.overlay.hidden && count++ < 12000) env.tick(now += 20);
    assert.equal(env.overlay.hidden, false, 'real model reaches terminal state within bounded frames');
    assert.equal(env.attempts, 1, `one save attempt even when ${blocked || 'available'}`);
    if (!blocked) {
      assert.equal(env.writes[0].key, 'karakurt.progress.v1');
      const saved = JSON.parse(env.writes[0].text);
      assert.deepEqual(Object.keys(saved).sort(), ['bestScore', 'bestSurvival', 'version', 'wins']);
      assert.equal(saved.version, 1); assert.ok(saved.bestSurvival > 0 && saved.bestSurvival <= 180);
    }
    for (let i = 0; i < 100; i++) env.tick(now += 1000);
    env.window.emit('blur'); env.document.hidden = true; env.document.emit('visibilitychange'); env.document.hidden = false;
    assert.equal(env.attempts, 1, 'terminal frames/blur/visibility must not save again');
    primary(); assert.equal(env.overlay.hidden, true, 'restart remains usable after denied audio/storage');
    assert.equal(env.frames.size, 1, 'one RAF chain after restart');
    assert.equal(env.attempts, 1, 'restart does not persist unfinished party');
    assert.ok(env.draws > 0, 'real renderer was called, not skipped with a zero-size Canvas');
    app.destroy(); app.destroy(); assert.equal(env.frames.size, 0, 'destroy cancels RAF');
  } finally { app?.destroy(); env.restore(); }
}
console.log('REGRESSION OK: final/client (Node adapter; not browser acceptance)');
