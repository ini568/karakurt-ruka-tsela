// Canvas command assertions, not a browser or pixel/visual acceptance test.
import assert from 'node:assert/strict';
import { renderGame } from '../../../src/art/renderer.js';
import { createAudio } from '../../../src/art/audio.js';
import { PALETTE } from '../../../src/art/palette.js';

function recorder() {
  const calls = [], stack = [];
  const fields = { fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  const methods = new Set(['beginPath', 'closePath', 'ellipse', 'arc', 'arcTo', 'rect', 'clip', 'moveTo', 'lineTo',
    'bezierCurveTo', 'fill', 'stroke', 'fillRect', 'strokeRect', 'translate', 'scale', 'rotate', 'setLineDash', 'fillText', 'strokeText']);
  const ctx = new Proxy(fields, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'save') return () => stack.push({ ...fields });
    if (key === 'restore') return () => { assert.ok(stack.length, 'balanced Canvas restore'); Object.assign(fields, stack.pop()); };
    if (key === 'measureText') return text => ({ width: String(text).length * 8 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    assert.ok(methods.has(key), `unsupported Canvas method ${String(key)}: extend adapter explicitly`);
    return (...args) => {
      for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key}: finite geometry`);
      calls.push({ method: key, args, fill: fields.fillStyle, stroke: fields.strokeStyle, alpha: fields.globalAlpha });
    };
  } });
  return { ctx, calls, stack };
}
function state() {
  return { time: 0, duration: 180, status: 'playing', score: 0, wave: 0,
    player: { x: 640, y: 440, vx: 0, vy: 0, radius: 17, hp: 3, silk: 100, invulnerable: 0 },
    anchors: [{ id: 'a0', x: 105, y: 95 }], web: null, flies: [], hazards: [], particles: [], events: [], stats: { flies: 0, dodges: 0 } };
}
function draw(s, options = {}) {
  const before = structuredClone(s), r = recorder();
  renderGame(r.ctx, s, { reducedMotion: true, ...options });
  assert.deepEqual(s, before, 'renderer must not mutate model');
  assert.equal(r.stack.length, 0, 'balanced Canvas save/restore');
  assert.ok(r.calls.length > 0, 'real renderer submits drawing commands');
  return r.calls;
}
for (const kind of ['slap', 'glass', 'sweep']) {
  const s = state();
  const h = { id: kind, kind, phase: 'warning', x: 220, y: 180, w: 200, h: 180, remaining: 0.8 };
  s.hazards = [h];
  const warning = draw(s);
  h.phase = 'active';
  const active = draw(s);
  assert.notDeepEqual(active, warning, `${kind}: warning and active issue different commands`);
  assert.ok(warning.some(c => c.stroke === PALETTE.warning && ['stroke', 'strokeRect'].includes(c.method)), `${kind}: warning outline`);
  assert.ok(active.some(c => c.stroke === PALETTE.danger && ['stroke', 'strokeRect'].includes(c.method)), `${kind}: active danger outline`);
  if (kind === 'glass') {
    const bar = commands => commands.filter(c => c.method === 'fillRect' && c.fill === PALETTE.danger && c.args[3] === 8);
    const full = bar(active);
    h.remaining = 0.2;
    const drained = bar(draw(s));
    assert.equal(full.length, 1, 'active glass has one remaining-time bar');
    assert.equal(drained.length, 1);
    assert.ok(full[0].args[2] > drained[0].args[2] && drained[0].args[2] > 0, 'glass bar drains from remaining seconds, without advancing renderer time');
  }
}
// Feedback assertions use drawing operations, not overlay copy. Unchanged counters must not retrigger expired feedback.
for (const change of ['dodge', 'fly', 'hurt']) {
  const s = state(); draw(s);
  s.time = 0.1;
  if (change === 'dodge') s.stats.dodges++;
  if (change === 'fly') s.stats.flies++;
  if (change === 'hurt') s.player.hp--;
  const feedback = draw(s).filter(c => c.method === 'strokeText');
  assert.equal(feedback.length, 1, `${change}: one new feedback item from the public counter`);
  assert.equal(draw(s).filter(c => c.method === 'strokeText').length, 1, `${change}: same frame does not duplicate feedback`);
  s.time = 2;
  assert.equal(draw(s).filter(c => c.method === 'strokeText').length, 0, `${change}: unchanged state does not regenerate expired feedback`);
}
const aimed = state();
assert.notDeepEqual(draw(aimed), draw(aimed, { aim: { x: 105, y: 95 } }), 'anchor targeting affects real draw commands');
for (const reducedMotion of [false, true]) draw(state(), { width: 375, height: 500, reducedMotion });

const keys = ['AudioContext', 'webkitAudioContext'];
const originals = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
try {
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: undefined });
  const absent = createAudio();
  assert.equal(await absent.unlock(), false, 'missing Web Audio is optional');
  for (const type of ['warning', 'hurt', 'catch', 'win', 'unknown']) absent.play(type);
  absent.dispose();
  let created = 0;
  globalThis.AudioContext = class { constructor() { created++; throw new Error('audio denied'); } };
  const denied = createAudio();
  denied.setMuted(true);
  assert.equal(await denied.unlock(), false);
  assert.equal(created, 0, 'muted unlock must not create a device');
  denied.setMuted(false);
  assert.equal(await denied.unlock(), false, 'constructor failure is contained');
  assert.equal(created, 1, 'failure path really attempted the constructor');
  denied.play('warning'); denied.dispose(); denied.dispose();
  const nodes = [];
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.destination = {}; }
    createGain() { const node = { gain: {}, connect() {}, disconnect() {} }; nodes.push(node); return node; }
    resume() { return Promise.reject(new Error('gesture policy denied')); }
    close() { return Promise.resolve(); }
  };
  const rejected = createAudio();
  assert.equal(await rejected.unlock(), false, 'asynchronous resume rejection is contained');
  assert.equal(nodes.length, 1, 'resume rejection exercised real graph setup');
  rejected.play('warning'); rejected.dispose();
  draw(state()); // Audio failures cannot prevent invoking the independent real renderer.
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
console.log('REGRESSION OK: final/art (Canvas commands and audio failure paths; not browser acceptance)');
