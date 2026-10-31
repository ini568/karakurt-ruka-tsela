import { updateHazards, spawnFly, burst } from './world.js';

const WIDTH = 1280;
const HEIGHT = 720;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** All mutable simulation data lives in the returned JSON-compatible state. */
export function createGame({ seed = 1 } = {}) {
  seed = finite(seed, 1) >>> 0;
  const state = {
    version: 1, seed, rng: seed, time: 0, duration: 180,
    status: 'playing', score: 0, wave: 0,
    player: { x: 640, y: 440, vx: 0, vy: 0, radius: 17, hp: 3, silk: 100, invulnerable: 0 },
    web: null,
    anchors: [
      { id: 'a0', x: 105, y: 95 }, { id: 'a1', x: 360, y: 105 },
      { id: 'a2', x: 640, y: 75 }, { id: 'a3', x: 920, y: 105 },
      { id: 'a4', x: 1175, y: 95 }, { id: 'a5', x: 90, y: 370 },
      { id: 'a6', x: 1190, y: 370 }, { id: 'a7', x: 330, y: 625 },
      { id: 'a8', x: 950, y: 625 },
    ],
    flies: [], hazards: [], particles: [], events: [],
    stats: { flies: 0, dodges: 0 },
  };
  for (let i = 0; i < 8; i++) spawnFly(state);
  return state;
}

function finish(state) {
  const status = state.player.hp <= 0 ? 'lost' : state.time >= state.duration ? 'won' : null;
  if (!status) return false;
  state.status = status;
  state.web = null;
  if (status === 'won') state.score += 500; // «Рука цела»: бонус за рассвет.
  state.events.push({ type: status === 'won' ? 'win' : 'lose', x: state.player.x, y: state.player.y });
  return true;
}

function attachWeb(state, input) {
  const p = state.player;
  if (!input.webHeld) { state.web = null; return; }
  if (state.web || p.silk < 6) return;
  const aimX = finite(input.aimX, p.x);
  const aimY = finite(input.aimY, p.y);
  let nearest = null;
  let distance = 180 * 180;
  for (const anchor of state.anchors) {
    const d = (anchor.x - aimX) ** 2 + (anchor.y - aimY) ** 2;
    if (d <= distance) { nearest = anchor; distance = d; }
  }
  if (!nearest) return;
  state.web = {
    anchorX: nearest.x, anchorY: nearest.y,
    length: Math.max(40, Math.hypot(p.x - nearest.x, p.y - nearest.y)),
  };
  p.silk -= 6;
  state.events.push({ type: 'web', x: nearest.x, y: nearest.y });
}

function movePlayer(state, input, dt) {
  const p = state.player;
  attachWeb(state, input);
  let mx = clamp(finite(input.moveX), -1, 1);
  let my = clamp(finite(input.moveY), -1, 1);
  const norm = Math.hypot(mx, my);
  if (norm > 1) { mx /= norm; my /= norm; }
  if (input.dashPressed && p.silk >= 28) {
    let dx = mx, dy = my;
    if (Math.hypot(dx, dy) < 0.01) {
      // Aim is a point on the logical field; bound finite extremes before normalizing.
      dx = clamp(finite(input.aimX, p.x), 0, WIDTH) - p.x;
      dy = clamp(finite(input.aimY, p.y), 0, HEIGHT) - p.y;
    }
    const length = Math.hypot(dx, dy);
    // No direction (no keys and aim on the spider): the dash is not performed and costs no silk.
    if (length >= 0.01) {
      p.vx += dx / length * 590;
      p.vy += dy / length * 590;
      p.silk -= 28;
      state.events.push({ type: 'dash', x: p.x, y: p.y });
      burst(state, p.x, p.y, 'silk', 9);
    }
  }
  const drag = state.web ? 0.22 : norm > 0 ? 3.5 : 2.4;
  p.vx = (p.vx + mx * 1180 * dt) * Math.exp(-drag * dt);
  p.vy = (p.vy + (my * 1180 + (state.web ? 650 : 0)) * dt) * Math.exp(-drag * dt);
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > 900) { p.vx *= 900 / speed; p.vy *= 900 / speed; }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (state.web) {
    const web = state.web;
    const dx = p.x - web.anchorX, dy = p.y - web.anchorY;
    const length = Math.hypot(dx, dy);
    // A rope can go slack, but cannot push. Remove only outward radial velocity.
    if (length > web.length) {
      const nx = dx / length, ny = dy / length;
      p.x = web.anchorX + nx * web.length;
      p.y = web.anchorY + ny * web.length;
      const radial = Math.max(0, p.vx * nx + p.vy * ny);
      p.vx -= radial * nx;
      p.vy -= radial * ny;
    }
    p.silk = Math.max(0, p.silk - 8 * dt);
    if (p.silk <= 0) state.web = null;
  } else p.silk = Math.min(100, p.silk + 12 * dt);
  if (p.x < p.radius) { p.x = p.radius; p.vx = Math.max(0, p.vx); }
  if (p.x > WIDTH - p.radius) { p.x = WIDTH - p.radius; p.vx = Math.min(0, p.vx); }
  if (p.y < p.radius) { p.y = p.radius; p.vy = Math.max(0, p.vy); }
  if (p.y > HEIGHT - p.radius) { p.y = HEIGHT - p.radius; p.vy = Math.min(0, p.vy); }
}

/** Mutates state; events are a transient outbox valid only until the next call. */
export function stepGame(state, input = {}, dt = 0) {
  state.events = [];
  if (state.status !== 'playing') return;
  if (finish(state)) return;
  // Invalid elapsed time is not a frame; never advance on Infinity or NaN.
  dt = Number.isFinite(dt) ? clamp(dt, 0, Math.min(0.033, state.duration - state.time)) : 0;
  if (dt <= 0) return;
  input = input || {};
  const previousTime = state.time;
  state.time = Math.min(state.duration, state.time + dt);
  // Выживание тоже приносит очки, иначе рекорд пассивного игрока навсегда 0.
  state.score += (Math.floor(state.time) - Math.floor(previousTime)) * 5;
  const p = state.player;
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  movePlayer(state, input, dt);
  for (let i = state.flies.length - 1; i >= 0; i--) {
    const fly = state.flies[i];
    if (Math.hypot(fly.x - p.x, fly.y - p.y) <= p.radius + fly.radius) {
      state.flies.splice(i, 1);
      state.stats.flies++;
      state.score += 100;
      p.silk = Math.min(100, p.silk + 14);
      state.events.push({ type: 'catch', x: fly.x, y: fly.y });
      burst(state, fly.x, fly.y, 'fly', 7);
    }
  }
  if (Math.floor(previousTime / 2.4) !== Math.floor(state.time / 2.4)) spawnFly(state);
  updateHazards(state, dt);
  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.exp(-3 * dt);
    particle.vy *= Math.exp(-3 * dt);
  }
  state.particles = state.particles.filter(particle => particle.life > 0).slice(-120);
  finish(state);
}

const safeNumber = (value, max) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(0, value)) : 0;

/** A single-run result; the client merges these maxima with previously stored records. */
export function serializeProgress(state) {
  return JSON.stringify({
    version: 1,
    bestScore: Math.floor(safeNumber(state?.score, Number.MAX_SAFE_INTEGER)),
    bestSurvival: safeNumber(state?.time, 180),
    wins: state?.status === 'won' ? 1 : 0,
  });
}

export function readProgress(text) {
  const empty = { version: 1, bestScore: 0, bestSurvival: 0, wins: 0 };
  if (typeof text !== 'string') return empty;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return empty;
    return {
      version: 1,
      bestScore: Math.floor(safeNumber(value.bestScore, Number.MAX_SAFE_INTEGER)),
      bestSurvival: safeNumber(value.bestSurvival, 180),
      wins: Math.floor(safeNumber(value.wins, Number.MAX_SAFE_INTEGER)),
    };
  } catch { return empty; }
}
