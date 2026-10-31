// Standalone client-input smoke check; no browser or game model is mocked as tested behavior.
import assert from 'node:assert/strict';
import { createInput } from '../src/client/input.js';

class Target {
  constructor() { this.listeners = new Map(); this.style = {}; this.children = []; this.dataset = {}; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, event = {}) {
    event.preventDefault ??= () => {};
    event.currentTarget ??= this;
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
  append(child) { this.children.push(child); }
  setAttribute() {}
  remove() { this.removed = true; }
  setPointerCapture() {}
}
const windowStub = new Target();
const media = new Target();
media.matches = true;
windowStub.matchMedia = () => media;
globalThis.window = windowStub;
globalThis.document = { createElement: () => new Target() };
const canvas = new Target();
canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 1000 });
const host = new Target();
let active = true;
const input = createInput({ canvas, host, isActive: () => active, unlock() {} });
canvas.emit('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 510, clientY: 520 });
let sample = input.consume();
assert.equal(sample.aimX, 640);
assert.equal(sample.aimY, 360);
assert.equal(sample.webHeld, true);
windowStub.emit('pointerup', { pointerType: 'mouse', pointerId: 1 });
assert.equal(input.consume().webHeld, false);
windowStub.emit('keydown', { code: 'ShiftLeft', repeat: false });
assert.equal(input.consume().dashPressed, true);
assert.equal(input.consume().dashPressed, false);
windowStub.emit('keydown', { code: 'KeyW' });
assert.equal(input.consume().moveY, -1);
input.reset();
assert.equal(input.consume().moveY, 0);
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 600 });
windowStub.emit('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 148, clientY: 552 });
sample = input.consume();
assert.equal(sample.moveX, 1);
assert.equal(sample.moveY, -1);
canvas.emit('pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 1010, clientY: 20 });
sample = input.consume();
assert.equal(sample.webHeld, true);
assert.equal(sample.aimX, 1280);
assert.equal(sample.aimY, 0);
input.reset();
const controls = host.children[0];
controls.children[2].emit('pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 500, clientY: 950 });
assert.equal(input.consume().dashPressed, true);
active = false;
input.setVisible();
assert.equal(controls.hidden, true);
input.destroy();
assert.equal(controls.removed, true);
assert.equal([...windowStub.listeners.values()].every((set) => set.size === 0), true);
console.log('CLIENT INPUT OK: letterbox, mouse, keyboard, touch, dash impulse, reset, cleanup');
