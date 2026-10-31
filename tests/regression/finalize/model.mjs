// Standalone Node regression for model rules.
// Rules covered:
// - HP 3, timer 180s, invulnerability after hit
// - Damage only in active phase (warning is safe)
// - Dodge +25 and dodges++ exactly once per hazard
// - Score floor at 0 (never negative)
// - Victory +500 on 0:00 (180s survived with HP > 0)
// - Flies: +100 score, +14 silk, stats.flies++
import assert from 'node:assert/strict';
import { createGame, stepGame, serializeProgress, readProgress } from '../../../src/game/model.js';
import * as world from '../../../src/game/world.js';

const DT = 1 / 60;

function freshState(seed = 42) {
  const s = createGame({ seed });
  s.flies = [];
  s.hazards = [];
  s.particles = [];
  s.events = [];
  return s;
}

// 1. Initial conditions: 3 HP, duration 180s, score 0, playing status
{
  const s = freshState();
  assert.equal(s.player.hp, 3, 'initial HP must be 3');
  assert.equal(s.duration, 180, 'initial duration must be 180');
  assert.equal(s.time, 0, 'initial time must be 0');
  assert.equal(s.score, 0, 'initial score must be 0');
  assert.equal(s.status, 'playing', 'initial status must be playing');
}

// 2. Damage ONLY in active phase; warning phase is safe across all hazard kinds (slap, glass, sweep)
for (const kind of ['slap', 'glass', 'sweep']) {
  const s = freshState();
  s.score = 50;
  // Place hazard directly over player
  s.hazards = [{
    id: `test-warn-${kind}`,
    kind,
    phase: 'warning',
    x: s.player.x - 50,
    y: s.player.y - 50,
    w: 100,
    h: 100,
    remaining: 0.5,
  }];

  for (let i = 0; i < 15; i++) {
    stepGame(s, {}, DT);
    assert.equal(s.player.hp, 3, `player inside warning zone of ${kind} must NOT take damage`);
    assert.equal(s.score, 50, `warning phase of ${kind} must NOT reduce score`);
    assert.equal(s.events.filter(e => e.type === 'hurt').length, 0, 'no hurt event during warning');
  }

  // Now transition to active phase: player must take damage, score -10, invulnerability applied
  s.hazards[0].phase = 'active';
  s.hazards[0].remaining = 0.5;
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, `player inside active zone of ${kind} takes 1 damage`);
  assert.equal(s.score, 40, `active hit reduces score by 10`);
  assert.ok(s.player.invulnerable > 0, `hit grants invulnerability`);
  assert.equal(s.events.filter(e => e.type === 'hurt').length, 1, 'hurt event emitted');

  // Next frame while invulnerable: player should NOT take further damage
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, `invulnerability prevents immediate follow-up hit`);
  assert.equal(s.score, 40, `score not reduced while invulnerable`);
}

// 3. Score never drops below 0 (-10 hit from low score clamped to 0)
for (const initialScore of [0, 5, 9]) {
  const s = freshState();
  s.score = initialScore;
  s.hazards = [{
    id: 'test-clamp',
    kind: 'slap',
    phase: 'active',
    x: s.player.x - 50,
    y: s.player.y - 50,
    w: 100,
    h: 100,
    remaining: 0.5,
  }];
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, 'damage taken');
  assert.equal(s.score, 0, `score with initial ${initialScore} hit by -10 must floor at 0`);
}

// 4. Dodge: survived attack awards +25 score and stats.dodges++ exactly once
{
  const s = freshState();
  s.player.x = 100;
  s.player.y = 100;
  // Place active hazard away from player that expires next step
  s.hazards = [{
    id: 'test-dodge',
    kind: 'slap',
    phase: 'active',
    x: 600,
    y: 400,
    w: 100,
    h: 100,
    remaining: 0.001,
  }];
  const scoreBefore = s.score;
  const dodgesBefore = s.stats.dodges;

  stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, dodgesBefore + 1, 'dodges counter must increment by 1');
  assert.equal(s.score, scoreBefore + 25, 'dodge awards exactly +25 points');
  assert.equal(s.hazards.length, 0, 'expired hazard removed');

  // Continued simulation must not award duplicate dodge points
  for (let i = 0; i < 30; i++) stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, dodgesBefore + 1, 'dodges count must not increase again');
  // Score only increases from survived seconds (+5 per second)
  assert.equal(s.score, scoreBefore + 25, 'no extra dodge score awarded');
}

// 5. Invulnerable player or already hit hazard does NOT get dodge points
{
  const s = freshState();
  s.score = 100;
  s.player.x = 500;
  s.player.y = 300;
  s.hazards = [{
    id: 'test-hit-no-dodge',
    kind: 'glass',
    phase: 'active',
    x: 450,
    y: 250,
    w: 100,
    h: 100,
    remaining: 1.05,
  }];
  // Hit player
  stepGame(s, {}, DT);
  assert.equal(s.player.hp, 2, 'player hit');
  assert.equal(s.score, 90, 'score -10');

  // Move player away while glass is still active
  s.player.x = 100;
  s.player.y = 100;
  // Simulate until glass expires (1.05s / DT ≈ 63 steps)
  for (let i = 0; i < 70; i++) stepGame(s, {}, DT);
  assert.equal(s.stats.dodges, 0, 'attack that already hit must NOT award dodge bonus on expiry');
}

// 6. Flies: +100 score and +14 silk, stats.flies++
{
  const s = freshState();
  s.player.silk = 30;
  s.player.x = 400;
  s.player.y = 400;
  s.flies = [{
    id: 'fly-test',
    x: 400,
    y: 400,
    radius: 9,
  }];

  const twin = freshState();
  twin.player.silk = 30;
  twin.player.x = 400;
  twin.player.y = 400;
  twin.flies = [];

  stepGame(s, {}, DT);
  stepGame(twin, {}, DT);

  assert.equal(s.score - twin.score, 100, 'catching a fly awards exactly +100 score');
  assert.ok(Math.abs((s.player.silk - twin.player.silk) - 14) < 1e-6, 'catching a fly adds +14 silk above regeneration');
  assert.equal(s.stats.flies, 1, 'stats.flies increments by 1');
  assert.equal(s.flies.length, 0, 'caught fly is removed');

  // Next step: fly cannot be caught again
  stepGame(s, {}, DT);
  assert.equal(s.stats.flies, 1, 'fly cannot be caught twice');
}

// 7. Victory: +500 on 0:00 (time reaches 180s with HP > 0)
{
  const s = freshState();
  s.time = 179.99;
  s.player.hp = 3;
  s.score = 200;

  stepGame(s, {}, 0.02);
  assert.equal(s.status, 'won', 'status must be won when duration reached with positive HP');
  assert.equal(s.score, 705, 'score receives +5 for passing 180s and +500 victory bonus (200 + 5 + 500 = 705)');
  assert.ok(s.events.some(e => e.type === 'win'), 'win event emitted');

  // Terminal frozen state: further steps do not change status or score
  const scoreAfterWin = s.score;
  for (let i = 0; i < 20; i++) {
    stepGame(s, { moveX: 1 }, DT);
    assert.equal(s.status, 'won', 'status stays won');
    assert.equal(s.score, scoreAfterWin, 'score frozen after victory');
  }
}

// 8. Reaching 180s with 0 HP is a loss, NOT victory
{
  const s = freshState();
  s.time = 179.99;
  s.player.hp = 0;
  s.score = 100;

  stepGame(s, {}, 0.02);
  assert.equal(s.status, 'lost', 'status must be lost if HP <= 0 even at 180s');
  assert.equal(s.score, 100, 'loss does not award victory bonus');
  assert.ok(!s.events.some(e => e.type === 'win'), 'no win event on loss');
}

console.log('REGRESSION OK: finalize/model');
