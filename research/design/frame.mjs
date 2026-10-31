// Design smoke check: renders frames on a recording canvas stub (no browser).
// Covers empty/missing/full arrays, score pops (+25/+100/−10), hit shake/flash,
// invulnerability blink, and a real model run. Exits non-zero on any failure.
import assert from 'node:assert/strict';
import { renderGame } from '../../src/art/renderer.js';
import { createGame, stepGame } from '../../src/game/model.js';

function makeCtx() {
  const log = { text: [], translate: [], alpha: [], fill: [] };
  const gradient = { addColorStop() {} };
  const target = {};
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (key === 'fillText') return (s) => log.text.push(String(s));
      if (key === 'translate') return (x, y) => log.translate.push([x, y]);
      if (key === 'fillRect') return (...a) => log.fill.push([t.fillStyle, ...a]);
      return () => {};
    },
    set(t, key, value) {
      if (key === 'globalAlpha') log.alpha.push(value);
      t[key] = value; return true;
    },
  });
  return { ctx, log };
}

const base = () => ({
  time: 1, status: 'playing', score: 0, wave: 1,
  player: { x: 400, y: 300, vx: 0, vy: 0, radius: 17, hp: 3, silk: 80, invulnerable: 0 },
  anchors: [{ id: 'a', x: 40, y: 50 }], web: null, events: [],
  flies: [], particles: [], hazards: [], stats: { flies: 0, dodges: 0 },
});
let frames = 0;
function frame(state, opts = {}) {
  const { ctx, log } = makeCtx();
  renderGame(ctx, state, { width: 1280, height: 720, ...opts });
  frames++;
  return log;
}

// 1. Empty and missing arrays must not throw.
frame(base());
const missing = base(); delete missing.flies; delete missing.particles; delete missing.hazards; delete missing.anchors; delete missing.stats;
frame(missing); frame(missing, { reducedMotion: true });
console.log('empty arrays: OK; missing arrays: OK');

// 2. Full arrays, every hazard kind and phase, frozen state unchanged.
const full = base();
full.flies = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, x: 100 + i * 150, y: 200, radius: 8 }));
full.particles = Array.from({ length: 150 }, (_, i) => ({ x: i * 8, y: 400, life: .3, kind: ['hit', 'fly', 'silk'][i % 3] }));
full.hazards = ['slap', 'glass', 'sweep'].flatMap((kind, k) => ['warning', 'active', 'fade'].map((phase, j) => ({ id: `${k}${j}`, kind, phase, x: k * 380, y: 40 + j * 200, w: 240, h: 160, remaining: .4 })));
full.web = { anchorX: 40, anchorY: 50, length: 300 };
const snapshot = JSON.stringify(full);
for (const reducedMotion of [false, true]) frame(full, { reducedMotion, aim: { x: 60, y: 60 } });
assert.equal(JSON.stringify(full), snapshot, 'renderer must not mutate state');
console.log('full arrays (6 flies, 150 particles, 9 hazards): OK, state unchanged');

// 3. Feedback on existing model changes (state is mutated here, as the model does).
const s = base();
s.flies = [{ id: 'f1', x: 700, y: 250, radius: 8 }];
frame(s);
s.time = 1.05; s.stats.dodges = 1; s.score = 25;
let log = frame(s);
assert.ok(log.text.some(t => t.includes('+25')), '+25 pop after dodge');
s.time = 1.1; s.flies = []; s.stats.flies = 1; s.score = 125;
log = frame(s);
assert.ok(log.text.some(t => t.includes('+100')), '+100 pop after fly catch');
s.time = 1.15; s.player.hp = 2; s.player.invulnerable = 1.3; s.score = 115;
log = frame(s);
assert.ok(log.text.some(t => t.includes('−10')), '−10 pop after hit');
const shake = log.translate.filter(([x, y]) => (x !== 0 || y !== 0) && !(x === s.player.x && y === s.player.y));
assert.ok(shake.length > 0, 'shake translate after hit');
assert.ok(log.fill.some(([style]) => String(style).startsWith('rgba(255,42,58')), 'red flash after hit');
console.log(`pops: +25 / +100 / −10 seen; shake offset ${shake[0].map(v => v.toFixed(2)).join(',')}; red flash seen`);

// 4. Blink: across the invulnerable window the spider alternates dim and full alpha.
const alphas = new Set();
for (let t = 1.2; t < 2.4; t += 1 / 60) {
  s.time = t; s.player.invulnerable = Math.max(0, 2.45 - t);
  for (const a of frame(s).alpha) alphas.add(a);
}
assert.ok(alphas.has(0.28) && alphas.has(1), 'blink alternates 0.28 and 1');
s.time = 3; s.player.invulnerable = 0;
assert.ok(!frame(s).alpha.includes(0.28), 'no blink without invulnerability');
const reducedAlpha = frame({ ...s, player: { ...s.player, invulnerable: 1 } }, { reducedMotion: true }).alpha;
assert.ok(!reducedAlpha.includes(0.28), 'reduced motion uses a soft fade, not hard blink');
const noShake = frame({ ...s, time: 3.01 }, { reducedMotion: true });
assert.ok(noShake.translate.every(([x, y]) => (x === 0 && y === 0) || (x === s.player.x && y === s.player.y) || x === 640), 'reduced motion has no shake');
console.log('blink: alternates while invulnerable, off otherwise, soft in reduced motion');

// 5. Real model: 60 s of play with moving input, a frame per step.
const game = createGame({ seed: 7 });
for (let i = 0; i < 3600 && game.status === 'playing'; i++) {
  const a = i / 40;
  stepGame(game, { move: { x: Math.cos(a), y: Math.sin(a) } }, 1 / 60);
  frame(game, { aim: { x: 640 + Math.cos(a) * 300, y: 300 } });
}
console.log(`real model: status=${game.status} time=${game.time.toFixed(1)} score=${game.score} dodges=${game.stats.dodges} flies=${game.stats.flies}`);
console.log(`DESIGN FRAME OK: ${frames} frames rendered without exceptions`);
