// Standalone Node regression; exercises real exports, no fixtures or network.
import assert from 'node:assert/strict';
import { createGame, stepGame, serializeProgress, readProgress } from '../../../src/game/model.js';
import * as world from '../../../src/game/world.js';

const DT = 1 / 60;
for (const name of ['updateHazards', 'spawnFly', 'burst']) {
  assert.equal(typeof world[name], 'function', `world.${name} must remain callable`);
}
function fresh() {
  const s = createGame({ seed: 47 });
  s.flies = [];
  return s;
}
function zone(phase = 'active', remaining = 0.5) {
  return { id: 'final-zone', kind: 'glass', phase, x: 500, y: 300, w: 280, h: 280, remaining };
}
function count(s, type) { return s.events.filter(e => e.type === type).length; }
function terminalFrozen(s) {
  const before = structuredClone({ ...s, events: [] });
  for (let i = 0; i < 20; i++) {
    stepGame(s, { moveX: 1, dashPressed: true, webHeld: true }, DT);
    assert.deepEqual(s, before, 'terminal state must not simulate or repeat rewards/events');
  }
}
const initial = fresh();
assert.equal(initial.duration, 180);
assert.equal(initial.player.hp, 3);
assert.equal(initial.status, 'playing');
assert.equal(initial.score, 0);

// Validate an actually spawned hazard, not just a test-created object.
const natural = fresh();
for (let i = 0; i < 600 && natural.hazards.length === 0; i++) stepGame(natural, {}, DT);
const spawned = natural.hazards.find(h => h.phase === 'warning');
assert.ok(spawned, 'a real warning must appear within 10 seconds');
for (const key of ['id', 'kind', 'phase', 'x', 'y', 'w', 'h', 'remaining']) {
  assert.ok(Object.hasOwn(spawned, key), `spawned hazard missing ${key}`);
}
assert.ok(['slap', 'glass', 'sweep'].includes(spawned.kind));
for (const key of ['x', 'y', 'w', 'h', 'remaining']) assert.ok(Number.isFinite(spawned[key]), key);
assert.ok(spawned.remaining > 0 && spawned.remaining < 3, 'remaining is seconds, not milliseconds');

for (const kind of ['slap', 'glass', 'sweep']) {
  const s = fresh();
  s.score = 100;
  s.hazards = [{ ...zone('warning', 0.5), kind }];
  for (let i = 0; i < 10; i++) {
    stepGame(s, {}, DT);
    assert.equal(s.player.hp, 3, `${kind}: warning must never hurt inside its zone`);
    assert.equal(count(s, 'hurt'), 0);
  }
  assert.equal(s.score, 100, `${kind}: warning gives neither penalty nor dodge reward`);
  s.hazards[0].phase = 'active';
  s.hazards[0].remaining = 0.5;
  s.player.invulnerable = 2 * DT;
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 3, 'positive remaining invulnerability protects');
  assert.ok(Math.abs(s.player.invulnerable - DT) < 1e-9);
  s.player.invulnerable = DT;
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, 'invulnerability expires BEFORE collision on this step');
  assert.equal(s.score, 90);
  assert.equal(count(s, 'hurt'), 1);
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, 'same active attack cannot immediately hit again');
}
for (const score of [0, 4]) {
  const s = fresh(); s.score = score; s.hazards = [zone()];
  stepGame(s, {}, DT);
  assert.equal(s.score, 0, 'hit score has a zero floor');
}
for (const invulnerable of [0, 1]) {
  const s = fresh();
  s.player.x = 100; s.player.y = 100;
  s.player.invulnerable = invulnerable;
  s.hazards = [zone('active', 0.001)];
  const expected = invulnerable ? 0 : 1;
  for (let i = 0; i < 45; i++) stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, expected, 'one finished attack yields at most one dodge, never during invulnerability');
  assert.equal(s.score, 25 * expected, 'dodge points must be awarded exactly once through expiry/removal');
}
// A hit in an actual-length glass attack must not turn into a dodge at expiry.
{
  const s = fresh(); s.score = 100; s.hazards = [zone('active', 1.05)];
  stepGame(s, {}, DT);
  s.player.x = 100; s.player.y = 100;
  for (let i = 0; i < 70; i++) stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, 0, 'an attack that already hit is not a clean dodge');
  assert.equal(s.score, 95, 'only -10 hit and +5 for the first second');
}
{
  const s = fresh(); s.player.silk = 20;
  s.flies = [{ id: 'final-fly', x: s.player.x, y: s.player.y, radius: 9 }];
  const twin = structuredClone(s); twin.flies = [];
  stepGame(s, {}, DT); stepGame(twin, {}, DT);
  assert.equal(s.score - twin.score, 100);
  assert.ok(Math.abs((s.player.silk - twin.player.silk) - 14) < 1e-9, 'catch adds 14 silk above passive regeneration');
  assert.equal(s.stats.flies, 1);
  stepGame(s, {}, DT);
  assert.equal(s.stats.flies, 1, 'a removed fly cannot be caught twice');
}
{
  const s = fresh(); s.time = 0.99;
  stepGame(s, {}, 0.02);
  assert.equal(s.score, 5, 'crossing a survived whole second gives +5');
}
for (const hp of [0, 1, 3]) {
  const s = fresh(); s.time = 180; s.player.hp = hp; s.score = 123;
  stepGame(s, {}, DT);
  assert.equal(s.status, hp ? 'won' : 'lost', 'victory requires BOTH elapsed duration and positive hp');
  assert.equal(s.score, hp ? 623 : 123, 'victory bonus is exactly +500, never on loss');
  assert.equal(count(s, hp ? 'win' : 'lose'), 1);
  terminalFrozen(s);
}
{
  const s = fresh(); s.time = 179.995;
  stepGame(s, {}, 0.01);
  assert.equal(s.time, 180); assert.equal(s.status, 'won');
  assert.equal(s.score, 505, 'last second +5 and one victory bonus +500');
  terminalFrozen(s);
}
{
  const s = fresh(); s.player.hp = 1; s.time = 179.995; s.hazards = [zone()];
  stepGame(s, {}, 0.01);
  assert.equal(s.status, 'lost', 'lethal hit on final step must defeat, not win');
  assert.equal(count(s, 'win'), 0);
  terminalFrozen(s);
}
{
  const s = fresh();
  world.burst(s, 123, 234, 'fly', 7);
  assert.equal(s.particles.length, 7, 'burst(state,x,y,kind,count) preserves argument order');
  for (const p of s.particles) {
    assert.equal(p.x, 123); assert.equal(p.y, 234); assert.equal(p.kind, 'fly');
    for (const k of ['vx', 'vy', 'life']) assert.ok(Number.isFinite(p[k]), `particle ${k}`);
    assert.ok(p.life > 0);
  }
  world.spawnFly(s);
  assert.equal(s.flies.length, 1, 'spawnFly mutates the real state');
  const progress = readProgress(serializeProgress(s));
  assert.deepEqual(Object.keys(progress).sort(), ['bestScore', 'bestSurvival', 'version', 'wins']);
  assert.deepEqual(readProgress('{broken'), { version: 1, bestScore: 0, bestSurvival: 0, wins: 0 });
}
console.log('REGRESSION OK: final/model');
