const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// Numerical Recipes LCG: uint32 arithmetic is reproducible across JS engines.
function random(state) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}

// Stateless hash of (seed, slot) for the attack plan, so the plan does not consume state.rng.
function hash01(seed, k) {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(k + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const WAVE_LENGTH = 18;
const MAX_WAVE = 10;
const FADE = 0.32;
const ACTIVE = { slap: 0.24, glass: 1.05, sweep: 0.6 };
const FIRST_ATTACK = 2;
const WAVE_BREATH = 1; // no warning starts in the first second of a wave (banner + sound)

// Night intensity 0..1: piecewise linear through phase knots, continuous, steeper mid-night.
// Phases: Сумерки 0–36 (waves 1–2), Полночь 36–90 (3–5), Глубокая ночь 90–144 (6–8), Рассвет 144–180 (9–10).
const KNOTS = [[0, 0], [36, 0.2], [90, 0.55], [144, 0.85], [180, 1]];
export function intensity(t) {
  if (!(t > 0)) return 0;
  for (let i = 1; i < KNOTS.length; i++) {
    const [t1, v1] = KNOTS[i];
    const [t0, v0] = KNOTS[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return 1;
}
const warningTime = t => 1.5 - 0.55 * intensity(t); // 1.50 s → 0.95 s
const calmTime = t => 1.7 - 1.15 * intensity(t); // 1.70 s → 0.55 s of empty field after a fade

function kindFor(seed, k, t, prev1, prev2) {
  if (t < WAVE_LENGTH) return k % 2 ? 'glass' : 'slap'; // wave 1 teaches the two basic strikes
  const sweep = t < 36 ? 0.25 : t < 90 ? 0.3 : t < 144 ? 0.4 : 0.45;
  const roll = hash01(seed, k);
  let kind = roll < sweep ? 'sweep' : roll < sweep + (1 - sweep) / 2 ? 'slap' : 'glass';
  // Never three equal strikes in a row: the pattern stays readable but not predictable.
  if (kind === prev1 && kind === prev2) kind = { slap: 'glass', glass: 'sweep', sweep: 'slap' }[kind];
  return kind;
}

/** Attack plan as a pure function of seed: start times follow the previous attack's real length. */
function planAt(seed, time) {
  let t = FIRST_ATTACK, prev1 = null, prev2 = null;
  for (let k = 0; k < 400; k++) {
    const kind = kindFor(seed, k, t, prev1, prev2);
    const slot = { k, t, kind, warning: warningTime(t) };
    let next = t + slot.warning + ACTIVE[kind] + FADE + calmTime(t);
    const local = next % WAVE_LENGTH;
    if (local < WAVE_BREATH) next += WAVE_BREATH - local;
    if (next > time) return slot;
    prev2 = prev1; prev1 = kind; t = next;
  }
  return null;
}

const WIDTH = 1280;
const HEIGHT = 720;
const INVULNERABLE = 1.3;
const MAX_HAZARDS = 4;
const MAX_FLIES = 14;
const MAX_PARTICLES = 120;

/** Attack rectangle aimed at the spider's position when the warning starts. */
function zoneFor(state, kind, t) {
  const p = state.player, k = intensity(t);
  const jitter = () => (random(state) - 0.5) * 50;
  if (kind === 'sweep') {
    const band = 125 + 45 * k; // 125 → 170 px wide band across the whole field
    if (random(state) < 0.5) {
      const y = clamp(p.y + jitter() - band / 2, 0, HEIGHT - band);
      return { x: 0, y, w: WIDTH, h: band };
    }
    const x = clamp(p.x + jitter() - band / 2, 0, WIDTH - band);
    return { x, y: 0, w: band, h: HEIGHT };
  }
  const size = kind === 'slap' ? 170 + 60 * k : 200 + 50 * k; // slap 170 → 230, glass 200 → 250
  const w = size, h = kind === 'glass' ? size * 0.9 : size;
  return {
    x: clamp(p.x + jitter() - w / 2, 0, WIDTH - w),
    y: clamp(p.y + jitter() - h / 2, 0, HEIGHT - h), w, h,
  };
}

/** Circle (spider) against axis-aligned rectangle (attack zone). */
function overlaps(p, h) {
  const cx = clamp(p.x, h.x, h.x + h.w), cy = clamp(p.y, h.y, h.y + h.h);
  return (p.x - cx) ** 2 + (p.y - cy) ** 2 < p.radius ** 2;
}

/** Bounded particle request; non-finite or huge counts cannot grow state.particles. */
export function burst(state, x, y, kind, count) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const n = Number.isFinite(count) ? clamp(Math.floor(count), 0, MAX_PARTICLES) : 0;
  for (let i = 0; i < n; i++) {
    const angle = random(state) * Math.PI * 2, speed = 60 + random(state) * 200;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.35 + random(state) * 0.4, kind });
  }
  if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
}

/** Uses only the existing entity fields and the game's seeded random stream. */
export function spawnFly(state) {
  if (state.flies.length >= MAX_FLIES) return;
  const x = 45 + random(state) * (WIDTH - 90);
  const y = 45 + random(state) * (HEIGHT - 90);
  state.flies.push({ id: `fly-${state.time}-${state.rng}`, x, y, radius: 9 });
}

/** Advances warning/active timers in seconds; the caller owns invulnerability decay. */
export function updateHazards(state, dt) {
  if (state.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  const p = state.player;
  const wave = Math.min(MAX_WAVE, Math.floor(state.time / WAVE_LENGTH) + 1);
  if (wave !== state.wave) {
    state.wave = wave;
    state.events.push({ type: 'wave', x: p.x, y: p.y });
  }

  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const h = state.hazards[i];
    h.remaining -= dt;
    if (h.phase === 'warning' && h.remaining <= 0) {
      h.phase = 'active';
      // Keep the overshoot: a phase transition must not add a frame to the attack.
      h.remaining += ACTIVE[h.kind];
      state.events.push({ type: 'attack', x: h.x + h.w / 2, y: h.y + h.h / 2 });
    }
    if (h.phase !== 'active') continue;

    // Test even the last active slice before removing it. Warnings cannot enter here.
    if (p.hp > 0 && p.invulnerable <= 0 && overlaps(p, h)) {
      p.hp = Math.max(0, p.hp - 1);
      p.invulnerable = INVULNERABLE;
      state.score = Math.max(0, state.score - 10);
      state.events.push({ type: 'hurt', x: p.x, y: p.y });
      burst(state, p.x, p.y, 'hit', 18);
    }
    if (h.remaining <= 0) {
      // Every normal attack is shorter than hit immunity (1.3 s), so a hit cannot
      // turn into a dodge later in that same attack. No extra hit/scored fields needed.
      if (p.hp > 0 && p.invulnerable <= 0 && !overlaps(p, h)) {
        state.score += 25;
        state.stats.dodges++;
      }
      state.hazards.splice(i, 1);
    }
  }

  const slot = planAt(state.seed, state.time);
  // Spawn only on crossing a scheduled start, not merely because the old zone is gone.
  // FADE remains part of the existing quiet gap; it is not a third hazard phase.
  if (p.hp > 0 && slot && state.time - dt < slot.t && slot.t <= state.time &&
      state.hazards.length < MAX_HAZARDS) {
    const zone = zoneFor(state, slot.kind, slot.t);
    state.hazards.push({ id: `hazard-${slot.k}`, kind: slot.kind, phase: 'warning',
      ...zone, remaining: slot.warning - (state.time - slot.t) });
    state.events.push({ type: 'warning', x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 });
  }
}
