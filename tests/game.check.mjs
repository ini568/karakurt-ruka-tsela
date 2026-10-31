// Standalone development smoke-check; project acceptance tests remain independent.
import assert from 'node:assert/strict';
import { createGame, stepGame, serializeProgress, readProgress } from '../src/game/model.js';

const a = createGame({ seed: 987 });
const b = createGame({ seed: 987 });
for (let i = 0; i < 12000; i++) {
  const input = { moveX: Math.sin(i / 90), moveY: Math.cos(i / 130),
    aimX: 640, aimY: 75, webHeld: i % 240 < 120, dashPressed: i % 60 === 0 };
  // Keep both alive to exercise every wave and the full duration.
  a.player.invulnerable = b.player.invulnerable = 100;
  stepGame(a, input, 1 / 60);
  stepGame(b, input, 1 / 60);
  assert.deepEqual(a, b);
  for (const value of Object.values(a.player)) assert.ok(Number.isFinite(value));
  assert.ok(a.flies.length <= 14 && a.hazards.length <= 4 && a.particles.length <= 120);
}
assert.equal(a.status, 'won');
assert.equal(a.time, 180);
assert.ok(a.wave >= 10);
const terminal = JSON.stringify({ ...a, events: [] });
stepGame(a, {}, 0.033);
assert.equal(JSON.stringify(a), terminal);
for (const dt of [-Infinity, -1, 0, NaN, Infinity, Number.MAX_VALUE]) {
  const state = createGame();
  stepGame(state, { moveX: Infinity, moveY: NaN, aimX: -Infinity }, dt);
  assert.ok(state.time >= 0 && state.time <= 0.033);
  for (const value of Object.values(state.player)) assert.ok(Number.isFinite(value));
}
const bounds = createGame();
for (let i = 0; i < 500; i++) stepGame(bounds, { moveX: -1, moveY: -1 }, 0.033);
assert.ok(bounds.player.x >= bounds.player.radius && bounds.player.y >= bounds.player.radius);
for (let i = 0; i < 900; i++) {
  bounds.player.invulnerable = 10;
  stepGame(bounds, { moveX: 1, moveY: 1 }, 0.033);
  assert.ok(bounds.hazards.filter(h => h.phase !== 'fade').length <= 1);
}
assert.ok(bounds.player.x <= 1280 - bounds.player.radius && bounds.player.y <= 720 - bounds.player.radius);
const web = createGame();
web.player.x = 800;
web.player.y = 300;
stepGame(web, { aimX: 640, aimY: 75, webHeld: true }, 0.02);
assert.equal(web.web.anchorX, 640);
for (let i = 0; i < 30; i++) stepGame(web, { webHeld: true }, 0.02);
assert.ok(Math.hypot(web.player.x - web.web.anchorX, web.player.y - web.web.anchorY) <= web.web.length + 0.001);
const speed = Math.hypot(web.player.vx, web.player.vy);
assert.ok(speed > 0);
stepGame(web, { webHeld: false }, 0.02);
assert.equal(web.web, null);
assert.ok(Math.hypot(web.player.vx, web.player.vy) > speed * 0.8);
const dash = createGame();
let dashes = 0;
for (let i = 0; i < 10; i++) {
  stepGame(dash, { moveX: 1, dashPressed: true }, 0.01);
  dashes += dash.events.filter(e => e.type === 'dash').length;
}
assert.equal(dashes, 3);
const hit = createGame();
hit.hazards = [{ id: 'test', kind: 'slap', phase: 'warning', x: 500, y: 300, w: 300, h: 300, remaining: 0.02 }];
stepGame(hit, {}, 0.01);
assert.equal(hit.player.hp, 3);
stepGame(hit, {}, 0.02);
assert.equal(hit.player.hp, 2);
for (let i = 0; i < 5; i++) stepGame(hit, {}, 0.02);
assert.equal(hit.player.hp, 2);
const lose = createGame();
lose.player.hp = 0;
stepGame(lose, {}, 0.01);
assert.equal(lose.status, 'lost');
assert.equal(lose.events[0].type, 'lose');
stepGame(lose, {}, 0.01);
assert.deepEqual(lose.events, []);
const fly = createGame();
fly.flies = [{ id: 'test', x: fly.player.x, y: fly.player.y, radius: 9 }];
stepGame(fly, {}, 0.01);
assert.equal(fly.stats.flies, 1);
assert.equal(fly.score, 100);
for (const text of ['', '{', 'null', '[]', '42', '{"version":1,"wins":-3,"bestScore":"5","bestSurvival":null}']) {
  assert.deepEqual(readProgress(text), { version: 1, bestScore: 0, bestSurvival: 0, wins: 0 });
}
assert.equal(readProgress(serializeProgress(a)).wins, 1);
console.log('MODEL SMOKE OK: 12000 deterministic steps, finite dt edges, rope/release, silk budget, catch, warning/damage immunity, win/loss, bounds and saves');
