import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, stepGame, serializeProgress, readProgress,
} from '../src/game/model.js';

const input = (overrides = {}) => ({
  moveX: 0, moveY: 0, aimX: 640, aimY: 360,
  webHeld: false, dashPressed: false, ...overrides,
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const emptyProgress = () => ({ version: 1, bestScore: 0, bestSurvival: 0, wins: 0 });

function assertFiniteTree(value, path = 'state') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} must be finite, got ${value}`);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertFiniteTree(child, `${path}.${key}`);
    }
  }
}

function assertState(state) {
  assert.equal(state.version, 1);
  assert.ok(['playing', 'won', 'lost'].includes(state.status));
  for (const key of ['seed', 'rng', 'time', 'duration', 'score', 'wave']) {
    assert.equal(typeof state[key], 'number', key);
  }
  for (const key of ['x', 'y', 'vx', 'vy', 'radius', 'hp', 'silk', 'invulnerable']) {
    assert.equal(typeof state.player[key], 'number', `player.${key}`);
  }
  for (const key of ['anchors', 'flies', 'hazards', 'particles', 'events']) {
    assert.ok(Array.isArray(state[key]), key);
  }
  assert.equal(typeof state.stats.flies, 'number');
  assert.equal(typeof state.stats.dodges, 'number');
  assert.ok(state.player.silk >= 0 && state.player.silk <= 100);
  assertFiniteTree(state);
  assert.deepEqual(clone(state), state, 'state must survive a JSON round trip');
}

// Only documented, public state fields are prepared. No private timers or balance constants.
function quietGame(seed = 17) {
  const state = createGame({ seed });
  state.player.x = 640;
  state.player.y = 360;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.invulnerable = 0;
  state.web = null;
  state.flies = [];
  state.hazards = [];
  state.particles = [];
  state.events = [];
  return state;
}

function assertProgress(value) {
  assert.deepEqual(Object.keys(value).sort(), ['bestScore', 'bestSurvival', 'version', 'wins']);
  assert.equal(value.version, 1);
  for (const key of ['bestScore', 'bestSurvival', 'wins']) {
    assert.equal(typeof value[key], 'number', key);
    assert.ok(Number.isFinite(value[key]) && value[key] >= 0, key);
  }
}

test('initial state exposes the agreed defaults and is JSON-compatible', () => {
  const state = createGame();
  assertState(state);
  assert.equal(state.status, 'playing');
  assert.equal(state.time, 0);
  assert.equal(state.player.hp, 3);
  assert.equal(state.player.silk, 100);
  assert.equal(state.duration, 180);
  assert.equal(state.web, null);
});

test('same seed and input sequence reproduce every step, including events', () => {
  const a = createGame({ seed: 58231 });
  const b = createGame({ seed: 58231 });
  assert.deepEqual(a, b);
  for (let frame = 0; frame < 2400; frame += 1) {
    const command = input({
      moveX: Math.sin(frame / 37), moveY: Math.cos(frame / 53),
      aimX: 640 + 500 * Math.sin(frame / 71),
      aimY: 360 + 300 * Math.cos(frame / 47),
      webHeld: frame % 120 < 80, dashPressed: frame % 91 === 0,
    });
    const dt = frame % 7 === 0 ? 0.033 : 1 / 60;
    assert.equal(stepGame(a, { ...command }, dt), undefined);
    stepGame(b, { ...command }, dt);
    assert.deepEqual(a, b, `determinism at frame ${frame}`);
    assertState(a);
  }
});

test('independent games do not share mutable public state', () => {
  const a = createGame({ seed: 8 });
  const b = createGame({ seed: 8 });
  const before = clone(b);
  a.player.hp = 1;
  a.anchors.push({ id: 'test-only', x: 100, y: 100 });
  a.events.push({ type: 'web', x: 100, y: 100 });
  assert.deepEqual(b, before);
});

test('dt is clamped to 0..0.033 seconds, not used as an unbounded elapsed time', () => {
  for (const dt of [-100, -0.01, 0, 0.001, 1 / 60, 0.033, 1, 1e6]) {
    const state = quietGame();
    const before = state.time;
    stepGame(state, input({ moveX: 1, moveY: -1 }), dt);
    const expected = Math.min(0.033, Math.max(0, dt));
    assert.ok(Math.abs(state.time - before - expected) < 1e-10, `dt=${dt}`);
    assertState(state);
  }
  const large = quietGame();
  const capped = quietGame();
  stepGame(large, input({ moveX: 1, dashPressed: true }), 500);
  stepGame(capped, input({ moveX: 1, dashPressed: true }), 0.033);
  assert.deepEqual(large, capped, 'oversized dt must behave like the maximum step');
});

test('finite public values survive sustained legal input and extreme finite dt', () => {
  for (const seed of [1, 47, 987654]) {
    const state = createGame({ seed });
    for (let frame = 0; frame < 1800; frame += 1) {
      const dt = [0, -1, 1 / 60, 0.033, Number.MAX_VALUE][frame % 5];
      stepGame(state, input({
        moveX: frame % 2 ? -1 : 1, moveY: frame % 3 ? 1 : -1,
        aimX: frame % 2 ? 0 : 1280, aimY: frame % 3 ? 720 : 0,
        webHeld: frame % 5 !== 0, dashPressed: frame % 11 === 0,
      }), dt);
      assertState(state);
    }
  }
});

test('web chooses the nearest existing anchor to aim and releases on key-up', () => {
  const state = quietGame();
  state.anchors = [
    { id: 'farther', x: 720, y: 300 },
    { id: 'nearest', x: 640, y: 300 },
    { id: 'outside', x: 100, y: 100 },
  ];
  stepGame(state, input({ aimX: 645, aimY: 300, webHeld: true }), 1 / 60);
  assert.ok(state.web, 'holding web near an anchor attaches a thread');
  assert.equal(state.web.anchorX, 640);
  assert.equal(state.web.anchorY, 300);
  assert.ok(Number.isFinite(state.web.length) && state.web.length >= 0);
  assert.equal(state.events.filter((event) => event.type === 'web').length, 1);
  stepGame(state, input(), 1 / 60);
  assert.equal(state.web, null, 'releasing web detaches the thread');
  assertState(state);
});

test('web cannot attach when no anchor lies within 180 pixels of aim', () => {
  for (const anchors of [[], [{ id: 'distant', x: 900, y: 600 }]]) {
    const state = quietGame();
    state.anchors = anchors;
    stepGame(state, input({ aimX: 100, aimY: 100, webHeld: true }), 1 / 60);
    assert.equal(state.web, null);
    assert.equal(state.events.some((event) => event.type === 'web'), false);
  }
});

test('player stays inside the logical field at each outward-facing boundary', () => {
  for (const [xSide, ySide] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const state = quietGame();
    const radius = state.player.radius;
    state.player.x = xSide < 0 ? radius : 1280 - radius;
    state.player.y = ySide < 0 ? radius : 720 - radius;
    state.player.vx = xSide * 1000;
    state.player.vy = ySide * 1000;
    for (let frame = 0; frame < 60; frame += 1) {
      stepGame(state, input({ moveX: xSide, moveY: ySide }), 0.033);
      assert.ok(state.player.x >= radius - 1e-8);
      assert.ok(state.player.x <= 1280 - radius + 1e-8);
      assert.ok(state.player.y >= radius - 1e-8);
      assert.ok(state.player.y <= 720 - radius + 1e-8);
      assertState(state);
    }
  }
});

for (const [status, eventType] of [['won', 'win'], ['lost', 'lose']]) {
  test(`${status}: one terminal event, then no simulation or repeated events`, () => {
    const state = quietGame();
    if (status === 'won') state.time = state.duration - 0.01;
    else state.player.hp = 0;
    stepGame(state, input(), 0.033);
    assert.equal(state.status, status);
    assert.equal(state.events.filter((event) => event.type === eventType).length, 1);
    assert.equal(state.events.filter((event) => event.type === (status === 'won' ? 'lose' : 'win')).length, 0);
    const snapshot = clone({ ...state, events: [] });
    for (let frame = 0; frame < 10; frame += 1) {
      stepGame(state, input({ moveX: 1, webHeld: true, dashPressed: true }), 1);
      assert.deepEqual(state.events, [], 'events describe this step only');
      assert.deepEqual({ ...state, events: [] }, snapshot, 'terminal simulation must stay frozen');
    }
  });
}

test('serialization uses only the versioned progress contract and does not mutate state', () => {
  for (const status of ['playing', 'lost', 'won']) {
    const state = quietGame();
    state.status = status;
    state.score = 321;
    state.time = status === 'won' ? state.duration : 12.5;
    const before = clone(state);
    const text = serializeProgress(state);
    assert.equal(typeof text, 'string');
    const expected = { version: 1, bestScore: 321, bestSurvival: state.time, wins: status === 'won' ? 1 : 0 };
    assert.deepEqual(JSON.parse(text), expected);
    assert.deepEqual(readProgress(text), expected);
    assert.deepEqual(state, before);
  }
});

test('valid saved records round-trip without losing values', () => {
  const saved = { version: 1, bestScore: 1234, bestSurvival: 87.25, wins: 3 };
  assert.deepEqual(readProgress(JSON.stringify(saved)), saved);
});

test('broken JSON and wrong top-level shapes safely produce zero progress', () => {
  for (const text of ['', '{', 'not json', 'null', '[]', '42', 'true', '"text"', '{}', '{"version":99}']) {
    assert.deepEqual(readProgress(text), emptyProgress(), `save: ${text}`);
  }
});

test('invalid progress values cannot leak negative, nonnumeric or infinite numbers', () => {
  for (const bad of [-1, null, '12', true, [], {}, 'Infinity']) {
    const text = JSON.stringify({ version: 1, bestScore: bad, bestSurvival: bad, wins: bad });
    assert.deepEqual(readProgress(text), emptyProgress(), `invalid value: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(readProgress('{"version":1,"bestScore":1e999,"bestSurvival":-1e999,"wins":1e999}'), emptyProgress());
  for (const key of ['bestScore', 'bestSurvival', 'wins']) {
    const mixed = { version: 1, bestScore: 10, bestSurvival: 20, wins: 1, [key]: -5 };
    const restored = readProgress(JSON.stringify(mixed));
    assertProgress(restored);
    assert.equal(restored[key], 0);
  }
});
