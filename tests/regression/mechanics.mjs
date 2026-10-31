import assert from 'node:assert/strict';
import { createGame, stepGame } from '../../src/game/model.js';
import { burst } from '../../src/game/world.js';

export function checkMechanics() {
  const checks = [];
  const fullStep = createGame({ seed: 51 });
  fullStep.time = fullStep.duration - 0.005;
  const remainderStep = structuredClone(fullStep);
  const command = { moveX: 1, moveY: -1, dashPressed: true };
  stepGame(fullStep, command, 0.033);
  stepGame(remainderStep, command, fullStep.duration - remainderStep.time);
  assert.equal(fullStep.status, 'won');
  assert.deepEqual(fullStep, remainderStep, 'last step simulates only the remaining party time');
  const extreme = createGame({ seed: 51 });
  stepGame(extreme, { dashPressed: true, aimX: Number.MAX_VALUE, aimY: Number.MAX_VALUE }, 1 / 60);
  assert.ok(Number.isFinite(extreme.player.vx) && Number.isFinite(extreme.player.vy));
  assert.ok(Math.hypot(extreme.player.vx, extreme.player.vy) > 0, 'extreme finite aim still produces a dash');
  for (const count of [Infinity, -Infinity, NaN, 1e9]) {
    const state = createGame({ seed: 51 });
    burst(state, 640, 360, 'silk', count);
    assert.ok(state.particles.length <= 120, 'particle request cannot grow entities without bound');
    for (const particle of state.particles) {
      for (const key of ['x', 'y', 'vx', 'vy', 'life']) assert.ok(Number.isFinite(particle[key]));
    }
  }
  checks.push('mechanics: final-step remainder, extreme dash aim and bounded particle requests');

  // This controller consumes public warning rectangles; it does not reproduce hazard timing/physics.
  for (const seed of [1, 47, 987654]) {
    const state = createGame({ seed });
    let target = null;
    let attackId = null;
    let steps = 0;
    while (state.status === 'playing' && steps++ < 11000) {
      const p = state.player;
      const hazard = state.hazards.find(item => item.phase === 'warning' || item.phase === 'active');
      if (hazard && hazard.id !== attackId) {
        attackId = hazard.id;
        const margin = p.radius + 65;
        const candidates = [
          { x: hazard.x - margin, y: p.y }, { x: hazard.x + hazard.w + margin, y: p.y },
          { x: p.x, y: hazard.y - margin }, { x: p.x, y: hazard.y + hazard.h + margin },
        ].filter(point => point.x >= p.radius && point.x <= 1280 - p.radius &&
          point.y >= p.radius && point.y <= 720 - p.radius);
        candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        target = candidates[0];
      }
      const moveX = target ? Math.max(-1, Math.min(1, (target.x - p.x) / 70 - p.vx / 180)) : 0;
      const moveY = target ? Math.max(-1, Math.min(1, (target.y - p.y) / 70 - p.vy / 180)) : 0;
      stepGame(state, { moveX, moveY }, 1 / 60);
      for (const key of ['x', 'y', 'vx', 'vy', 'hp', 'silk']) {
        assert.ok(Number.isFinite(p[key]), `finite player.${key}, seed=${seed}, step=${steps}`);
      }
      assert.ok(state.hazards.length <= 4);
      assert.ok(state.flies.length <= 14);
      assert.ok(state.particles.length <= 120);
    }
    assert.equal(state.status, 'won', `warning-driven active controller must survive, seed=${seed}`);
    assert.ok(state.player.hp > 0);
    assert.equal(state.time, 180);
  }
  checks.push('mechanics: active warning-driven controller wins three seeded full-duration parties');
  return checks;
}
