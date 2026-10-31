// Local contract smoke check; not a replacement for real browser acceptance.
import assert from 'node:assert/strict';
import { renderGame } from '../src/art/renderer.js';
import { createAudio } from '../src/art/audio.js';
import { PALETTE } from '../src/art/palette.js';
const gradient = { addColorStop() {} };
const ctx = new Proxy({}, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
  if (key === 'measureText') return (text) => ({ width: text.length * 8 });
  return () => {};
} });
const state = {
  time: 1, player: { x: 400, y: 300, vx: 40, vy: 20, radius: 13, hp: 1, invulnerable: 1 },
  anchors: [{ id: 'a', x: 40, y: 50 }], web: { anchorX: 40, anchorY: 50, length: 430 },
  flies: [{ id: 'f', x: 900, y: 400, radius: 8 }],
  particles: [{ x: 100, y: 300, life: .1, kind: 'hit' }],
  hazards: ['slap', 'glass', 'sweep'].flatMap((kind, index) => ['warning', 'active', 'fade'].map((phase, j) => ({
    id: `${index}-${j}`, kind, phase, x: index * 300, y: 50 + j * 180, w: 220, h: 140, remaining: .5,
  }))),
};
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
freeze(state);
const before = JSON.stringify(state);
for (const reducedMotion of [false, true]) renderGame(ctx, state, { width: 1280, height: 720, reducedMotion });
renderGame(ctx, state, { width: 375, height: 500, reducedMotion: true });
assert.equal(JSON.stringify(state), before);
assert.equal(PALETTE.spiderMark, '#e01a2b');
const audio = createAudio();
assert.equal(await audio.unlock(), false); // Node has no AudioContext.
for (const type of ['web', 'dash', 'catch', 'hurt', 'attack', 'wave', 'win', 'lose']) audio.play(type);
audio.setMuted(true); audio.setMuted(false); audio.dispose(); audio.dispose();
assert.equal(await audio.unlock(), false);
console.log('ART DRAFT OK: frozen state unchanged, all hazard phases and reduced motion paths render, no-AudioContext safe.');
