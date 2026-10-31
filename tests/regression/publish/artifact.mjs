import assert from 'node:assert/strict';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../dist/', import.meta.url));
const files = new Set();
const forbidden = new Set(['tests', 'research', 'docs', 'tools', 'node_modules', 'coverage', 'dist', 'build', '__pycache__']);

async function walk(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    assert.ok(!entry.name.startsWith('.') || (name === '.nojekyll' && entry.isFile()), `hidden service entry in dist: ${name}`);
    assert.ok(!forbidden.has(entry.name.toLowerCase()), `forbidden entry in dist: ${name}`);
    assert.ok(!/(?:^|[._-])(?:secret|credentials?|private[-_]?key)(?:[._-]|$)|\.(?:pem|key|pfx|p12|map|log|bak)$/i.test(entry.name), `service/secret file in dist: ${name}`);
    assert.ok(!/^(?:package(?:-lock)?\.json|README(?:\..*)?|TASK\.md|SKILL\.md|tsconfig\.json)$/i.test(entry.name), `development file in dist: ${name}`);
    assert.ok(!entry.isSymbolicLink(), `symlink is not a portable Pages resource: ${name}`);
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
    else {
      assert.ok(entry.isFile(), `non-file artifact entry: ${name}`);
      files.add(name);
    }
  }
}

// Missing dist is an error, not a skipped check and never an artifact success.
assert.ok((await lstat(root)).isDirectory(), 'prepare dist with node tools/prepare-pages.mjs first');
await walk(root);
for (const required of ['index.html', '.nojekyll', 'src/main.js', 'src/client/app.js', 'src/client/input.js', 'src/game/model.js', 'src/game/world.js', 'src/art/styles.css', 'src/art/renderer.js', 'src/art/palette.js', 'src/art/audio.js']) {
  assert.ok(files.has(required), `missing required artifact file: ${required}`);
}

function references(text, extension) {
  const result = [];
  const collect = regex => { for (const match of text.matchAll(regex)) result.push(match[1]); };
  if (extension === '.html') {
    assert.ok(!/<base\b/i.test(text), 'base tag must not override prefix-relative deployment');
    collect(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi);
  }
  if (['.js', '.mjs', '.html'].includes(extension)) {
    collect(/\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s*)?["']([^"']+)["']/g);
    collect(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
    collect(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g);
  }
  if (['.css', '.html'].includes(extension)) {
    collect(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi);
    collect(/@import\s+["']([^"']+)["']/gi);
  }
  return result;
}

let checked = 0;
for (const name of files) {
  const extension = path.posix.extname(name);
  if (!['.html', '.css', '.js', '.mjs'].includes(extension)) continue;
  const text = await readFile(path.join(root, ...name.split('/')), 'utf8');
  assert.ok(!/\b(?:localhost|127\.0\.0\.1)\b/i.test(text), `local development host in ${name}`);
  for (const raw of references(text, extension)) {
    const reference = raw.trim().replaceAll('&amp;', '&');
    if (!reference || reference.startsWith('#') || /^(?:data|blob|mailto|tel):/i.test(reference)) continue;
    // External URLs are not local resources; protocol-relative/root-relative URLs are not prefix-safe.
    if (/^https?:\/\//i.test(reference)) continue;
    assert.ok(!reference.startsWith('/') && !reference.includes('\\'), `non-relative resource in ${name}: ${reference}`);
    assert.ok(!/^[a-z][a-z\d+.-]*:/i.test(reference), `unsupported resource scheme in ${name}: ${reference}`);
    assert.ok(reference.startsWith('.') || !['.js', '.mjs'].includes(extension), `bare browser import in ${name}: ${reference}`);
    for (const prefix of ['/', '/github-pages/repository/']) {
      const base = new URL(prefix, 'https://artifact.invalid');
      const resolved = new URL(reference, new URL(name, base));
      assert.equal(resolved.origin, base.origin);
      assert.ok(resolved.pathname.startsWith(base.pathname), `resource escapes deployment prefix: ${name} -> ${reference}`);
      const target = decodeURIComponent(resolved.pathname.slice(base.pathname.length));
      assert.ok(files.has(target), `missing local resource under ${prefix}: ${name} -> ${reference} (${target})`);
    }
    checked++;
  }
}
assert.ok(checked >= 9, 'expected real HTML and game module dependency links');
console.log(`REGRESSION OK: publish/artifact (${files.size} files, ${checked} local references; root and prefix resolution)`);
