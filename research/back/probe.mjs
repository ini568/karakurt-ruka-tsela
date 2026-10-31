// Reproductions of suspected model defects. Prints observed values; no asserts,
// so it can be run against both the old and the fixed model.
// Usage: node research/back/probe.mjs
import { createGame, stepGame } from '../../src/game/model.js';

const DT = 1 / 60;
const quiet = (seed = 17) => {
  const s = createGame({ seed });
  Object.assign(s.player, { x: 640, y: 360, vx: 0, vy: 0, invulnerable: 0 });
  s.flies = []; s.hazards = []; s.particles = []; s.events = [];
  return s;
};

// 1. Wave event on the victory step.
{
  const s = createGame({ seed: 3 });
  s.time = 179.99; s.hazards = []; s.player.invulnerable = 10;
  stepGame(s, {}, 0.033);
  console.log('1 victory step events:', s.events.map(e => e.type).join(','), 'wave=', s.wave);
}

// 2. Dash without direction: no movement input and aim exactly on the spider.
{
  const s = quiet();
  stepGame(s, { dashPressed: true, aimX: 640, aimY: 360 }, DT);
  console.log('2 dash with aim on spider: silk=', s.player.silk.toFixed(1),
    'speed=', Math.hypot(s.player.vx, s.player.vy).toFixed(1),
    'dashEvents=', s.events.filter(e => e.type === 'dash').length);
}

// 3. Holding web until silk runs out: count web events in 6 s of continuous hold.
{
  const s = quiet();
  s.player.silk = 20;
  let webs = 0, drops = 0, had = false;
  for (let i = 0; i < 360; i++) {
    s.hazards = [];
    stepGame(s, { webHeld: true, aimX: 640, aimY: 75 }, DT);
    webs += s.events.filter(e => e.type === 'web').length;
    if (had && !s.web) drops++;
    had = !!s.web;
  }
  console.log('3 continuous hold 6 s: web events=', webs, 'auto drops=', drops);
}

// 4. Release momentum: swing then release, speed after 0, 0.25, 0.5 s.
for (const steer of [0, 1]) {
  const s = quiet(5);
  s.player.x = 460; s.player.y = 200;
  for (let i = 0; i < 70; i++) { s.hazards = []; s.player.invulnerable = 5; stepGame(s, { webHeld: true, aimX: 640, aimY: 75 }, DT); }
  const v0 = Math.hypot(s.player.vx, s.player.vy);
  const dir = Math.sign(s.player.vx) || 1;
  const out = [];
  for (let i = 0; i <= 30; i++) {
    s.hazards = []; s.player.invulnerable = 5;
    stepGame(s, { moveX: steer * dir }, DT);
    if (i === 0 || i === 15 || i === 30) out.push(Math.hypot(s.player.vx, s.player.vy).toFixed(0));
  }
  console.log(`4 release (steer=${steer}) speed before=${v0.toFixed(0)} after 1f/0.25s/0.5s=`, out.join('/'));
}

// 5. Aim outside the field still picks an anchor.
{
  const s = quiet();
  stepGame(s, { webHeld: true, aimX: -60, aimY: 95 }, DT);
  console.log('5 aim (-60,95) outside field: web=', JSON.stringify(s.web));
}

// 6. Equidistant anchors: which is chosen.
{
  const s = quiet();
  s.anchors = [{ id: 'L', x: 600, y: 300 }, { id: 'R', x: 680, y: 300 }];
  stepGame(s, { webHeld: true, aimX: 640, aimY: 300 }, DT);
  console.log('6 tie between L(600) and R(680): chose x=', s.web && s.web.anchorX);
}

// 7. Dodge credit / repeated hits: stand in an active glass of 1.05 s.
{
  const s = quiet();
  s.hazards = [{ id: 'g', kind: 'glass', phase: 'active', x: 540, y: 260, w: 200, h: 200, remaining: 1.05 }];
  let hurts = 0;
  for (let i = 0; i < 90; i++) { stepGame(s, {}, DT); hurts += s.events.filter(e => e.type === 'hurt').length; }
  console.log('7 standing in 1.05 s glass: hurts=', hurts, 'hp=', s.player.hp, 'dodges=', s.stats.dodges);
}

// 8. Lost and won on the same final step: hp reaches 0 at t=180.
{
  const s = quiet();
  s.time = 179.99; s.player.hp = 1;
  s.hazards = [{ id: 's', kind: 'slap', phase: 'active', x: 540, y: 260, w: 200, h: 200, remaining: 0.2 }];
  stepGame(s, {}, 0.033);
  console.log('8 last-step hit: status=', s.status, 'events=', s.events.map(e => e.type).join(','));
}

// 9. Non-finite and hostile input values.
{
  const s = quiet();
  for (let i = 0; i < 120; i++) stepGame(s, { moveX: NaN, moveY: Infinity, aimX: -Infinity, aimY: NaN,
    webHeld: i % 2 === 0, dashPressed: i % 7 === 0 }, DT);
  const bad = JSON.stringify(s).match(/null/g)?.length || 0;
  console.log('9 hostile input: x,y=', s.player.x.toFixed(1), s.player.y.toFixed(1), 'nulls in json=', bad, 'web=', !!s.web);
}

// 10. Fly spawn on top of spider is impossible / bait flies in hazards (count over a night).
{
  const s = createGame({ seed: 47 });
  let inHazard = 0, spawned = 0;
  const ids = new Set(s.flies.map(f => f.id));
  for (let i = 0; i < 180 * 60 && s.status === 'playing'; i++) {
    s.player.invulnerable = 100;
    stepGame(s, { moveX: Math.sin(i / 40), moveY: Math.cos(i / 60) }, DT);
    for (const f of s.flies) if (!ids.has(f.id)) {
      ids.add(f.id); spawned++;
      if (s.hazards.some(h => h.phase === 'warning' && f.x >= h.x && f.x <= h.x + h.w && f.y >= h.y && f.y <= h.y + h.h)) inHazard++;
    }
  }
  console.log('10 flies spawned over night=', spawned, 'inside warning zones=', inHazard, 'caught=', s.stats.flies);
}
