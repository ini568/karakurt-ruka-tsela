// Static delivery and real public exports; no server, network, source mutation or browser claim.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');
const manifest = JSON.parse(await text('package.json'));
assert.equal(manifest.type, 'module', 'browser modules remain ES modules');
assert.equal(manifest.scripts.test, 'node --test tests/model.test.mjs');
assert.equal(manifest.scripts.check, 'node tools/check.mjs');
const html = await text('index.html');
for (const id of ['game-root', 'game-canvas', 'game-hud', 'game-overlay']) {
  assert.equal([...html.matchAll(new RegExp(`\\bid=["']${id}["']`, 'g'))].length, 1, `${id}: one real document element`);
}
assert.match(html, /<canvas\b[^>]*\bid=["']game-canvas["']/i);
const entry = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi)]
  .find(match => /\btype=["']module["']/.test(match[1] + match[3]));
assert.ok(entry, 'document loads an external module entry');
assert.equal(new URL(entry[2], new URL('index.html', root)).href, new URL('src/main.js', root).href);
const visited = new Set();
async function inspect(url) {
  assert.ok(url.href.startsWith(root.href), `module stays in delivery: ${url.href}`);
  if (visited.has(url.href)) return;
  visited.add(url.href);
  assert.ok((await stat(url)).isFile(), `module exists: ${fileURLToPath(url)}`);
  const source = await readFile(url, 'utf8');
  // This project's import grammar uses string-literal static/dynamic imports.
  const imports = [...source.matchAll(/\bimport\s+(?:[^;\n]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
    .map(match => match[1] || match[2]);
  for (const specifier of imports) {
    assert.match(specifier, /^\.{1,2}\//, `${url.pathname}: local browser import, not Node/network/package: ${specifier}`);
    const dependency = new URL(specifier, url);
    assert.match(dependency.pathname, /\.js$/, `browser JS dependency: ${specifier}`);
    await inspect(dependency);
  }
}
await inspect(new URL('src/main.js', root));
for (const path of ['src/client/app.js', 'src/client/input.js', 'src/game/model.js', 'src/game/world.js', 'src/art/renderer.js', 'src/art/audio.js', 'src/art/palette.js']) {
  assert.ok(visited.has(new URL(path, root).href), `entry reaches ${path}`);
}
for (const path of ['src/art/styles.css', 'README.md', 'tests/acceptance.md']) {
  assert.ok((await text(path)).trim().length > 0, `${path}: nonempty delivery file`);
}
for (const [path, names] of [
  ['src/game/model.js', ['createGame', 'stepGame', 'serializeProgress', 'readProgress']],
  ['src/game/world.js', ['updateHazards', 'spawnFly', 'burst']],
  ['src/client/app.js', ['mountGame']], ['src/client/input.js', ['createInput']],
  ['src/art/renderer.js', ['renderGame']], ['src/art/audio.js', ['createAudio']],
]) {
  const module = await import(new URL(path, root));
  for (const name of names) assert.equal(typeof module[name], 'function', `${path}: real callable export ${name}`);
}
const { createGame, serializeProgress, readProgress } = await import(new URL('src/game/model.js', root));
const progress = JSON.parse(serializeProgress(createGame({ seed: 1 })));
assert.deepEqual(progress, { version: 1, bestScore: 0, bestSurvival: 0, wins: 0 }, 'unchanged saved-progress schema');
for (const invalid of [null, '', '{broken', '[]', '{"version":2,"bestScore":999}']) {
  assert.deepEqual(readProgress(invalid), progress, `corrupt or unsupported progress: ${invalid}`);
}
const sanitized = readProgress('{"version":1,"bestScore":-5,"bestSurvival":999,"wins":-1}');
assert.deepEqual(sanitized, { version: 1, bestScore: 0, bestSurvival: 180, wins: 0 });
console.log('REGRESSION OK: final/delivery — local entry graph, real exports, progress compatibility (not browser acceptance)');
