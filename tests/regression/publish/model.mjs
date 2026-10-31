import assert from 'node:assert/strict';
import { createGame, stepGame } from '../../../src/game/model.js';

const DT = 1 / 60;
function fresh() {
  const state = createGame({ seed: 42 });
  state.flies = [];
  state.hazards = [];
  return state;
}

for (const kind of ['slap', 'glass', 'sweep']) {
  const state = fresh();
  state.score = 50;
  const hazard = {
    id: `publish-${kind}`, kind, phase: 'warning', remaining: 0.5,
    x: state.player.x - 50, y: state.player.y - 50, w: 100, h: 100,
  };
  state.hazards.push(hazard);
  for (let frame = 0; frame < 10; frame++) {
    stepGame(state, {}, DT);
    assert.equal(hazard.phase, 'warning');
    assert.equal(state.player.hp, 3, `${kind}: warning must not damage`);
    assert.equal(state.player.invulnerable, 0, `${kind}: warning grants no hit immunity`);
    assert.equal(state.score, 50, `${kind}: warning must not deduct score`);
    assert.equal(state.events.some(event => event.type === 'hurt'), false);
  }
  // Exercise the real warning -> active transition, not a replacement damage routine.
  hazard.remaining = DT / 2;
  stepGame(state, {}, DT);
  assert.equal(hazard.phase, 'active');
  assert.equal(state.player.hp, 2, `${kind}: active overlap must damage`);
  assert.equal(state.score, 40);
  assert.ok(state.player.invulnerable > 0);
  assert.equal(state.events.filter(event => event.type === 'hurt').length, 1);
  stepGame(state, {}, DT);
  assert.equal(state.player.hp, 2, `${kind}: immunity prevents repeated damage`);
}

for (const silk of [28, 60, 100]) {
  const idle = fresh();
  idle.player.silk = silk;
  const noDirection = structuredClone(idle);
  const aim = { moveX: 0, moveY: 0, aimX: idle.player.x, aimY: idle.player.y, webHeld: false };
  stepGame(idle, aim, DT);
  stepGame(noDirection, { ...aim, dashPressed: true }, DT);
  assert.equal(noDirection.player.silk, idle.player.silk, 'directionless dash must not spend silk (including regeneration)');
  assert.deepEqual(noDirection.player, idle.player, 'directionless dash must not impart velocity');
  assert.equal(noDirection.events.some(event => event.type === 'dash'), false);
  assert.equal(noDirection.particles.length, 0);
}

// Positive control: a real directed dash still costs 28 silk and emits its event.
{
  const idle = fresh();
  idle.player.silk = 60;
  const dash = structuredClone(idle);
  stepGame(idle, {}, DT);
  stepGame(dash, { moveX: 1, moveY: 0, dashPressed: true }, DT);
  assert.ok(Math.abs(idle.player.silk - dash.player.silk - 28) < 1e-9);
  assert.equal(dash.events.filter(event => event.type === 'dash').length, 1);
  assert.ok(dash.player.vx > idle.player.vx);
}

console.log('REGRESSION OK: publish/model');
