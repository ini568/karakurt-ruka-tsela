// Mechanics check: pendulum, release momentum, dash budget, all hazard kinds, entity caps, scoring.
import assert from 'node:assert/strict';
import { createGame, stepGame, serializeProgress, readProgress } from '../src/game/model.js';

const DT = 1 / 60;

// 1. Pendulum: spider hangs from an anchor, swings, never exceeds rope length, keeps momentum on release.
{
  const s = createGame({ seed: 5 });
  s.hazards = [];
  s.player.x = 460; s.player.y = 200; s.player.vx = 0; s.player.vy = 0;
  let minX = Infinity, maxX = -Infinity;
  stepGame(s, { aimX: 640, aimY: 75, webHeld: true }, DT);
  assert.ok(s.web, 'web attached');
  for (let i = 0; i < 180; i++) {
    s.hazards = []; s.player.invulnerable = 5;
    stepGame(s, { webHeld: true, aimX: 640, aimY: 75 }, DT);
    const d = Math.hypot(s.player.x - s.web.anchorX, s.player.y - s.web.anchorY);
    assert.ok(d <= s.web.length + 0.01, 'rope never stretches');
    minX = Math.min(minX, s.player.x); maxX = Math.max(maxX, s.player.x);
  }
  assert.ok(maxX - minX > 80, `spider swings (range ${maxX - minX})`);
  const speed = Math.hypot(s.player.vx, s.player.vy);
  assert.ok(speed > 20, 'moving before release');
  stepGame(s, { webHeld: false }, DT);
  assert.equal(s.web, null);
  assert.ok(Math.hypot(s.player.vx, s.player.vy) > speed * 0.7, 'momentum kept after release');
}

// 2. Dash cannot be spammed: silk is a hard budget and regenerates slowly.
{
  const s = createGame({ seed: 6 });
  let dashes = 0;
  for (let i = 0; i < 300; i++) {
    s.hazards = []; s.player.invulnerable = 5; s.flies = [];
    stepGame(s, { moveX: 1, dashPressed: true }, DT);
    dashes += s.events.filter(e => e.type === 'dash').length;
    assert.ok(s.player.silk >= 0 && s.player.silk <= 100);
  }
  // 5 seconds: 100 silk / 28 = 3 initial dashes + regen 12/s * 5 = 60 → at most ~2 more.
  assert.ok(dashes >= 3 && dashes <= 6, `dash count bounded (${dashes})`);
}

// 3. Every hazard kind shows up, always with a warning first, and caps hold; waves escalate.
{
  const s = createGame({ seed: 77 });
  const kinds = new Set();
  const seenWarning = new Map();
  let maxHazards = 0, maxFlies = 0, maxParticles = 0, waveEvents = 0;
  for (let i = 0; i < 180 * 60; i++) {
    s.player.invulnerable = 100; // keep alive to see the whole night
    stepGame(s, { moveX: Math.sin(i / 50), moveY: Math.cos(i / 70) }, DT);
    waveEvents += s.events.filter(e => e.type === 'wave').length;
    for (const h of s.hazards) {
      kinds.add(h.kind);
      if (h.phase === 'warning') seenWarning.set(h.id, true);
      if (h.phase === 'active') assert.ok(seenWarning.get(h.id), 'active hazard had a warning');
    }
    maxHazards = Math.max(maxHazards, s.hazards.length);
    maxFlies = Math.max(maxFlies, s.flies.length);
    maxParticles = Math.max(maxParticles, s.particles.length);
  }
  assert.deepEqual([...kinds].sort(), ['glass', 'slap', 'sweep']);
  assert.ok(maxHazards <= 4 && maxFlies <= 14 && maxParticles <= 120);
  assert.equal(s.status, 'won');
  assert.ok(waveEvents >= 9, `waves escalate (${waveEvents})`);
}

// 4. Warning leaves time to react: hazard is harmless during warning.
{
  const s = createGame({ seed: 3 });
  s.hazards = [{ id: 'w', kind: 'glass', phase: 'warning', x: 400, y: 300, w: 600, h: 300, remaining: 1 }];
  s.player.x = 640; s.player.y = 440;
  for (let i = 0; i < 30; i++) stepGame(s, {}, DT);
  assert.equal(s.player.hp, 3);
}

// 5. Scoring: a passive player still gets a non-zero record; a win pays the dawn bonus; progress round-trips.
{
  const s = createGame({ seed: 9 });
  for (let i = 0; i < 10 * 60; i++) { s.player.invulnerable = 100; stepGame(s, {}, DT); }
  assert.ok(s.score >= 45, `survival scores (${s.score})`);
  const saved = readProgress(serializeProgress(s));
  assert.ok(saved.bestScore > 0 && saved.bestSurvival > 9);
  const w = createGame({ seed: 9 });
  w.time = 179.99;
  stepGame(w, {}, 0.033);
  assert.equal(w.status, 'won');
  assert.ok(w.score >= 500);
  assert.equal(readProgress(serializeProgress(w)).wins, 1);
}

console.log('MECHANICS OK: pendulum, release momentum, dash budget, 3 hazard kinds with warnings, entity caps, waves, scoring');
