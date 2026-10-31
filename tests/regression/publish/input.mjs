import assert from 'node:assert/strict';
import { createInput } from '../../../src/client/input.js';

// Only the browser surface is adapted; all input behavior comes from the real module.
class Target {
  constructor() {
    this.listeners = new Map();
    this.children = [];
    this.style = { touchAction: 'pan-y' };
    this.dataset = {};
    this.captures = new Set();
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, data = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...data };
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
  }
  append(child) { child.parent = this; this.children.push(child); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
  setAttribute() {}
  setPointerCapture(id) {
    if (this.captureRefused) throw new Error('Capture refused by browser');
    this.captures.add(id);
  }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
}

function scenario(name, exercise, { captureRefused = false } = {}) {
  const saved = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new Target();
  const document = new Target();
  const canvas = new Target();
  const host = new Target();
  const media = Object.assign(new Target(), { matches: false });
  document.hidden = false;
  document.createElement = () => new Target();
  window.matchMedia = () => media;
  canvas.captureRefused = captureRefused;
  let input;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
    input = createInput({ canvas, host, isActive: () => true, unlock() {} });
    const mouse = { pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: 640, clientY: 200 };
    const press = () => {
      canvas.emit('pointerdown', mouse);
      assert.equal(input.consume().webHeld, true, `${name}: LMB must engage web before release`);
    };
    exercise({ window, document, canvas, input, mouse, press });
  } finally {
    // Restoration must still happen if either an assertion or destroy itself throws.
    try { input?.destroy(); }
    finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  }
  for (const [key, descriptor] of saved) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), descriptor, `${name}: restore ${key}`);
  }
  assert.equal(canvas.style.touchAction, 'pan-y', `${name}: restore touch-action`);
  assert.equal(canvas.captures.size, 0, `${name}: release captures`);
  assert.equal(host.children.length, 0, `${name}: remove touch controls`);
  for (const target of [window, document, canvas, media]) {
    for (const handlers of target.listeners.values()) assert.equal(handlers.size, 0, `${name}: remove listeners`);
  }
}

scenario('window pointerup outside canvas', ({ window, input, mouse, press }) => {
  press();
  window.emit('pointerup', { ...mouse, button: 0, buttons: 0, clientX: -200, clientY: -200 });
  assert.equal(input.consume().webHeld, false, 'LMB pointerup outside canvas must drop web');
});

scenario('outside release observed on re-entry', ({ window, input, mouse, press }) => {
  press();
  // No pointerup or lostpointercapture was delivered while outside the window.
  window.emit('pointermove', { ...mouse, button: -1, buttons: 0 });
  assert.equal(input.consume().webHeld, false, 'buttons=0 on re-entry must drop stale web');
}, { captureRefused: true });

scenario('fallback mouseup without pointerup', ({ window, input, press }) => {
  press();
  window.emit('mouseup', { button: 0, buttons: 0 });
  assert.equal(input.consume().webHeld, false, 'legacy mouseup must drop web even when capture failed');
}, { captureRefused: true });

scenario('RMB release in LMB chord', ({ window, canvas, input, mouse, press }) => {
  press();
  window.emit('pointermove', { ...mouse, button: 2, buttons: 3 });
  window.emit('pointerup', { ...mouse, button: 2, buttons: 1 });
  assert.equal(input.consume().webHeld, true, 'secondary pointerup must not drop held LMB web');
  window.emit('mouseup', { button: 2, buttons: 1 });
  assert.equal(input.consume().webHeld, true, 'secondary mouseup must not drop held LMB web');
  window.emit('pointermove', { ...mouse, button: 2, buttons: 3 });
  // LMB can be released while RMB is still down: browsers may only emit pointermove.
  window.emit('pointermove', { ...mouse, button: 0, buttons: 2 });
  assert.equal(input.consume().webHeld, false, 'LMB release must drop web even with RMB held');
  canvas.emit('pointerdown', mouse);
  assert.equal(input.consume().webHeld, true);
  window.emit('mouseup', { button: 0, buttons: 2 });
  assert.equal(input.consume().webHeld, false, 'LMB fallback mouseup with RMB held must drop web');
});

scenario('RMB-first chord', ({ window, canvas, input, mouse }) => {
  canvas.emit('pointerdown', { ...mouse, button: 2, buttons: 2 });
  assert.equal(input.consume().webHeld, false, 'RMB alone must not engage web');
  window.emit('pointermove', { ...mouse, target: canvas, button: 0, buttons: 3 });
  assert.equal(input.consume().webHeld, true, 'LMB pressed second must engage real chord fallback');
  window.emit('mouseup', { button: 2, buttons: 1 });
  assert.equal(input.consume().webHeld, true, 'RMB release in RMB-first chord must preserve web');
  window.emit('mouseup', { button: 0, buttons: 0 });
  assert.equal(input.consume().webHeld, false);
});

for (const type of ['blur', 'pagehide', 'visibilitychange', 'pointercancel', 'lostpointercapture']) {
  scenario(type, ({ window, document, canvas, input, mouse, press }) => {
    press();
    if (type === 'visibilitychange') {
      document.hidden = true;
      document.emit(type);
    } else if (type === 'lostpointercapture') canvas.emit(type, mouse);
    else window.emit(type, mouse);
    assert.equal(input.consume().webHeld, false, `${type} must drop web`);
  });
}

scenario('mouse fallback preserves touch', ({ window, canvas, input, mouse }) => {
  canvas.emit('pointerdown', { ...mouse, pointerType: 'touch', pointerId: 22, clientX: 900 });
  assert.equal(input.consume().webHeld, true);
  window.emit('mouseup', { button: 0, buttons: 0 });
  assert.equal(input.consume().webHeld, true, 'mouse fallback must not release touch web');
  window.emit('pointerup', { pointerType: 'touch', pointerId: 22 });
  assert.equal(input.consume().webHeld, false);
});

console.log('REGRESSION OK: publish/input');
