// Negative checks run only in disposable copies; product and acceptance fixtures stay untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = path.join(root, '.sharrowkin');
fs.mkdirSync(scratch, { recursive: true });
const cases = [
  ['warning damage', 'src/game/world.js', "if (h.phase !== 'active') continue;", "if (false) continue;", 'model'],
  ['repeated dodge', 'src/game/world.js', 'state.hazards.splice(i, 1);', '// defect: keep completed hazard', 'model'],
  ['invalid victory', 'src/game/model.js', "state.player.hp <= 0 ? 'lost'", "state.player.hp < 0 ? 'lost'", 'model'],
  ['paused timer', 'src/client/app.js', 'function frame(now) {', "function frame(now) { if (mode === 'paused') stepGame(state, {}, STEP);", 'client'],
  ['resume catch-up', 'src/client/app.js', "mode = 'playing';\n    clearTiming();\n    overlay.hidden = true;", "mode = 'playing';\n    lastTime = 0;\n    overlay.hidden = true;", 'client'],
  ['repeated save', 'src/client/app.js', 'function frame(now) {', "function frame(now) { if (mode === 'result') { resultSaved = false; saveResult(); }", 'client'],
];
const report = path.join(scratch, 'negative-results.txt');
fs.writeFileSync(report, 'START\n');
for (const [name, file, from, to, suite] of cases) {
  const copy = fs.mkdtempSync(path.join(scratch, 'negative-'));
  try {
    for (const dir of ['src', 'tests']) fs.cpSync(path.join(root, dir), path.join(copy, dir), { recursive: true });
    for (const file of ['package.json', 'index.html']) fs.copyFileSync(path.join(root, file), path.join(copy, file));
    const target = path.join(copy, file);
    const source = fs.readFileSync(target, 'utf8');
    assert.ok(source.includes(from), `${name}: mutation target exists`);
    fs.writeFileSync(target, source.replaceAll(from, to));
    const result = spawnSync(process.execPath, [`tests/regression/final/${suite}.mjs`], { cwd: copy, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `${name}: regression must reject the defect`);
    assert.match(result.stderr, /AssertionError/, `${name}: must fail an assertion, not module loading`);
    assert.ok(!result.stdout.includes('REGRESSION OK'), `${name}: must not print success`);
    if (name === 'warning damage') {
      const runner = spawnSync(process.execPath, ['tests/regression/run.mjs'], { cwd: copy, encoding: 'utf8', timeout: 30000 });
      assert.ifError(runner.error);
      assert.equal(runner.status, 1, 'full runner propagates failure');
      assert.match(runner.stderr, /FAIL final\/model.mjs/);
      assert.match(runner.stdout, /REGRESSION OK: final\/delivery/, 'runner continues after failure');
    }
    fs.appendFileSync(report, `PASS negative: ${name}\n`);
    console.log(`PASS negative: ${name}`);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}
fs.appendFileSync(report, 'REGRESSION OK\n');
console.log('REGRESSION OK: negative checks in disposable copies');
