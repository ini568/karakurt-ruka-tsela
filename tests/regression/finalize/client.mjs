// Node DOM adapter regression for client flow and input: release on pointerup, pause, reset on restart.
import assert from 'node:assert/strict';
import { mountGame } from '../../../src/client/app.js';
import { createInput } from '../../../src/client/input.js';

// Realistic headless Target for client and input harness
class Target {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.listeners = new Map();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.captures = new Set();
    this.hidden = false;
    this.textContent = '';
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type, data = {}) {
    const event = { target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
  }
  append(...nodes) {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this);
    this.parentElement = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  descendants() { return this.children.flatMap(n => [n, ...n.descendants()]); }
  querySelectorAll(selector) {
    return this.descendants().filter(n => selector === '[data-mute]' && 'mute' in n.dataset);
  }
}

function environment({ blocked = false, storage = null } = {}) {
  const saved = new Map(['window', 'document', 'AudioContext', 'webkitAudioContext'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const window = new Target('window');
  const document = new Target('document');
  document.hidden = false;
  document.createElement = tag => new Target(tag);
  window.matchMedia = () => Object.assign(new Target('media'), { matches: false });
  window.getComputedStyle = () => ({ position: 'static' });
  let id = 0;
  let val = storage;
  let attempts = 0;
  const frames = new Map();
  const writes = [];
  window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  window.cancelAnimationFrame = key => frames.delete(key);
  window.localStorage = {
    getItem() { if (blocked === 'read' || blocked === true) throw new Error('denied read'); return val; },
    setItem(key, text) {
      attempts++;
      if (blocked === 'write' || blocked === true) throw new Error('denied write');
      val = text;
      writes.push({ key, text });
    },
  };
  const host = new Target('div');
  const canvas = new Target('canvas');
  const overlay = new Target('div');
  const hud = new Target('div');
  const gradient = { addColorStop() {} };
  const methods = new Set('save restore translate rotate scale setTransform clearRect fillRect strokeRect beginPath closePath rect clip moveTo lineTo arc arcTo ellipse bezierCurveTo quadraticCurveTo fill stroke fillText strokeText setLineDash'.split(' '));
  const ctx = new Proxy({}, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (methods.has(key)) return () => {};
      throw new Error(`Unsupported Canvas method ${String(key)}`);
    }
  });
  canvas.getContext = () => ctx;
  host.append(canvas, overlay, hud);
  globalThis.window = window;
  globalThis.document = document;
  globalThis.AudioContext = class { constructor() { throw new Error('audio device disabled in test'); } };
  delete globalThis.webkitAudioContext;

  return {
    window, document, host, canvas, overlay, hud, frames, writes,
    get attempts() { return attempts; },
    tick(now) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const fn of callbacks) fn(now);
    },
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

// 1. Check direct input behavior: releasing LMB drops web, outside pointerup / blur / mouseup drops web
{
  const env = environment();
  let input;
  try {
    input = createInput({ ...env, isActive: () => true, unlock() {} });
    // Press LMB on canvas
    env.canvas.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 });
    let sample = input.consume();
    assert.equal(sample.webHeld, true, 'LMB down must engage web');

    // Pointerup on window releases web
    env.window.emit('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: 640, clientY: 200 });
    sample = input.consume();
    assert.equal(sample.webHeld, false, 'releasing LMB (pointerup) must drop web');

    // Press LMB again, release via window mouseup (simulating release outside window where pointerup was lost)
    env.canvas.emit('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 });
    sample = input.consume();
    assert.equal(sample.webHeld, true, 'LMB down again must engage web');
    env.window.emit('mouseup', { button: 0, buttons: 0 });
    sample = input.consume();
    assert.equal(sample.webHeld, false, 'mouseup on window must drop web');

    // Press LMB again, release via blur
    env.canvas.emit('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 });
    sample = input.consume();
    assert.equal(sample.webHeld, true, 'LMB down before blur');
    env.window.emit('blur');
    sample = input.consume();
    assert.equal(sample.webHeld, false, 'blur must drop web and clear pointers');

    // Press LMB again, release via pagehide
    env.canvas.emit('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 });
    sample = input.consume();
    assert.equal(sample.webHeld, true, 'LMB down before pagehide');
    env.window.emit('pagehide');
    sample = input.consume();
    assert.equal(sample.webHeld, false, 'pagehide must drop web');

    // Pointermove without buttons (e.g. mouse button was released while cursor was outside)
    env.canvas.emit('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 });
    sample = input.consume();
    assert.equal(sample.webHeld, true, 'LMB down before pointermove buttons=0');
    env.window.emit('pointermove', { pointerId: 5, pointerType: 'mouse', buttons: 0, clientX: 500, clientY: 100 });
    sample = input.consume();
    assert.equal(sample.webHeld, false, 'pointermove with buttons=0 must drop web');
  } finally {
    input?.destroy();
    env.restore();
  }
}

// 2. Client application tests: pause freezes timer and score, new party resets state
{
  const env = environment();
  let app;
  try {
    app = mountGame(env);
    const clickPrimary = () => {
      const btn = env.overlay.descendants().find(n => n.tagName === 'BUTTON');
      assert.ok(btn, 'panel must have a button');
      btn.emit('click');
    };
    const getHud = () => Object.fromEntries(
      env.hud.children.filter(n => n.dataset.hud).map(n => [n.dataset.hud, n.textContent])
    );

    // Initial state: start panel is visible
    assert.equal(env.overlay.hidden, false, 'start overlay must be visible initially');
    let now = 100;
    clickPrimary(); // Start game
    env.tick(now);
    assert.equal(env.overlay.hidden, true, 'overlay hidden after start');

    // Advance 60 frames (1 second)
    for (let i = 0; i < 60; i++) env.tick(now += 1000 / 60);
    const runningHud = getHud();
    assert.ok(runningHud.time, 'HUD must display time');
    assert.ok(runningHud.score, 'HUD must display score');

    // Pause via Escape
    env.window.emit('keydown', { code: 'Escape', repeat: false });
    assert.equal(env.overlay.hidden, false, 'overlay visible when paused via Escape');

    const pausedHud = getHud();
    // Simulate 200 ticks while paused; timer and score must remain completely frozen
    for (let i = 0; i < 200; i++) env.tick(now += 1000);
    assert.deepEqual(getHud(), pausedHud, 'pause must freeze timer and score');

    // Resume via primary button
    clickPrimary();
    assert.equal(env.overlay.hidden, true, 'overlay hidden after resuming');
    // First frame after resume must not accumulate the paused interval
    env.tick(now += 60000);
    assert.deepEqual(getHud(), pausedHud, 'first frame after pause must not catch up skipped time');

    // Pause via blur
    env.window.emit('blur');
    assert.equal(env.overlay.hidden, false, 'blur must pause the game');
    const blurPausedHud = getHud();
    for (let i = 0; i < 50; i++) env.tick(now += 2000);
    assert.deepEqual(getHud(), blurPausedHud, 'blur pause must freeze timer and score');

    // Resume again
    clickPrimary();
    assert.equal(env.overlay.hidden, true);

    // Run until game ends (either lost or won)
    let frames = 0;
    while (env.overlay.hidden && frames++ < 12000) {
      env.tick(now += 1000 / 60);
    }
    assert.equal(env.overlay.hidden, false, 'game must finish within 180s');

    // Start a new party via restart button
    clickPrimary();
    assert.equal(env.overlay.hidden, true, 'overlay hidden after restarting');
    env.tick(now += 1000 / 60);

    const restartedHud = getHud();
    // Verify restarted state: 3 hp, 3:00 (180 s), score 0
    assert.ok(restartedHud.hp.includes('3/3'), `restarted game must have 3 HP, got: ${restartedHud.hp}`);
    assert.ok(restartedHud.time.includes('3:00'), `restarted game must have 3:00 remaining, got: ${restartedHud.time}`);
    assert.ok(restartedHud.score.includes(' 0'), `restarted game must have 0 score, got: ${restartedHud.score}`);
  } finally {
    app?.destroy();
    env.restore();
  }
}

// 3. Fallback and negative mutation check:
// Verify that if createInput does NOT release web on pointerup, assertion fails.
{
  function faultyCreateInput({ canvas, window }) {
    let webHeld = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) webHeld = true;
    });
    // Deliberate defect: pointerup does NOT clear webHeld
    window.addEventListener('pointerup', () => {
      /* bug: does not release */
    });
    return {
      consume() { return { webHeld }; },
      destroy() {}
    };
  }

  const env = environment();
  const input = faultyCreateInput(env);
  env.canvas.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
  assert.equal(input.consume().webHeld, true);
  env.window.emit('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });

  let caught = false;
  try {
    assert.equal(input.consume().webHeld, false, 'defect check: faulty input must fail assertion');
  } catch (err) {
    if (err instanceof assert.AssertionError) {
      caught = true;
    } else {
      throw err;
    }
  }
  assert.equal(caught, true, 'releasing pointerup when not dropping web must throw AssertionError');
  env.restore();
}

console.log('REGRESSION OK: finalize/client');
