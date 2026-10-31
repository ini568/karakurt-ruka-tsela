// Balance simulation: three bots x 50 seeds on the pure model (no DOM, no rendering).
//   idle   - stands still;
//   dodger - leaves a warning zone after a human-like reaction delay;
//   hunter - dodges the same way and, when calm, flies to the nearest fly.
// Prints win rate, median lifetime and median score per bot, plus threat-free
// stretches and how the attack pressure grows over the night.
// Usage: node research/back/sim.mjs
import { createGame, stepGame } from '../../src/game/model.js';

const SEED_COUNT = 50;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);
const DT = 1 / 60;
const REACTION = 0.25; // seconds between a warning appearing and the bot starting to move
const WINDOWS = [[0, 30], [30, 60], [60, 90], [90, 120], [120, 150], [150, 180]];
const W = 1280, H = 720;

const median = list => {
  if (!list.length) return 0;
  const a = [...list].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const inRect = (x, y, h, pad) => x > h.x - pad && x < h.x + h.w + pad && y > h.y - pad && y < h.y + h.h + pad;

/** Nearest point outside the hazard rectangle (with margin) that stays inside the field. */
function escapePoint(p, hazard) {
  const margin = p.radius + 65;
  const candidates = [
    { x: hazard.x - margin, y: p.y }, { x: hazard.x + hazard.w + margin, y: p.y },
    { x: p.x, y: hazard.y - margin }, { x: p.x, y: hazard.y + hazard.h + margin },
  ].filter(c => c.x >= p.radius && c.x <= W - p.radius && c.y >= p.radius && c.y <= H - p.radius);
  candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  return candidates[0] || null;
}

const steer = (p, t) => t ? {
  moveX: clamp((t.x - p.x) / 70 - p.vx / 180, -1, 1),
  moveY: clamp((t.y - p.y) / 70 - p.vy / 180, -1, 1),
} : {};

/** mode: 'idle' | 'dodger' | 'hunter'. Returns the finished run summary. */
function play(seed, mode) {
  const s = createGame({ seed });
  let escape = null, seenId = null, seenAt = 0, hurts = 0, steps = 0;
  let calm = 0, longestCalm = 0;
  while (s.status === 'playing' && steps++ < 12000) {
    const p = s.player;
    let input = {};
    const hazard = s.hazards.find(h => h.phase === 'warning' || h.phase === 'active');
    if (mode !== 'idle') {
      if (hazard && hazard.id !== seenId) { seenId = hazard.id; seenAt = s.time; escape = null; }
      if (hazard) {
        // The bot reacts late, like a person: nothing happens until REACTION has passed.
        if (s.time - seenAt >= REACTION) {
          if (!escape) escape = escapePoint(p, hazard);
          input = steer(p, escape);
        }
      } else {
        escape = null;
        if (mode === 'hunter' && s.flies.length) {
          let best = null, bd = Infinity;
          for (const f of s.flies) {
            const d = Math.hypot(f.x - p.x, f.y - p.y);
            if (d < bd) { bd = d; best = f; }
          }
          input = steer(p, best);
        }
      }
    }
    stepGame(s, input, DT);
    hurts += s.events.filter(e => e.type === 'hurt').length;
    if (s.hazards.length === 0 && s.status === 'playing') { calm += DT; longestCalm = Math.max(longestCalm, calm); } else calm = 0;
  }
  return { won: s.status === 'won', time: s.time, score: s.score, hp: s.player.hp, hurts,
    dodges: s.stats.dodges, flies: s.stats.flies, longestCalm };
}

/** Attack pressure over the night, observed with an invulnerable wanderer. */
function pressure(seed) {
  const s = createGame({ seed });
  const seen = new Map();
  for (let i = 0; i < 180 * 60 && s.status === 'playing'; i++) {
    s.player.invulnerable = 100;
    stepGame(s, { moveX: Math.sin(i / 50), moveY: Math.cos(i / 70) }, DT);
    for (const h of s.hazards) {
      if (!seen.has(h.id) && h.phase === 'warning') seen.set(h.id, { t: s.time, warn: h.remaining + DT, area: h.w * h.h });
    }
  }
  return [...seen.values()];
}

const pad = (v, n) => String(v).padEnd(n);
const rows = [];
const results = {};
for (const [mode, label] of [['idle', 'стоит на месте'], ['dodger', 'уходит от предупреждения'], ['hunter', 'уходит и ловит мух']]) {
  const runs = SEEDS.map(seed => play(seed, mode));
  results[mode] = runs;
  rows.push({
    label, wins: runs.filter(r => r.won).length,
    life: median(runs.map(r => r.time)), score: median(runs.map(r => r.score)),
    hurts: median(runs.map(r => r.hurts)), dodges: median(runs.map(r => r.dodges)),
    calm: median(runs.map(r => r.longestCalm)), calmMax: Math.max(...runs.map(r => r.longestCalm)),
  });
}

console.log(`Симуляция: ${SEED_COUNT} сидов (1..${SEED_COUNT}), шаг 1/60 с, реакция ботов ${REACTION} с`);
console.log([pad('бот', 28), pad('победы', 10), pad('доля', 7), pad('жизнь, с', 10), pad('счёт', 7),
  pad('удары', 7), pad('уклон.', 7), pad('пауза, с', 9)].join(''));
for (const r of rows) {
  console.log([pad(r.label, 28), pad(`${r.wins}/${SEED_COUNT}`, 10), pad(`${Math.round(r.wins / SEED_COUNT * 100)}%`, 7),
    pad(r.life.toFixed(2), 10), pad(Math.round(r.score), 7), pad(r.hurts, 7), pad(r.dodges, 7),
    pad(r.calm.toFixed(2), 9)].join(''));
}
console.log(`Самая длинная пауза без угроз за партию: медиана умелых ботов ${rows[2].calm.toFixed(2)} с, максимум ${Math.max(rows[1].calmMax, rows[2].calmMax).toFixed(2)} с`);

// Difficulty growth: attacks per minute, mean warning and zone area per 30 s window.
const all = SEEDS.flatMap(pressure);
console.log('Нарастание сложности (среднее по сидам):');
console.log([pad('окно, с', 10), pad('атак/мин', 10), pad('предупр., с', 13), pad('площадь, px2', 13)].join(''));
for (const [a, b] of WINDOWS) {
  const list = all.filter(x => x.t >= a && x.t < b);
  const mean = k => list.length ? list.reduce((n, x) => n + x[k], 0) / list.length : 0;
  console.log([pad(`${a}-${b}`, 10), pad((list.length * 60 / (b - a) / SEED_COUNT).toFixed(1), 10),
    pad(mean('warn').toFixed(2), 13), pad(Math.round(mean('area')), 13)].join('').trimEnd());
}

// Checks of the expectations; a failure sets a non-zero exit code.
const idleLosses = results.idle.filter(r => !r.won).length;
const failures = [];
if (idleLosses !== SEED_COUNT) failures.push(`неподвижный бот выиграл ${SEED_COUNT - idleLosses} партий`);
if (rows[2].wins === 0) failures.push('умелый бот не выиграл ни одной партии');
if (rows[1].calmMax > 6 || rows[2].calmMax > 6) failures.push('есть пауза без угроз длиннее 6 с');
if (failures.length) { console.log('SIM FAIL: ' + failures.join('; ')); process.exitCode = 1; } else console.log('SIM OK');
