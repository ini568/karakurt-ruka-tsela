// Exercise the real publish/model assertions against disposable copies of real modules.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), 'karakurt-model-negative-'));
const files = ['package.json', 'src/game/model.js', 'src/game/world.js', 'tests/regression/publish/model.mjs'];
function runCase(name, mutation, expected) {
  const copy = path.join(scratch, name);
  for (const file of files) {
    const destination = path.join(copy, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(root, file), destination);
  }
  if (mutation) {
    const [file, from, to] = mutation;
    const target = path.join(copy, file);
    const source = readFileSync(target, 'utf8');
    assert.equal(source.split(from).length - 1, 1, `${name}: mutation must match exactly once`);
    writeFileSync(target, source.replace(from, to));
  }
  const result = spawnSync(process.execPath, ['tests/regression/publish/model.mjs'], {
    cwd: copy, encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${name}: process must not be killed`);
  if (!mutation) {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REGRESSION OK: publish\/model/);
  } else {
    assert.equal(result.status, 1, `${name}: assertions must reject the real defect`);
    assert.match(result.stderr, /AssertionError/);
    assert.match(result.stderr, expected, `${name}: expected behavioral assertion, not a loading error`);
    assert.doesNotMatch(result.stdout, /REGRESSION OK/);
  }
  console.log(`PASS model-negative: ${name}`);
}
try {
  runCase('intact-control');
  for (const kind of ['slap', 'glass', 'sweep']) {
    runCase(`warning-${kind}`, [
      'src/game/world.js',
      "if (h.phase !== 'active') continue;",
      `if (h.phase !== 'active' && h.kind !== '${kind}') continue;`,
    ], new RegExp(`${kind}: warning must not damage`));
  }
  runCase('directionless-silk', [
    'src/game/model.js',
    'if (length >= 0.01) {',
    'if (length < 0.01) p.silk -= 28;\n    if (length >= 0.01) {',
  ], /directionless dash must not spend silk/);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('REGRESSION OK: publish/model-negative (intact control and 4 real-module mutations)');
