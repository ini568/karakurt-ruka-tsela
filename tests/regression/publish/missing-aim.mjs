import assert from 'node:assert/strict';
import { createGame, stepGame } from '../../../src/game/model.js';

for (const aim of [{}, { aimX: NaN, aimY: Infinity }]) {
  const idle = createGame({ seed: 42 });
  idle.player.silk = 60;
  const dash = structuredClone(idle);
  stepGame(idle, aim, 1 / 60);
  stepGame(dash, { ...aim, dashPressed: true }, 1 / 60);
  assert.deepEqual(dash.player, idle.player, 'missing/invalid aim must not invent a dash direction');
  assert.equal(dash.events.some(event => event.type === 'dash'), false);
}
console.log('REGRESSION OK: publish/missing-aim');
