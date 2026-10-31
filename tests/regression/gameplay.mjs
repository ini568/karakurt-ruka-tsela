// Gameplay regressions for the public model contract (src/game/model.js).
// Run standalone: node tests/regression/gameplay.mjs
import assert from 'node:assert/strict';
import { createGame, stepGame } from '../../src/game/model.js';

const WIDTH = 1280;
const HEIGHT = 720;
const SEEDS = [1, 47, 987654];
const STEP = 1 / 60;
const passed = [];

// Independent input generator so the model RNG is never touched by the test.
function inputRandom(seed) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    value = (Math.imul(value, 1103515245) + 12345) >>> 0;
    return value / 4294967296;
  };
}

function assertFiniteDeep(value, path) {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} должно быть конечным числом, получено ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteDeep(item, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFiniteDeep(item, `${path}.${key}`);
  }
}

function assertPlayerInField(state, where) {
  const p = state.player;
  assert.ok(p.x >= p.radius - 1e-9 && p.x <= WIDTH - p.radius + 1e-9, `player.x=${p.x} вне поля, ${where}`);
  assert.ok(p.y >= p.radius - 1e-9 && p.y <= HEIGHT - p.radius + 1e-9, `player.y=${p.y} вне поля, ${where}`);
}

const count = (events, type) => events.filter(event => event.type === type).length;

/** One step with checks that state.events describes exactly this step and nothing older. */
function checkedStep(state, input, dt, where) {
  const before = {
    status: state.status, hp: state.player.hp, flies: state.stats.flies, wave: state.wave,
    warnings: new Set(state.hazards.filter(h => h.phase === 'warning').map(h => h.id)),
  };
  // A leftover from an earlier step must never survive into the next outbox.
  state.events.push({ type: 'stale-marker', x: 0, y: 0 });
  const result = stepGame(state, input, dt);
  assert.equal(result, undefined, `stepGame ничего не возвращает, ${where}`);
  assert.ok(Array.isArray(state.events), `state.events — массив, ${where}`);
  assert.equal(count(state.events, 'stale-marker'), 0, `события прошлого шага не должны оставаться в state.events, ${where}`);
  const events = state.events;
  for (const event of events) {
    assert.equal(typeof event.type, 'string', `тип события — строка, ${where}`);
    assert.ok(Number.isFinite(event.x) && Number.isFinite(event.y), `координаты события ${event.type} конечны, ${where}`);
  }
  const hpLoss = before.hp - state.player.hp;
  assert.equal(count(events, 'hurt'), hpLoss, `число событий hurt (${count(events, 'hurt')}) равно потере здоровья за шаг (${hpLoss}), ${where}`);
  assert.equal(count(events, 'catch'), state.stats.flies - before.flies, `события catch соответствуют мухам, пойманным на этом шаге, ${where}`);
  assert.equal(count(events, 'wave'), state.wave === before.wave ? 0 : 1, `событие wave только при смене волны, ${where}`);
  const activated = state.hazards.filter(h => before.warnings.has(h.id) && h.phase !== 'warning').length;
  assert.equal(count(events, 'attack'), activated, `события attack только для атак, начавшихся на этом шаге, ${where}`);
  const ended = before.status === 'playing' && state.status !== 'playing';
  assert.equal(count(events, 'win'), ended && state.status === 'won' ? 1 : 0, `событие win только на шаге победы, ${where}`);
  assert.equal(count(events, 'lose'), ended && state.status === 'lost' ? 1 : 0, `событие lose только на шаге поражения, ${where}`);
  return events;
}

function randomCommand(next) {
  const roll = next();
  // Rare garbage values come from the same trust boundary as real client input.
  const garbage = [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, undefined];
  const pick = () => garbage[Math.floor(next() * garbage.length)];
  return {
    moveX: roll < 0.02 ? pick() : next() * 2 - 1,
    moveY: roll < 0.02 ? pick() : next() * 2 - 1,
    aimX: roll > 0.98 ? pick() : next() * WIDTH,
    aimY: roll > 0.98 ? pick() : next() * HEIGHT,
    webHeld: next() < 0.45,
    dashPressed: next() < 0.04,
  };
}

function frozenAfterEnd(state, where) {
  const frozen = structuredClone({ ...state, events: [] });
  const command = { moveX: 1, moveY: 1, aimX: 640, aimY: 75, webHeld: true, dashPressed: true };
  for (const dt of [STEP, 0.033, 5, NaN, Infinity, 0]) {
    stepGame(state, command, dt);
    assert.deepEqual(state.events, [], `после ${state.status} шаг не создаёт событий, ${where}`);
    assert.deepEqual(state, frozen, `после ${state.status} модель не симулируется и не начисляет очков, ${where}`);
  }
}

// 1. 180 seconds of random input on the contract seeds: no NaN/Infinity, bounded field, honest outbox.
for (const seed of SEEDS) {
  for (const immortal of [false, true]) {
    const state = createGame({ seed });
    assertFiniteDeep(state, `createGame(${seed})`);
    const next = inputRandom(seed + (immortal ? 7 : 0));
    let command = randomCommand(next);
    let elapsed = 0;
    let steps = 0;
    while (state.status === 'playing' && elapsed < 200 && steps < 20000) {
      steps++;
      if (next() < 0.07) command = randomCommand(next);
      const r = next();
      const dt = r < 0.01 ? NaN : r < 0.02 ? 0 : r < 0.1 ? next() * 0.05 : STEP;
      if (Number.isFinite(dt)) elapsed += dt;
      // The immortal run keeps a valid hp value so the whole 180 s are exercised with random input.
      if (immortal && state.player.hp < 2) state.player.hp = 3;
      const where = `seed=${seed}${immortal ? ' (полная длительность)' : ''}, шаг ${steps}, t=${state.time.toFixed(3)}`;
      checkedStep(state, command, dt, where);
      assertFiniteDeep(state, `state, ${where}`);
      assertPlayerInField(state, where);
      assert.ok(state.time >= 0 && state.time <= state.duration, `время в пределах раунда, ${where}`);
      assert.ok(state.player.silk >= 0 && state.player.silk <= 100, `шёлк в пределах 0..100, ${where}`);
      assert.ok(state.player.hp >= 0 && state.player.hp <= 3, `здоровье в пределах 0..3, ${where}`);
      assert.ok(state.hazards.length <= 4 && state.flies.length <= 14 && state.particles.length <= 120, `число сущностей ограничено, ${where}`);
    }
    assert.notEqual(state.status, 'playing', `партия seed=${seed} должна завершиться не позже 180 с`);
    if (immortal) {
      assert.equal(state.status, 'won', `при восстановленном здоровье seed=${seed} доходит до победы`);
      assert.equal(state.time, state.duration);
      assert.equal(state.duration, 180, 'раунд длится 180 с');
    }
    frozenAfterEnd(state, `seed=${seed}`);
  }
  passed.push(`gameplay: seed=${seed}: 180 с случайного ввода без NaN, события текущего шага, финал заморожен`);
}

// 2. Rejected steps produce an empty outbox and do not replay earlier events.
{
  const state = createGame({ seed: 47 });
  stepGame(state, { webHeld: true, aimX: 640, aimY: 75 }, STEP);
  assert.equal(count(state.events, 'web'), 1, 'зацепление паутины даёт событие web на своём шаге');
  stepGame(state, { webHeld: true, aimX: 640, aimY: 75 }, STEP);
  assert.equal(count(state.events, 'web'), 0, 'удержание той же нити не повторяет событие web');
  for (const dt of [0, NaN, -1]) {
    state.events.push({ type: 'catch', x: 1, y: 1 });
    stepGame(state, {}, dt);
    assert.deepEqual(state.events, [], `отклонённый шаг dt=${dt} очищает события`);
  }
  passed.push('gameplay: события не повторяются при удержании и отклонённых шагах');
}

// Helpers for the scoring rules: a real hazard shape from the model, then a twin without it.
function realHazard(seed) {
  const state = createGame({ seed });
  for (let i = 0; i < 60 * 30; i++) {
    state.flies = [];
    stepGame(state, {}, STEP);
    const hazard = state.hazards.find(h => h.phase === 'warning');
    if (hazard) return { state, hazard: structuredClone(hazard) };
  }
  assert.fail(`за 30 с seed=${seed} модель не создала ни одного предупреждения`);
}

function prepared(seed) {
  const { state, hazard } = realHazard(seed);
  state.flies = [];
  state.hazards = [];
  state.particles = [];
  state.web = null;
  state.score = 1000;
  Object.assign(state.player, { vx: 0, vy: 0, invulnerable: 0, hp: 3, silk: 100 });
  return { state, hazard };
}

function scoreDelta(state, twin, input = {}, dt = STEP) {
  stepGame(state, input, dt);
  stepGame(twin, input, dt);
  return state.score - twin.score;
}

function outsidePoint(hazard, radius) {
  const gap = radius + 25;
  const cy = Math.max(radius, Math.min(HEIGHT - radius, hazard.y + hazard.h / 2));
  const cx = Math.max(radius, Math.min(WIDTH - radius, hazard.x + hazard.w / 2));
  const candidates = [
    { x: hazard.x + hazard.w + gap, y: cy }, { x: hazard.x - gap, y: cy },
    { x: cx, y: hazard.y + hazard.h + gap }, { x: cx, y: hazard.y - gap },
  ].filter(p => p.x >= radius && p.x <= WIDTH - radius && p.y >= radius && p.y <= HEIGHT - radius);
  assert.ok(candidates.length > 0, 'есть точка рядом с зоной атаки внутри поля');
  return candidates[0];
}

// 3. Scoring rules from the contract.
{
  // +5 per survived second.
  const state = createGame({ seed: 1 });
  for (let i = 0; i < 60 * 30; i++) {
    state.hazards = [];
    state.flies = [];
    stepGame(state, {}, STEP);
    assert.equal(count(state.events, 'hurt'), 0);
  }
  assert.ok(state.time > 29.9, `время выживания идёт, t=${state.time}`);
  const expected = 5 * state.time;
  assert.ok(Math.abs(state.score - expected) <= 5,
    `правило очков: выживание даёт +5/с; за ${state.time.toFixed(2)} с ожидалось ≈${expected.toFixed(0)}, получено ${state.score}`);
  passed.push('gameplay: очки +5/с выживания');
}

for (const seed of SEEDS) {
  // +25 for a dodged attack.
  {
    const { state, hazard } = prepared(seed);
    const point = outsidePoint(hazard, state.player.radius);
    Object.assign(state.player, point);
    const twin = structuredClone(state);
    state.hazards = [{ ...hazard, phase: 'active', remaining: 0.001 }];
    const dodges = state.stats.dodges;
    const delta = scoreDelta(state, twin);
    assert.equal(count(state.events, 'hurt'), 0, `игрок вне зоны не получает удар, seed=${seed}`);
    assert.equal(delta, 25, `правило очков: уклонение даёт +25, получено ${delta >= 0 ? '+' : ''}${delta}, seed=${seed}`);
    assert.equal(state.stats.dodges - dodges, 1, `уклонение засчитано в stats.dodges, seed=${seed}`);
  }
  // −10 for a hit, then invulnerability blocks repeated hits.
  {
    const { state, hazard } = prepared(seed);
    const centre = {
      x: Math.max(state.player.radius, Math.min(WIDTH - state.player.radius, hazard.x + hazard.w / 2)),
      y: Math.max(state.player.radius, Math.min(HEIGHT - state.player.radius, hazard.y + hazard.h / 2)),
    };
    Object.assign(state.player, centre);
    const twin = structuredClone(state);
    const active = { ...hazard, phase: 'active', remaining: 0.9 };
    state.hazards = [active];
    const delta = scoreDelta(state, twin);
    assert.equal(count(state.events, 'hurt'), 1, `игрок в активной зоне получает удар, seed=${seed}`);
    assert.equal(delta, -10, `правило очков: удар даёт −10, получено ${delta >= 0 ? '+' : ''}${delta}, seed=${seed}`);
    assert.equal(state.player.hp, 2, `удар снимает одну единицу здоровья, seed=${seed}`);
    assert.ok(state.player.invulnerable > 0, `после удара включается неуязвимость, seed=${seed}`);
    let guard = 0;
    // Invulnerability decays inside the step, so only steps that end with time left are protected.
    while (state.player.invulnerable > STEP + 1e-9 && guard++ < 600) {
      // Keep the spider inside a live attack for the whole invulnerability window.
      Object.assign(state.player, centre, { vx: 0, vy: 0 });
      const live = state.hazards.find(h => h.id === active.id && h.phase === 'active');
      if (live) live.remaining = Math.max(live.remaining, 0.5);
      else state.hazards = [{ ...hazard, id: `${hazard.id}-again-${guard}`, phase: 'active', remaining: 0.5 }];
      state.flies = [];
      stepGame(state, {}, STEP);
      assert.equal(count(state.events, 'hurt'), 0, `во время неуязвимости нет повторного удара, seed=${seed}, шаг ${guard}`);
      assert.equal(state.player.hp, 2, `во время неуязвимости здоровье не падает, seed=${seed}`);
    }
    assert.ok(guard < 600, `неуязвимость конечна, seed=${seed}`);
    // After invulnerability expires a fresh attack hits again, so the check above is not vacuous.
    state.hazards = [];
    for (let i = 0; i < 5 && state.player.invulnerable > 0; i++) { state.flies = []; stepGame(state, {}, STEP); }
    assert.equal(state.player.invulnerable, 0, `неуязвимость заканчивается, seed=${seed}`);
    Object.assign(state.player, centre, { vx: 0, vy: 0 });
    state.hazards = [{ ...hazard, id: `${hazard.id}-fresh`, phase: 'active', remaining: 0.5 }];
    stepGame(state, {}, STEP);
    assert.equal(count(state.events, 'hurt'), 1, `после окончания неуязвимости новая атака снова наносит удар, seed=${seed}`);
    assert.equal(state.player.hp, 1);
  }
  // Flies: +100 as before.
  {
    const { state } = prepared(seed);
    const twin = structuredClone(state);
    state.flies = [{ id: 'test-fly', x: state.player.x, y: state.player.y, radius: 9 }];
    const caught = state.stats.flies;
    const delta = scoreDelta(state, twin);
    assert.equal(count(state.events, 'catch'), 1, `муха под пауком поймана, seed=${seed}`);
    assert.equal(state.stats.flies - caught, 1);
    assert.equal(delta, 100, `правило очков: муха даёт +100, получено ${delta >= 0 ? '+' : ''}${delta}, seed=${seed}`);
  }
  // +500 for the win, awarded once; then the state is frozen.
  {
    const { state } = prepared(seed);
    state.time = state.duration - 0.005;
    const twin = structuredClone(state);
    twin.duration = state.duration + 1;
    const delta = scoreDelta(state, twin, {}, state.duration - state.time);
    assert.equal(state.status, 'won', `последний шаг даёт победу, seed=${seed}`);
    assert.equal(twin.status, 'playing');
    assert.equal(count(state.events, 'win'), 1);
    assert.equal(delta, 500, `правило очков: победа даёт +500, получено ${delta >= 0 ? '+' : ''}${delta}, seed=${seed}`);
    frozenAfterEnd(state, `победа seed=${seed}`);
  }
  // Defeat on the hit step; lost is frozen too.
  {
    const { state, hazard } = prepared(seed);
    state.player.hp = 1;
    Object.assign(state.player, {
      x: Math.max(state.player.radius, Math.min(WIDTH - state.player.radius, hazard.x + hazard.w / 2)),
      y: Math.max(state.player.radius, Math.min(HEIGHT - state.player.radius, hazard.y + hazard.h / 2)),
    });
    state.hazards = [{ ...hazard, phase: 'active', remaining: 0.5 }];
    stepGame(state, {}, STEP);
    assert.equal(state.status, 'lost', `последний удар завершает партию поражением, seed=${seed}`);
    assert.equal(state.player.hp, 0);
    assert.equal(count(state.events, 'lose'), 1);
    assert.equal(state.web, null, 'после поражения нити нет');
    frozenAfterEnd(state, `поражение seed=${seed}`);
  }
  passed.push(`gameplay: seed=${seed}: +25 уклонение, −10 удар и неуязвимость, +100 муха, +500 победа, финалы заморожены`);
}

for (const line of passed) console.log(`PASS ${line}`);
console.log('REGRESSION OK');
