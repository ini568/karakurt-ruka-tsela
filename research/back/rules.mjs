// Rule check against the contract: warning is safe, dodge +25 once, dash without direction is free.
// Usage: node research/back/rules.mjs
import assert from 'node:assert/strict';
import { createGame, stepGame } from '../../src/game/model.js';

const DT = 1 / 60;
const quiet = () => {
  const s = createGame({ seed: 17 });
  Object.assign(s.player, { x: 640, y: 360, vx: 0, vy: 0, invulnerable: 0 });
  s.flies = []; s.hazards = []; s.particles = []; s.events = [];
  s.time = 5; s.wave = 1;
  return s;
};

// 1. Standing in a warning zone: no damage until it becomes active.
{
  const s = quiet();
  s.hazards = [{ id: 'w', kind: 'glass', phase: 'warning', x: 540, y: 260, w: 200, h: 200, remaining: 1.0 }];
  let activeSeen = false;
  for (let i = 0; i < 59; i++) {
    stepGame(s, {}, DT);
    const h = s.hazards[0];
    if (h && h.phase === 'active') activeSeen = true;
    if (!activeSeen) assert.equal(s.player.hp, 3, 'warning must not hurt');
  }
  for (let i = 0; i < 10; i++) stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, 'active phase hurts exactly once');
}

// 2. Surviving an attack elsewhere: +25 and dodges++ exactly once.
{
  const s = quiet();
  s.hazards = [{ id: 'a', kind: 'slap', phase: 'active', x: 100, y: 100, w: 200, h: 200, remaining: 0.24 }];
  const before = s.score;
  for (let i = 0; i < 40; i++) stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, 1);
  assert.equal(s.score - before, 25);
}

// 3. Dash with no direction costs no silk and emits no dash event.
{
  const s = quiet();
  stepGame(s, { dashPressed: true, aimX: 640, aimY: 360 }, DT);
  assert.equal(s.events.filter(e => e.type === 'dash').length, 0);
  assert.ok(s.player.silk >= 100 - 1e-9);
  const t = quiet();
  stepGame(t, { dashPressed: true, moveX: 1 }, DT);
  assert.equal(t.events.filter(e => e.type === 'dash').length, 1);
}

// 4. Score never negative.
{
  const s = quiet();
  s.score = 0;
  s.hazards = [{ id: 'h', kind: 'slap', phase: 'active', x: 540, y: 260, w: 200, h: 200, remaining: 0.24 }];
  stepGame(s, {}, DT);
  assert.equal(s.score, 0);
}

// Dodge frequency: a warning-driven controller vs. attacks, and passive lifetime.
const seeds = [1, 47, 987654];
for (const seed of seeds) {
  const s = createGame({ seed });
  let steps = 0;
  while (s.status === 'playing' && steps++ < 11000) stepGame(s, {}, DT);
  console.log(`passive seed ${seed}: ${s.status} at ${s.time.toFixed(2)} s, score ${s.score}, dodges ${s.stats.dodges}`);
}
console.log('RULES OK');
