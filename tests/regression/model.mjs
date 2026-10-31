import assert from 'node:assert/strict';
import { createGame, stepGame, readProgress, serializeProgress } from '../../src/game/model.js';

export function checkModel() {
  const checks = [];
  const command = { moveX: 1, moveY: -1, aimX: 640, aimY: 75, webHeld: true, dashPressed: true };
  for (const status of ['won', 'lost']) {
    const state = createGame({ seed: 91 });
    state.flies = [];
    state.hazards = [];
    state.score = 100;
    if (status === 'won') state.time = state.duration;
    else state.player.hp = 0;
    stepGame(state, {}, 1 / 60);
    assert.equal(state.status, status);
    assert.equal(state.score, status === 'won' ? 600 : 100, 'terminal bonus is awarded once');
    assert.deepEqual(state.events.map(event => event.type), [status === 'won' ? 'win' : 'lose']);
    const frozen = structuredClone({ ...state, events: [] });
    const saved = serializeProgress(state);
    for (const dt of [1 / 60, 10, NaN, Infinity, -Infinity, 0]) {
      stepGame(state, command, dt);
      assert.deepEqual(state.events, [], 'terminal outbox must not repeat a result');
      assert.deepEqual(state, frozen, 'terminal state must not simulate or award points again');
      assert.equal(serializeProgress(state), saved);
    }
    const next = createGame({ seed: 91 });
    assert.equal(next.status, 'playing');
    assert.equal(next.player.hp, 3);
    assert.equal(next.time, 0);
    assert.equal(next.score, 0);
    assert.equal(next.web, null);
    stepGame(next, command, 1 / 60);
    assert.deepEqual(state, frozen, 'new game does not mutate the completed game');
    checks.push(`model: ${status}, one result, frozen state, independent replay`);
  }

  for (const dt of [NaN, Infinity, -Infinity, -1, 0, null, '0.02', {}, true]) {
    const state = createGame({ seed: 68 });
    // Seed a real pending event; only the transient outbox may change on a rejected step.
    state.events.push({ type: 'web', x: 640, y: 75 });
    const expected = structuredClone({ ...state, events: [] });
    stepGame(state, command, dt);
    assert.deepEqual(state, expected, `invalid dt ${String(dt)} must not advance physics, RNG, silk or score`);
  }
  const capped = createGame({ seed: 68 });
  const large = createGame({ seed: 68 });
  stepGame(capped, command, 0.033);
  stepGame(large, command, Number.MAX_VALUE);
  assert.deepEqual(large, capped, 'large finite dt remains capped');
  checks.push('model: invalid dt is a no-op; large finite dt is capped');

  const empty = { version: 1, bestScore: 0, bestSurvival: 0, wins: 0 };
  for (const text of [undefined, null, '', '{', 'null', '[]', 'true', '5', '{}', '{"version":2}',
    '{"version":1,"bestScore":1e999,"bestSurvival":-1,"wins":"1"}']) {
    assert.deepEqual(readProgress(text), empty, `corrupt save ${String(text)}`);
  }
  const valid = { version: 1, bestScore: 123, bestSurvival: 27.5, wins: 2 };
  assert.deepEqual(readProgress(JSON.stringify(valid)), valid);
  assert.deepEqual(readProgress('{"version":1,"bestScore":123,"bestSurvival":"bad","wins":2}'),
    { ...valid, bestSurvival: 0 }, 'one damaged record does not discard other valid records');
  checks.push('model: corrupt saves and valid round trip');
  return checks;
}
