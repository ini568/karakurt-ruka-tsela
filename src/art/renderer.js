import { PALETTE as P } from './palette.js';

const TAU = Math.PI * 2;
function ellipse(c, x, y, rx, ry, color, rotation = 0) {
  c.beginPath(); c.ellipse(x, y, rx, ry, rotation, 0, TAU); c.fillStyle = color; c.fill();
}
function line(c, x, y, xx, yy, color, width = 1) {
  c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

function room(c) {
  const wall = c.createLinearGradient(0, 0, 0, 720);
  wall.addColorStop(0, P.bgWall); wall.addColorStop(1, P.bg);
  c.fillStyle = wall; c.fillRect(0, 0, 1280, 720);
  // A quiet bedroom silhouette; no background object is a collision surface.
  c.fillStyle = P.woodDark; c.fillRect(0, 548, 1280, 172);
  c.fillStyle = '#17151c'; c.fillRect(0, 556, 1280, 164);
  for (let y = 578; y < 720; y += 43) line(c, 0, y, 1280, y, '#25202a');
  c.fillStyle = '#273249'; c.fillRect(872, 55, 247, 283);
  c.fillStyle = P.skyNight; c.fillRect(881, 64, 229, 265);
  ellipse(c, 1036, 117, 30, 30, P.moon);
  ellipse(c, 1048, 107, 28, 28, P.skyNight);
  for (let i = 0; i < 20; i++) ellipse(c, 891 + (i * 53) % 209, 76 + (i * 31) % 239, 1, 1, '#8592b6');
  c.fillStyle = '#273249'; c.fillRect(990, 62, 7, 270); c.fillRect(879, 194, 232, 7);
  c.fillStyle = '#121722'; c.fillRect(849, 43, 23, 313); c.fillRect(1119, 43, 33, 313);
  const beam = c.createLinearGradient(1000, 200, 700, 680);
  beam.addColorStop(0, 'rgba(154,183,238,0.085)'); beam.addColorStop(1, 'rgba(154,183,238,0)');
  c.beginPath(); c.moveTo(881, 328); c.lineTo(1110, 328); c.lineTo(1200, 720); c.lineTo(387, 720); c.closePath(); c.fillStyle = beam; c.fill();
  c.fillStyle = '#35271f'; c.fillRect(80, 396, 650, 32); c.fillRect(96, 421, 23, 165); c.fillRect(690, 421, 23, 165);
  c.fillStyle = '#222b43'; c.fillRect(104, 411, 602, 137);
  c.fillStyle = P.fabric; c.fillRect(266, 421, 440, 137);
  for (let x = 289; x < 705; x += 45) line(c, x, 427, x - 10, 551, '#35405c');
  ellipse(c, 183, 425, 74, 23, '#747e9a', -0.08);
  c.fillStyle = '#211f2c'; c.fillRect(42, 158, 141, 5);
  c.fillStyle = '#2b2b3a'; c.fillRect(67, 104, 21, 54); c.fillRect(92, 116, 13, 42);
  // Fine corner cobweb; deliberately low contrast compared with the live thread.
  c.strokeStyle = 'rgba(200,220,255,0.09)'; c.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    c.beginPath(); c.arc(0, 0, i * 25, 0, Math.PI / 2); c.stroke();
    line(c, 0, 0, Math.cos(i * 0.25) * 129, Math.sin(i * 0.25) * 129, 'rgba(200,220,255,0.1)');
  }
}

function handPath(c) {
  c.beginPath(); c.moveTo(54, 180); c.lineTo(48, 132); c.bezierCurveTo(8, 117, 3, 88, 17, 85);
  c.bezierCurveTo(26, 81, 36, 111, 48, 108); c.lineTo(39, 36);
  c.bezierCurveTo(37, 18, 55, 16, 58, 34); c.lineTo(66, 88); c.lineTo(67, 14);
  c.bezierCurveTo(67, -1, 86, -1, 87, 14); c.lineTo(90, 83); c.lineTo(98, 20);
  c.bezierCurveTo(100, 4, 118, 8, 116, 24); c.lineTo(113, 89); c.lineTo(126, 43);
  c.bezierCurveTo(131, 27, 149, 33, 144, 50); c.lineTo(136, 117);
  c.bezierCurveTo(133, 139, 124, 148, 126, 180); c.closePath();
}

// mode: 'fill' = solid palm (active), 'outline' = stroked silhouette only (warning).
function hand(c, h, mode = 'fill') {
  // Hand artwork is contained in the exact rectangular model hitbox.
  c.save(); c.translate(h.x, h.y); c.scale(h.w / 180, h.h / 180);
  handPath(c);
  if (mode === 'outline') {
    c.strokeStyle = P.warning; c.lineWidth = 3 * 180 / Math.max(1, Math.min(h.w, h.h)); c.stroke();
  } else {
    c.fillStyle = P.skinShade; c.fill();
    ellipse(c, 90, 116, 33, 39, P.skin);
    line(c, 65, 121, 105, 130, P.skinShade, 2);
    for (const [x, y] of [[49, 35], [77, 15], [107, 22], [135, 46]]) ellipse(c, x, y, 5, 8, P.nail, 0.05);
  }
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}

const KIND_NAME = { slap: 'ЛАДОНЬ', glass: 'СТАКАН', sweep: 'СМАХИВАНИЕ' };
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
// Warning length is owned by the model; this span only drives the visual ramp.
const WARNING_SPAN = 1.5;

function chevrons(c, h, color, width) {
  // Chevrons follow the band's long axis, so vertical sweeps no longer show sideways arrows.
  const vertical = h.h > h.w;
  const len = vertical ? h.h : h.w;
  for (let s = 26; s < len - 12; s += 54) {
    if (vertical) {
      const cx = h.x + h.w / 2, y = h.y + s;
      line(c, cx - 16, y - 12, cx, y + 8, color, width); line(c, cx, y + 8, cx + 16, y - 12, color, width);
    } else {
      const cy = h.y + h.h / 2, x = h.x + s;
      line(c, x - 12, cy - 16, x + 8, cy, color, width); line(c, x + 8, cy, x - 12, cy + 16, color, width);
    }
  }
}

// Diagonal hatching marks a warning zone without relying on colour alone (no solid fill).
function hatch(c, h, color, gap = 18) {
  c.save(); c.beginPath(); c.rect(h.x, h.y, h.w, h.h); c.clip();
  c.strokeStyle = color; c.lineWidth = 2; c.beginPath();
  for (let d = -h.h; d < h.w; d += gap) { c.moveTo(h.x + d, h.y + h.h); c.lineTo(h.x + d + h.h, h.y); }
  c.stroke(); c.restore();
}

// Warning = dashed outline + hatching (no fill): amber strokes whose shape names the attack.
function hazardWarning(c, h, time, reduced) {
  const urgency = clamp01(1 - h.remaining / WARNING_SPAN);
  const imminent = h.remaining <= 0.35;
  const dash = imminent ? [] : [12, 7];
  const offset = reduced ? 0 : -time * 18;
  hatch(c, h, imminent ? 'rgba(255,191,105,0.34)' : 'rgba(255,191,105,0.2)');
  c.save(); c.beginPath(); c.rect(h.x - 2, h.y - 2, h.w + 4, h.h + 4); c.clip();
  if (h.kind === 'slap') {
    // Palm silhouette + corner brackets: "a hand lands here".
    hand(c, h, 'outline');
    const s = Math.min(34, h.w / 4, h.h / 4);
    for (const [x, y, dx, dy] of [[h.x, h.y, 1, 1], [h.x + h.w, h.y, -1, 1], [h.x, h.y + h.h, 1, -1], [h.x + h.w, h.y + h.h, -1, -1]]) {
      c.beginPath(); c.moveTo(x + dx * 2, y + dy * (s + 2)); c.lineTo(x + dx * 2, y + dy * 2); c.lineTo(x + dx * (s + 2), y + dy * 2); c.stroke();
    }
  } else if (h.kind === 'glass') {
    // Rounded rim of an upturned glass (double ring) — never the hand's square brackets.
    const r = Math.min(h.w, h.h) * 0.22;
    c.strokeStyle = P.warning; c.lineWidth = imminent ? 5 : 3; c.setLineDash(dash); c.lineDashOffset = offset;
    roundRect(c, h.x + 2, h.y + 2, h.w - 4, h.h - 4, r); c.stroke();
    c.setLineDash([]); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,191,105,0.6)';
    roundRect(c, h.x + 14, h.y + 14, h.w - 28, h.h - 28, Math.max(0, r - 12)); c.stroke();
  } else {
    // Long band edges + direction chevrons along the sweep.
    const v = h.h > h.w;
    c.strokeStyle = P.warning; c.lineWidth = imminent ? 5 : 3; c.setLineDash(dash); c.lineDashOffset = offset;
    if (v) { line(c, h.x + 2, h.y, h.x + 2, h.y + h.h, P.warning, c.lineWidth); line(c, h.x + h.w - 2, h.y, h.x + h.w - 2, h.y + h.h, P.warning, c.lineWidth); }
    else { line(c, h.x, h.y + 2, h.x + h.w, h.y + 2, P.warning, c.lineWidth); line(c, h.x, h.y + h.h - 2, h.x + h.w, h.y + h.h - 2, P.warning, c.lineWidth); }
    c.setLineDash([]);
    chevrons(c, h, 'rgba(255,191,105,0.85)', 3);
  }
  c.restore();
  if (h.kind !== 'sweep') {
    // Closing frame: starts inside the zone and meets the border at impact time.
    const inset = Math.min(h.w, h.h) / 2 * (1 - urgency) * 0.9;
    if (inset > 2) {
      c.strokeStyle = 'rgba(255,191,105,0.55)'; c.lineWidth = 1.5;
      if (h.kind === 'glass') { roundRect(c, h.x + inset, h.y + inset, h.w - inset * 2, h.h - inset * 2, Math.min(h.w, h.h) * 0.22 * (1 - urgency)); c.stroke(); }
      else c.strokeRect(h.x + inset, h.y + inset, h.w - inset * 2, h.h - inset * 2);
    }
  }
  if (h.kind === 'slap') {
    c.strokeStyle = P.warning; c.lineWidth = imminent ? 4 : 2; c.setLineDash(dash); c.lineDashOffset = offset;
    c.strokeRect(h.x + 1.5, h.y + 1.5, Math.max(0, h.w - 3), Math.max(0, h.h - 3)); c.setLineDash([]);
  }
}

// Contract: a glass stays active for 1.05 s. The meter is a linear fraction of h.remaining,
// so it drains with the model clock (freezes on pause) and has no renderer-owned timer.
const GLASS_ACTIVE = 1.05;

// Draining bar ABOVE the active glass (inside its top edge when the glass touches the ceiling).
// Returns the bar's top y so the label can sit just above it without overlapping.
function glassMeter(c, h) {
  const left = clamp01(h.remaining / GLASS_ACTIVE);
  const bw = Math.max(24, h.w - 8), bx = h.x + (h.w - bw) / 2;
  const by = h.y >= 46 ? h.y - 14 : h.y + 10;
  c.fillStyle = 'rgba(8,13,24,0.92)'; c.fillRect(bx - 2, by - 2, bw + 4, 12);
  c.fillStyle = P.danger; c.fillRect(bx, by, left > 0 ? Math.max(2, bw * left) : 0, 8);
  // Quarter ticks give the bar a readable scale even without the numeric label.
  for (const f of [0.25, 0.5, 0.75]) line(c, bx + bw * f, by, bx + bw * f, by + 8, 'rgba(8,13,24,0.85)', 2);
  c.strokeStyle = P.ui; c.lineWidth = 1.5; c.strokeRect(bx - 2, by - 2, bw + 4, 12);
  return by;
}

function hazardActive(c, h, reduced) {
  // Active = solid filled zone with a thick solid danger border; warnings are never filled.
  c.save(); c.beginPath(); c.rect(h.x, h.y, h.w, h.h); c.clip();
  if (h.kind === 'slap') {
    c.fillStyle = 'rgba(255,42,58,0.30)'; c.fillRect(h.x, h.y, h.w, h.h);
    hand(c, h, 'fill');
  } else if (h.kind === 'glass') {
    // Upturned glass: rounded, tinted, heavy rim and highlight. The timer bar is drawn above it.
    const r = Math.min(h.w, h.h) * 0.22;
    roundRect(c, h.x + 3, h.y + 3, h.w - 6, h.h - 6, r);
    c.fillStyle = 'rgba(255,42,58,0.24)'; c.fill();
    c.fillStyle = 'rgba(190,226,255,0.22)'; c.fill();
    c.strokeStyle = P.glassEdge; c.lineWidth = 7; c.stroke();
    roundRect(c, h.x + 16, h.y + 16, h.w - 32, h.h - 32, Math.max(0, r - 13));
    c.strokeStyle = 'rgba(230,245,255,0.35)'; c.lineWidth = 2; c.stroke();
    line(c, h.x + 26, h.y + r, h.x + 26, h.y + h.h - r, 'rgba(235,248,255,0.8)', 4);
    line(c, h.x + 38, h.y + r + 10, h.x + 38, h.y + h.h * 0.45, 'rgba(235,248,255,0.45)', 2);
  } else {
    // Sweep: full-length band with a forearm and motion streaks along the long axis.
    c.fillStyle = 'rgba(255,42,58,0.34)'; c.fillRect(h.x, h.y, h.w, h.h);
    const v = h.h > h.w;
    const across = v ? h.w : h.h;
    c.fillStyle = P.skinShade;
    if (v) c.fillRect(h.x + across * 0.24, h.y, across * 0.52, h.h); else c.fillRect(h.x, h.y + across * 0.24, h.w, across * 0.52);
    c.fillStyle = P.skin;
    if (v) c.fillRect(h.x + across * 0.24, h.y, across * 0.14, h.h); else c.fillRect(h.x, h.y + across * 0.24, h.w, across * 0.14);
    for (const f of [0.1, 0.88]) {
      if (v) line(c, h.x + across * f, h.y, h.x + across * f, h.y + h.h, 'rgba(255,220,210,0.5)', 3);
      else line(c, h.x, h.y + across * f, h.x + h.w, h.y + across * f, 'rgba(255,220,210,0.5)', 3);
    }
    chevrons(c, h, P.nail, 2);
  }
  c.restore();
  // Solid (never dashed) border: the dashed/hatched look is reserved for warnings.
  c.setLineDash([]);
  c.strokeStyle = '#080d18'; c.lineWidth = 10;
  if (h.kind === 'glass') { roundRect(c, h.x + 3, h.y + 3, h.w - 6, h.h - 6, Math.min(h.w, h.h) * 0.22); c.stroke(); }
  else c.strokeRect(h.x + 3, h.y + 3, Math.max(0, h.w - 6), Math.max(0, h.h - 6));
  c.strokeStyle = P.danger; c.lineWidth = 6;
  if (h.kind === 'glass') { roundRect(c, h.x + 3, h.y + 3, h.w - 6, h.h - 6, Math.min(h.w, h.h) * 0.22); c.stroke(); }
  else c.strokeRect(h.x + 3, h.y + 3, Math.max(0, h.w - 6), Math.max(0, h.h - 6));
  if (!reduced) { c.strokeStyle = 'rgba(255,42,58,0.35)'; c.lineWidth = 3; c.strokeRect(h.x - 4, h.y - 4, h.w + 8, h.h + 8); }
}

function hazard(c, h, time, reduced) {
  if (![h.x, h.y, h.w, h.h].every(Number.isFinite) || h.w <= 0 || h.h <= 0) return;
  const warning = h.phase === 'warning';
  const fade = h.phase === 'fade';
  const remaining = Number.isFinite(h.remaining) ? Math.max(0, h.remaining) : 0;
  c.save();
  if (warning) hazardWarning(c, h, time, reduced);
  else {
    c.globalAlpha = fade ? 0.25 * clamp01(remaining / 0.32 + 0.2) : 1;
    hazardActive(c, h, reduced);
    c.globalAlpha = 1;
  }
  if (!fade) {
    const color = warning ? P.warning : P.danger;
    // The meter exists only while the glass is active; it is gone in fade and once the hazard is removed.
    const hold = !warning && h.kind === 'glass' && Number.isFinite(h.remaining);
    const meterY = hold ? glassMeter(c, h) : null;
    const secs = warning || hold ? ` ${remaining.toFixed(1)} с` : '';
    const label = `${warning ? '! СКОРО: ' : hold ? 'СТАКАН ДЕРЖИТ, ЖДИ:' : 'УДАР: '}${hold ? '' : KIND_NAME[h.kind] ?? 'УГРОЗА'}${secs}`;
    c.font = 'bold 17px system-ui, sans-serif';
    const tw = c.measureText(label).width + 18;
    // Label sits above the zone (and above the glass meter), or inside the top edge near the ceiling.
    const lx = Math.max(4, Math.min(1280 - tw - 4, h.x));
    let ly = h.y >= 32 ? h.y - 9 : h.y + 29;
    if (meterY !== null) ly = h.y >= 46 ? meterY - 6 : meterY + 30;
    // No opaque plaque: overlapping warnings and active hitboxes remain visible.
    c.strokeStyle = '#080d18'; c.lineWidth = 4; c.lineJoin = 'round';
    c.strokeText(label, lx + 9, ly);
    c.fillStyle = color; c.fillText(label, lx + 9, ly);
  }
  c.restore();
}

function spider(c, p, time, reduced) {
  c.save(); c.translate(p.x, p.y);
  const r = p.radius;
  const invuln = p.invulnerable > 0;
  if (invuln) {
    // Blink while invulnerable: 10 Hz on/off, or a gentle 2 Hz fade for reduced motion.
    c.globalAlpha = reduced ? 0.55 + 0.25 * Math.cos(time * 4 * Math.PI) : Math.floor(time * 20) % 2 ? 0.28 : 1;
  }
  const angle = Math.hypot(p.vx, p.vy) > 8 ? Math.atan2(p.vy, p.vx) + Math.PI / 2 : 0;
  c.rotate(angle);
  ellipse(c, 2, 5, r * 1.5, r * 1.25, 'rgba(0,0,0,0.35)');
  c.lineCap = 'round'; c.lineJoin = 'round';
  const gait = reduced ? 0 : Math.sin(time * 19) * Math.min(0.18, Math.hypot(p.vx, p.vy) / 900);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const y = (i - 1.5) * r * 0.39; const bend = (i - 1.5) * r * 0.9;
    c.beginPath(); c.moveTo(side * r * 0.35, y);
    c.lineTo(side * r * (1.18 + gait * (i % 2 ? 1 : -1)), bend);
    c.lineTo(side * r * 1.7, bend + (i < 2 ? -1 : 1) * r * 0.6);
    c.strokeStyle = '#8793b2'; c.lineWidth = 3.8; c.stroke();
    c.strokeStyle = P.spider; c.lineWidth = 2.4; c.stroke();
  }
  ellipse(c, 0, r * 0.18, r * 0.82, r * 0.95, '#aebbd4');
  ellipse(c, 0, -r * 0.56, r * 0.56, r * 0.52, '#aebbd4');
  ellipse(c, 0, r * 0.18, r * 0.71, r * 0.84, P.spider);
  ellipse(c, 0, -r * 0.56, r * 0.46, r * 0.42, '#151825');
  ellipse(c, -r * 0.24, -r * 0.02, r * 0.12, r * 0.35, P.spiderShine, -0.45);
  c.fillStyle = P.spiderMark; c.beginPath(); c.moveTo(-r * 0.29, -r * 0.1); c.lineTo(r * 0.29, -r * 0.1); c.lineTo(-r * 0.26, r * 0.53); c.lineTo(r * 0.26, r * 0.53); c.closePath(); c.fill();
  for (const x of [-0.23, 0.23]) ellipse(c, x * r, -r * 0.75, 1.7, 1.7, P.moon);
  if (invuln) {
    c.globalAlpha = 0.85; c.setLineDash([5, 5]);
    c.strokeStyle = P.silk; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * 2, 0, TAU); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
  }
  c.restore();
}

// Renderer-private memory of the previous frame per state object. It only reads existing
// fields (stats, hp, flies, time); the state itself is never written to.
const memory = new WeakMap();
const FEEDBACK_LIFE = 1.1;
const LOW_SILK = 25;

function trackFeedback(state) {
  const p = state.player, stats = state.stats || {};
  const now = Number.isFinite(state.time) ? state.time : 0;
  let m = memory.get(state);
  const snapshot = () => ({ flies: stats.flies ?? 0, dodges: stats.dodges ?? 0, hp: p.hp,
    time: now, flyPos: new Map((state.flies || []).map(f => [f.id, [f.x, f.y]])), pops: m?.pops || [], hurtAt: m?.hurtAt ?? -99 });
  if (!m || now < m.time) { m = snapshot(); m.pops = []; m.hurtAt = -99; memory.set(state, m); return m; }
  // Several model steps may run between two frames: one pop per increment, staggered upward.
  const flyGain = Math.min(4, Math.max(0, (stats.flies ?? 0) - m.flies));
  if (flyGain > 0) {
    const live = new Set((state.flies || []).map(f => f.id));
    let placed = 0;
    for (const [id, [x, y]] of m.flyPos) if (!live.has(id) && placed < flyGain) {
      m.pops.push({ x, y: y - placed * 24, text: '+100 МУХА', color: P.warning, at: now, ring: true }); placed++;
    }
    for (; placed < flyGain; placed++) m.pops.push({ x: p.x, y: p.y - 30 - placed * 24, rx: p.x, ry: p.y, text: '+100 МУХА', color: P.warning, at: now, ring: true });
  }
  const dodgeGain = Math.min(4, Math.max(0, (stats.dodges ?? 0) - m.dodges));
  for (let i = 0; i < dodgeGain; i++) m.pops.push({ x: p.x, y: p.y - 40 - i * 24, rx: p.x, ry: p.y, text: '+25 УКЛОНЕНИЕ', color: P.mint, at: now, ring: i === 0 });
  if (p.hp < m.hp) { m.hurtAt = now; m.pops.push({ x: p.x, y: p.y - 44, rx: p.x, ry: p.y, text: '−1 ЖИЗНЬ  −10', color: P.danger, at: now, ring: true }); }
  const next = snapshot();
  next.pops = m.pops.filter(q => now - q.at < FEEDBACK_LIFE).slice(-12);
  memory.set(state, next);
  return next;
}

function drawPops(c, m, now, reduced) {
  c.font = 'bold 20px system-ui, sans-serif'; c.textAlign = 'center';
  for (const q of m.pops) {
    const t = clamp01((now - q.at) / FEEDBACK_LIFE);
    const rise = reduced ? 0 : t * 34;
    const x = Math.min(1220, Math.max(60, q.x)), y = Math.min(700, Math.max(30, q.y - rise));
    // Reduced motion: no expanding rings, a steady linear fade instead of a pop.
    c.globalAlpha = reduced ? 1 - t : 1 - t * t;
    if (q.ring) {
      const rx = q.rx ?? q.x, ry = q.ry ?? q.y;
      c.strokeStyle = q.color; c.lineWidth = 3;
      c.beginPath(); c.arc(rx, ry, reduced ? 24 : 14 + t * 40, 0, TAU); c.stroke();
      if (!reduced) for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8, r0 = 18 + t * 30, r1 = r0 + 10;
        line(c, rx + Math.cos(a) * r0, ry + Math.sin(a) * r0, rx + Math.cos(a) * r1, ry + Math.sin(a) * r1, q.color, 2);
      }
    }
    c.lineWidth = 5; c.strokeStyle = '#080d18'; c.strokeText(q.text, x, y);
    c.fillStyle = q.color; c.fillText(q.text, x, y);
  }
  c.globalAlpha = 1; c.textAlign = 'start';
}

function aimTarget(state, aim) {
  if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return null;
  let best = null, dist = 180 * 180;
  for (const a of state.anchors || []) {
    const d = (a.x - aim.x) ** 2 + (a.y - aim.y) ** 2;
    if (d <= dist) { best = a; dist = d; }
  }
  return best;
}

/** Pure Canvas renderer. The caller owns RAF, DPR and the physical canvas size. */
export function renderGame(ctx, state, { width = 1280, height = 720, reducedMotion = false, aim = null } = {}) {
  if (!ctx || !state || !state.player || !(width > 0) || !(height > 0)) return;
  const fb = trackFeedback(state);
  const now = Number.isFinite(state.time) ? state.time : 0;
  const sinceHurt = now - fb.hurtAt;
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / 1280, height / 720);
  ctx.translate((width - 1280 * scale) / 2, (height - 720 * scale) / 2); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.rect(0, 0, 1280, 720); ctx.clip();
  // Short decaying shake on damage; fully disabled for reduced motion.
  if (!reducedMotion && sinceHurt >= 0 && sinceHurt < 0.3) {
    const k = (1 - sinceHurt / 0.3) * 7;
    ctx.translate(Math.sin(now * 91) * k, Math.cos(now * 77) * k);
  }
  room(ctx);
  // Shade scenery only: danger bounds and the player must stay legible at edges.
  const vignette = ctx.createRadialGradient(640, 350, 200, 640, 350, 800);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, state.player.hp === 1 ? 'rgba(85,8,19,0.65)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, 1280, 720);
  // Draw fading → active → warning so the upcoming outline is never hidden by a fading hit.
  const order = { fade: 0, active: 1, warning: 2 };
  for (const h of [...(state.hazards || [])].sort((a, b) => (order[a.phase] ?? 0) - (order[b.phase] ?? 0))) hazard(ctx, h, now, reducedMotion);
  const p = state.player;
  const target = state.web ? null : aimTarget(state, aim);
  const silkOk = (p.silk ?? 0) >= 6;
  if (target) {
    // Preview of the thread the model would attach (nearest anchor within 180 of the aim).
    ctx.setLineDash([6, 8]);
    line(ctx, p.x, p.y, target.x, target.y, silkOk ? 'rgba(169,233,208,0.45)' : 'rgba(255,42,58,0.4)', 1.5);
    ctx.setLineDash([]);
  }
  const aimOk = !state.web && aim && Number.isFinite(aim.x) && Number.isFinite(aim.y);
  for (const a of state.anchors || []) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    const attached = state.web && state.web.anchorX === a.x && state.web.anchorY === a.y;
    const aimed = target === a;
    // Every anchor within the 180 px web reach of the aim gets a soft ring; the nearest one
    // (the one the model would attach to) gets the strong pulsing ring and the thread preview.
    const inReach = aimOk && !aimed && (a.x - aim.x) ** 2 + (a.y - aim.y) ** 2 <= 180 * 180;
    if (inReach) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(169,233,208,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x, a.y, 16, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (aimed) {
      const pulse = reducedMotion ? 0 : Math.sin(now * 8) * 2;
      ctx.strokeStyle = '#080d18'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(a.x, a.y, 21 + pulse, 0, TAU); ctx.stroke();
      ctx.strokeStyle = silkOk ? P.mint : P.danger; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, 21 + pulse, 0, TAU); ctx.stroke();
      ellipse(ctx, a.x, a.y, 15, 15, silkOk ? 'rgba(169,233,208,0.28)' : 'rgba(255,42,58,0.28)');
    }
    ellipse(ctx, a.x, a.y, 13, 13, '#101d29');
    ctx.strokeStyle = attached ? P.silk : aimed ? (silkOk ? P.mint : P.danger) : inReach ? P.mint : 'rgba(169,233,208,0.6)';
    ctx.lineWidth = attached || aimed ? 3 : 2;
    ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, TAU); ctx.stroke();
    line(ctx, a.x - 4, a.y, a.x + 4, a.y, P.moon, 2);
    line(ctx, a.x, a.y - 4, a.x, a.y + 4, P.moon, 2);
    if (attached) { ctx.strokeStyle = P.silk; ctx.beginPath(); ctx.arc(a.x, a.y, 15, 0, TAU); ctx.stroke(); }
  }
  if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) && !state.web) {
    // Faint 180 px reach circle around the cursor plus a small crosshair.
    ctx.strokeStyle = target ? 'rgba(169,233,208,0.16)' : 'rgba(168,179,200,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(aim.x, aim.y, 180, 0, TAU); ctx.stroke();
    line(ctx, aim.x - 8, aim.y, aim.x + 8, aim.y, 'rgba(232,236,255,0.7)', 1.5);
    line(ctx, aim.x, aim.y - 8, aim.x, aim.y + 8, 'rgba(232,236,255,0.7)', 1.5);
  }
  if (state.web) {
    line(ctx, state.player.x, state.player.y, state.web.anchorX, state.web.anchorY, '#080d18', 6);
    line(ctx, state.player.x, state.player.y, state.web.anchorX, state.web.anchorY, P.silk, 2.5);
  }
  for (const f of state.flies || []) {
    if (![f.x, f.y, f.radius].every(Number.isFinite)) continue;
    const wing = reducedMotion ? 1 : 0.75 + Math.sin(now * 35 + f.x) * 0.25;
    ellipse(ctx, f.x, f.y, f.radius + 7, f.radius + 7, 'rgba(255,209,128,0.08)');
    ellipse(ctx, f.x - 4, f.y - 3, f.radius * wing, f.radius * 0.44, P.flyWing, -0.65);
    ellipse(ctx, f.x + 4, f.y - 3, f.radius * wing, f.radius * 0.44, P.flyWing, 0.65);
    ellipse(ctx, f.x, f.y, f.radius * 0.45, f.radius * 0.7, P.fly);
    ellipse(ctx, f.x, f.y - f.radius * 0.5, 2, 2, P.warning);
  }
  if (!reducedMotion) for (const p of (state.particles || []).slice(0, 100)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    ctx.globalAlpha = clamp01(p.life * 2);
    ellipse(ctx, p.x, p.y, p.kind === 'hit' ? 3 : 1.7, p.kind === 'hit' ? 3 : 1.7, p.kind === 'hit' ? P.danger : p.kind === 'fly' ? P.warning : P.silk);
  }
  ctx.globalAlpha = 1; spider(ctx, p, now, reducedMotion);
  // Silk gauge under the spider; turns red and warns when a dash/web is near unaffordable.
  const silk = Math.max(0, Math.min(100, Number.isFinite(p.silk) ? p.silk : 0));
  const low = silk < LOW_SILK;
  // Clamped so the gauge and its "МАЛО ШЁЛКА" caption stay on screen near the floor and walls.
  const bx = Math.min(1280 - 46, Math.max(6, p.x - 20)), by = Math.min(692, p.y + (p.radius || 17) * 1.9);
  ctx.fillStyle = 'rgba(8,13,24,0.8)'; ctx.fillRect(bx - 1, by - 1, 42, 6);
  ctx.fillStyle = low ? P.danger : P.silk; ctx.fillRect(bx, by, 40 * silk / 100, 4);
  if (low) {
    const blink = reducedMotion || Math.floor(now * 3) % 2 === 0;
    if (blink) {
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      const captionX = Math.min(1214, Math.max(66, bx + 20));
      ctx.lineWidth = 3; ctx.strokeStyle = '#080d18'; ctx.strokeText('МАЛО ШЁЛКА', captionX, by + 18, 120);
      ctx.fillStyle = P.danger; ctx.fillText('МАЛО ШЁЛКА', captionX, by + 18, 120); ctx.textAlign = 'start';
    }
  }
  // Damage: red frame instead of a full-screen flash; reduced motion keeps a static frame.
  if (sinceHurt >= 0 && sinceHurt < 0.6) {
    const k = 1 - sinceHurt / 0.6;
    // Brief, low-alpha red wash (≤0.15 s) that never hides hazards; skipped for reduced motion.
    if (!reducedMotion && sinceHurt < 0.15) {
      ctx.fillStyle = `rgba(255,42,58,${(0.22 * (1 - sinceHurt / 0.15)).toFixed(3)})`;
      ctx.fillRect(-10, -10, 1300, 740);
    }
    ctx.strokeStyle = `rgba(255,42,58,${((reducedMotion ? 0.5 : 0.8) * k).toFixed(3)})`;
    ctx.lineWidth = 18; ctx.strokeRect(9, 9, 1262, 702);
  }
  drawPops(ctx, fb, now, reducedMotion);
  ctx.restore();
}
