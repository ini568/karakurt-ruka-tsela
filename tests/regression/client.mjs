import assert from 'node:assert/strict';
import { mountGame } from '../../src/client/app.js';
import { environment } from './harness.mjs';

export function checkClient() {
  const checks = [];
  for (const blocked of [false, true]) {
    const env = environment({ blocked });
    let app;
    try {
      // A collapsed canvas skips drawing in the real app. No renderer/model code is replaced.
      env.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
      env.canvas.getContext = () => ({});
      app = mountGame(env);
      const buttons = () => env.overlay.descendants().filter(node => node.tagName === 'BUTTON');
      const primary = () => {
        const button = buttons()[0];
        assert.ok(button, 'panel has a primary action');
        button.emit('click');
      };
      const field = key => {
        const node = env.hud.children.find(child => child.dataset.hud === key);
        assert.ok(node, `public HUD field ${key}`);
        return node.textContent;
      };
      assert.ok(field('best').includes('0'), 'broken/unavailable storage starts with safe records');
      primary();
      assert.equal(env.overlay.hidden, true);
      assert.ok(field('hp').includes('3/3'));
      assert.ok(field('time').includes('3:00'));
      let now = 0;
      env.tick(now);
      for (let i = 0; i < 90; i++) env.tick(now += 20);
      env.window.emit('keydown', { code: 'KeyD', repeat: false });
      env.window.emit('keydown', { code: 'Space', repeat: false });
      env.window.emit('blur');
      assert.equal(env.overlay.hidden, false, 'blur pauses the app');
      const pausedTime = field('time');
      env.tick(now += 300000);
      assert.equal(field('time'), pausedTime, 'paused RAF cannot advance simulation');
      primary();
      env.tick(now += 300000);
      assert.equal(field('time'), pausedTime, 'first frame after resume discards the wall-clock gap');
      env.document.hidden = true;
      env.document.emit('visibilitychange');
      assert.equal(env.overlay.hidden, false, 'hidden document pauses');
      env.document.hidden = false;
      primary();
      env.tick(now += 20);
      let frames = 0;
      // No state injection or accelerated dt: run real fixed steps until natural defeat/victory.
      while (env.overlay.hidden && frames++ < 12000) env.tick(now += 20);
      assert.ok(!env.overlay.hidden, 'a passive party must terminate within its 180-second duration');
      const terminalHud = env.hud.children.map(node => node.textContent);
      const writes = env.writes.length;
      if (!blocked) {
        assert.equal(writes, 1, 'one completed party produces one storage write');
        assert.equal(env.writes[0].key, 'karakurt.progress.v1');
        const saved = JSON.parse(env.writes[0].value);
        assert.ok(saved.bestSurvival > 0 && saved.bestSurvival <= 180);
      } else assert.equal(writes, 0, 'blocked storage is nonfatal');
      for (let i = 0; i < 120; i++) env.tick(now += 20);
      assert.equal(env.writes.length, writes, 'terminal frames cannot save the same result again');
      assert.deepEqual(env.hud.children.map(node => node.textContent), terminalHud);
      primary();
      assert.equal(env.overlay.hidden, true);
      assert.ok(field('hp').includes('3/3'), 'replay restores all lives');
      assert.ok(field('time').includes('3:00'), 'replay restores full duration');
      assert.equal(field('score'), 'Счёт 0');
      assert.equal(env.writes.length, writes, 'starting replay does not save another result');
      assert.equal(env.frames.size, 1, 'replay does not duplicate RAF loop');
      app.destroy();
      assert.equal(env.frames.size, 0);
      assert.equal(env.window.listenerCount(), 0);
      assert.equal(env.document.listenerCount(), 0);
      assert.equal(env.media.listenerCount(), 0);
      // Mount again on the same targets to expose accumulated handlers/controls.
      app = mountGame(env);
      assert.equal(env.frames.size, 1);
      primary();
      assert.ok(field('hp').includes('3/3'));
      app.destroy();
      assert.equal(env.frames.size, 0);
      assert.equal(env.host.children.length, 3);
      checks.push(`client: ${blocked ? 'denied' : 'corrupt'} storage, pause/resume, one save, replay, remount cleanup`);
    } finally { app?.destroy(); env.restore(); }
  }
  return checks;
}
