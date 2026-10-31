// Hazard, invulnerability and dodge rules of the public model contract.
// Run standalone: node tests/regression/hazards.mjs
import assert from 'node:assert/strict';
import { WAVE_LENGTH, intensity } from '../../src/game/world.js';

// Loaded dynamically so a broken model reports the rule instead of a bare module-link error.
let createGame, stepGame;
try {
  ({ createGame, stepGame } = await import('../../src/game/model.js'));
} catch (error) {
  console.error(`правило: src/game/model.js загружается и экспортирует createGame/stepGame; ${error.message}`);
  process.exit(1);
}

const WIDTH = 1280;
const HEIGHT = 720;
const SEEDS = [1, 47, 987654, 20261030];
const STEP = 1 / 60;
const passed = [];
const hurts = state => state.events.filter(event => event.type === 'hurt').length;
const sign = n => `${n >= 0 ? '+' : ''}${n}`;

/** Fails with the broken rule and the seed in the message; the caller turns it into exit code 1. */
function rule(condition, text, seed, extra = '') {
  assert.ok(condition, `правило: ${text}; seed=${seed}${extra ? `; ${extra}` : ''}`);
}

/** A warning hazard exactly as the model itself creates it (no invented fields). */
function realHazard(seed) {
  const state = createGame({ seed });
  for (let i = 0; i < 60 * 40; i++) {
    state.flies = [];
    stepGame(state, {}, STEP);
    const hazard = state.hazards.find(h => h.phase === 'warning');
    if (hazard) return { state, hazard: structuredClone(hazard) };
  }
  assert.fail(`правило: модель создаёт предупреждения; за 40 с ни одного; seed=${seed}`);
}

function prepared(seed) {
  const { state, hazard } = realHazard(seed);
  Object.assign(state, { flies: [], hazards: [], particles: [], web: null, score: 1000 });
  Object.assign(state.player, { vx: 0, vy: 0, invulnerable: 0, hp: 3, silk: 100 });
  return { state, hazard };
}

function centreOf(hazard, r) {
  return {
    x: Math.max(r, Math.min(WIDTH - r, hazard.x + hazard.w / 2)),
    y: Math.max(r, Math.min(HEIGHT - r, hazard.y + hazard.h / 2)),
  };
}

function outsideOf(hazard, r) {
  const gap = r + 25;
  const c = centreOf(hazard, r);
  const candidates = [
    { x: hazard.x + hazard.w + gap, y: c.y }, { x: hazard.x - gap, y: c.y },
    { x: c.x, y: hazard.y + hazard.h + gap }, { x: c.x, y: hazard.y - gap },
  ].filter(p => p.x >= r && p.x <= WIDTH - r && p.y >= r && p.y <= HEIGHT - r);
  assert.ok(candidates.length > 0, 'есть точка вне зоны атаки внутри поля');
  return candidates[0];
}

/** Score difference against a twin that has no hazards; isolates the hazard's own points. */
function hazardDelta(state, hazards) {
  const twin = structuredClone(state);
  twin.hazards = [];
  state.hazards = hazards;
  stepGame(state, {}, STEP);
  stepGame(twin, {}, STEP);
  return state.score - twin.score;
}

// 1. Natural play: damage happens only when an active strike exists; warnings never hurt.
for (const seed of SEEDS) {
  const state = createGame({ seed });
  let steps = 0, hits = 0, warningSteps = 0;
  while (state.status === 'playing' && steps++ < 60 * 200) {
    const before = state.hazards.map(h => h.phase);
    const hp = state.player.hp;
    state.flies = []; // passive spider: no catches interfere with the hazard log
    stepGame(state, {}, STEP);
    const after = state.hazards.map(h => h.phase);
    const lost = hp - state.player.hp;
    const anyActive = before.includes('active') || after.includes('active');
    const where = `шаг ${steps}, t=${state.time.toFixed(3)}, фазы до=[${before}] после=[${after}]`;
    if (lost > 0) {
      hits++;
      rule(anyActive, 'урон наносит только phase===\'active\', а здоровье упало без активного удара', seed, where);
    }
    if (!anyActive && after.includes('warning')) {
      warningSteps++;
      rule(lost === 0, 'в фазе warning урона нет', seed, where);
    }
  }
  rule(warningSteps > 0, 'модель показывает предупреждения перед ударом', seed);
  rule(hits > 0, 'стоящий на месте паук получает урон от активных ударов', seed, `шагов ${steps}`);
}
passed.push(`hazards: естественная партия на seed ${SEEDS.join(', ')}: урон только при phase='active'`);

for (const seed of SEEDS) {
  // 2. A warning over the spider never hurts; the same zone as an active strike does (−10, floor 0).
  {
    const { state, hazard } = prepared(seed);
    Object.assign(state.player, centreOf(hazard, state.player.radius));
    const delta = hazardDelta(state, [{ ...hazard, phase: 'warning', remaining: 0.5 }]);
    rule(hurts(state) === 0 && state.player.hp === 3, 'в фазе warning урона нет', seed, `hp=${state.player.hp}`);
    rule(delta === 0, 'предупреждение не меняет счёт', seed, `получено ${sign(delta)}`);
  }
  {
    const { state, hazard } = prepared(seed);
    Object.assign(state.player, centreOf(hazard, state.player.radius));
    const delta = hazardDelta(state, [{ ...hazard, phase: 'active', remaining: 0.5 }]);
    rule(hurts(state) === 1 && state.player.hp === 2, 'в фазе active паук в зоне получает урон', seed, `hp=${state.player.hp}`);
    rule(delta === -10, 'удар даёт −10', seed, `получено ${sign(delta)}`);
    rule(state.player.invulnerable > 0, 'после удара включается неуязвимость', seed);
  }
  {
    const { state, hazard } = prepared(seed);
    state.score = 0;
    Object.assign(state.player, centreOf(hazard, state.player.radius));
    const twin = structuredClone(state);
    state.hazards = [{ ...hazard, phase: 'active', remaining: 0.5 }];
    stepGame(state, {}, STEP);
    stepGame(twin, {}, STEP);
    rule(hurts(state) === 1, 'активный удар попадает при нулевом счёте', seed);
    rule(state.score === Math.max(0, twin.score - 10), 'счёт не уходит ниже 0', seed, `счёт=${state.score}`);
  }
  // 3. Invulnerability decays at the start of the step: the step where it reaches 0 can already hit.
  {
    const { state, hazard } = prepared(seed);
    Object.assign(state.player, centreOf(hazard, state.player.radius), { invulnerable: 2 * STEP });
    state.hazards = [{ ...hazard, phase: 'active', remaining: 0.5 }];
    stepGame(state, {}, STEP);
    rule(hurts(state) === 0 && state.player.hp === 3, 'пока неуязвимость не кончилась к началу шага, удара нет', seed,
      `invulnerable после шага=${state.player.invulnerable}`);
    rule(Math.abs(state.player.invulnerable - STEP) < 1e-9, 'неуязвимость уменьшается на dt за шаг', seed,
      `invulnerable=${state.player.invulnerable}`);
    Object.assign(state.player, centreOf(hazard, state.player.radius), { vx: 0, vy: 0, invulnerable: STEP });
    state.flies = [];
    const live = state.hazards.find(h => h.phase === 'active');
    if (live) live.remaining = Math.max(live.remaining, 0.5);
    else state.hazards = [{ ...hazard, id: `${hazard.id}-again`, phase: 'active', remaining: 0.5 }];
    stepGame(state, {}, STEP);
    rule(hurts(state) === 1 && state.player.hp === 2,
      'неуязвимость уменьшается в начале шага, и шаг, где она доходит до 0, уже наносит удар', seed, `hp=${state.player.hp}`);
  }
  // 4. +25 only for a finished attack that missed a vulnerable spider.
  const ending = hazard => [{ ...hazard, phase: 'active', remaining: 0.001 }];
  const dodgeCase = (seed, place, invulnerable) => {
    const { state, hazard } = prepared(seed);
    Object.assign(state.player, place(hazard, state.player.radius), { invulnerable });
    const dodges = state.stats.dodges;
    const delta = hazardDelta(state, ending(hazard));
    return { delta, dodged: state.stats.dodges - dodges, hit: hurts(state) };
  };
  {
    const r = dodgeCase(seed, outsideOf, 0);
    rule(r.hit === 0 && r.delta === 25 && r.dodged === 1, 'уклонение (не задет, не в неуязвимости) даёт +25', seed,
      `получено ${sign(r.delta)}, dodges ${sign(r.dodged)}`);
  }
  {
    const r = dodgeCase(seed, outsideOf, 1);
    rule(r.delta === 0 && r.dodged === 0, 'в неуязвимости уклонение не засчитывается', seed, `получено ${sign(r.delta)}`);
  }
  {
    const r = dodgeCase(seed, centreOf, 1);
    rule(r.hit === 0 && r.delta === 0 && r.dodged === 0, 'неуязвимый паук в зоне не получает ни урона, ни +25', seed,
      `получено ${sign(r.delta)}`);
  }
  {
    const r = dodgeCase(seed, centreOf, 0);
    rule(r.hit === 1 && r.delta === -10 && r.dodged === 0, 'задетый паук получает −10 и не получает +25', seed,
      `получено ${sign(r.delta)}`);
  }
  passed.push(`hazards: seed=${seed}: warning без урона, active −10, неуязвимость, +25 только за чистое уклонение`);
}

// 5. World constants: wave length and a non-decreasing night intensity on 0..180.
assert.equal(WAVE_LENGTH, 18, `правило: WAVE_LENGTH === 18, получено ${WAVE_LENGTH}`);
let previous = -Infinity;
for (let i = 0; i <= 18000; i++) {
  const t = i / 100;
  const value = intensity(t);
  assert.ok(Number.isFinite(value), `правило: intensity(${t}) конечна, получено ${value}`);
  assert.ok(value >= previous - 1e-12, `правило: intensity(t) не убывает на 0..180; intensity(${t})=${value} < ${previous}`);
  previous = value;
}
passed.push('hazards: WAVE_LENGTH === 18, intensity(t) не убывает на 0..180');

for (const line of passed) console.log(`PASS ${line}`);
console.log('REGRESSION OK');
