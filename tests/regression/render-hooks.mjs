// Render and audio hooks used by the client: renderGame aim option and audio.play('warning').
// Run standalone: node tests/regression/render-hooks.mjs
import assert from 'node:assert/strict';
import { renderGame } from '../../src/art/renderer.js';
import { createAudio } from '../../src/art/audio.js';

const passed = [];

/** Canvas 2D stub: every method is a recorded no-op, properties are plain assignable fields. */
function stubContext() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const special = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    measureText: text => ({ width: String(text).length * 8 }),
    getLineDash: () => [],
  };
  const fields = { canvas: { width: 1280, height: 720 } };
  const ctx = new Proxy(fields, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      return (...args) => { calls.push(key); return special[key]?.(...args); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { ctx, calls };
}

/**
 * A state in the public model format (see createGame in src/game/model.js) with every hazard
 * kind in every phase. Built by hand so the render hooks are checked even when the model
 * module cannot be loaded.
 */
function busyState(seed) {
  const anchors = [[105, 95], [360, 105], [640, 75], [920, 105], [1175, 95], [90, 370], [1190, 370], [330, 625], [950, 625]]
    .map(([x, y], i) => ({ id: `a${i}`, x, y }));
  const hazards = [];
  let id = 0;
  for (const phase of ['warning', 'active', 'fade']) {
    hazards.push({ id: `h${id++}`, kind: 'slap', phase, x: 120, y: 200, w: 200, h: 200, remaining: 0.4 });
    hazards.push({ id: `h${id++}`, kind: 'glass', phase, x: 520, y: 300, w: 220, h: 198, remaining: 0.9 });
    hazards.push({ id: `h${id++}`, kind: 'sweep', phase, x: 0, y: 500, w: 1280, h: 140, remaining: 0.3 });
  }
  return {
    version: 1, seed, rng: seed, time: 42.5, duration: 180, status: 'playing', score: 315, wave: 3,
    player: { x: 640, y: 440, vx: 120, vy: -60, radius: 17, hp: 2, silk: 64, invulnerable: 0.6 },
    web: null, anchors, hazards,
    flies: [{ id: 'f1', x: 300, y: 320, radius: 9 }, { id: 'f2', x: 1000, y: 200, radius: 9 }],
    particles: [{ kind: 'hit', x: 640, y: 440, vx: 10, vy: 5, life: 0.3 }, { kind: 'fly', x: 300, y: 320, vx: 0, vy: 0, life: 0.2 }],
    events: [], stats: { flies: 4, dodges: 6 },
  };
}

// 1. renderGame with aim = null, aim = {x, y} near/far from anchors, reduced motion and default options.
for (const seed of [1, 47]) {
  const state = busyState(seed);
  const anchor = state.anchors[0];
  const variants = [
    ['aim = null', { aim: null }],
    ['aim у якоря', { aim: { x: anchor.x + 10, y: anchor.y + 10 } }],
    ['aim вдали от якорей', { aim: { x: 640, y: 360 } }],
    ['aim = null, reducedMotion', { aim: null, reducedMotion: true }],
    ['aim у якоря, reducedMotion', { aim: { x: anchor.x, y: anchor.y }, reducedMotion: true }],
    ['aim у якоря, 1920×1080', { aim: { x: anchor.x, y: anchor.y }, width: 1920, height: 1080 }],
    ['без опций', undefined],
  ];
  for (const [label, options] of variants) {
    for (const web of [null, { anchorX: anchor.x, anchorY: anchor.y, length: 200 }]) {
      const frame = structuredClone(state);
      frame.web = web;
      const snapshot = structuredClone(frame);
      const { ctx, calls } = stubContext();
      const where = `${label}, нить ${web ? 'есть' : 'нет'}, seed=${seed}`;
      assert.doesNotThrow(() => renderGame(ctx, frame, options), `renderGame не бросает исключений: ${where}`);
      assert.ok(calls.length > 0, `renderGame рисует кадр: ${where}`);
      assert.deepEqual(frame, snapshot, `renderGame не меняет состояние: ${where}`);
    }
  }
  passed.push(`render-hooks: seed=${seed}: renderGame с aim=null и aim={x,y} без исключений и без мутаций`);
}

// 2. audio.play without an audio device: no AudioContext at all, and before unlock.
{
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const originalWebkit = Object.getOwnPropertyDescriptor(globalThis, 'webkitAudioContext');
  try {
    delete globalThis.AudioContext;
    delete globalThis.webkitAudioContext;
    const audio = createAudio();
    for (const type of ['warning', 'unknown', 'warning']) {
      assert.doesNotThrow(() => audio.play(type), `audio.play('${type}') без устройства до unlock не бросает`);
    }
    const unlocked = await audio.unlock();
    assert.equal(unlocked, false, 'без AudioContext unlock возвращает false');
    for (const type of ['warning', 'unknown']) {
      assert.doesNotThrow(() => audio.play(type), `audio.play('${type}') без устройства после unlock не бросает`);
    }
    audio.dispose();
    assert.doesNotThrow(() => audio.play('warning'), "audio.play('warning') после dispose не бросает");
  } finally {
    if (original) Object.defineProperty(globalThis, 'AudioContext', original);
    if (originalWebkit) Object.defineProperty(globalThis, 'webkitAudioContext', originalWebkit);
  }
  passed.push("render-hooks: audio.play('warning') и audio.play('unknown') без аудиоустройства не бросают");
}

for (const line of passed) console.log(`PASS ${line}`);
console.log('REGRESSION OK');
