import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberate allowlist of this game's actual runtime graph, not a repository copy.
// When adding a runtime resource, review it and add its exact path here.
const files = [
  'index.html',
  'src/main.js',
  'src/client/app.js',
  'src/client/input.js',
  'src/game/model.js',
  'src/game/world.js',
  'src/art/renderer.js',
  'src/art/palette.js',
  'src/art/audio.js',
  'src/art/styles.css',
];
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const allowed = new Set(files);
const siteBase = new URL('https://static.invalid/repository/');

function references(source, extension) {
  const found = [];
  const collect = (pattern) => {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  };
  if (extension === '.html') {
    collect(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi);
    if (/<base\b/i.test(source)) throw new Error('A <base> element requires a publishing review.');
  }
  if (extension === '.js') {
    collect(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']/g);
    collect(/\bimport\s*\(\s*["']([^"']+)["']/g);
    collect(/\b(?:fetch|new\s+URL|new\s+Worker|new\s+Audio)\s*\(\s*["']([^"']+)["']/g);
  }
  if (extension === '.css') {
    collect(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi);
    collect(/@import\s+["']([^"']+)["']/gi);
  }
  return found;
}

async function regularFile(relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`Refusing symbolic link: ${relative}`);
    }
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Not a regular file: ${relative}`);
  const actual = await realpath(current);
  const relativeActual = path.relative(await realpath(root), actual);
  if (relativeActual.startsWith('..') || path.isAbsolute(relativeActual)) {
    throw new Error(`Resource escapes project: ${relative}`);
  }
}

async function prepare() {
  // Validate before removing a previous artifact. No source file is rewritten.
  for (const file of files) {
    await regularFile(file);
    const source = await readFile(path.join(root, file), 'utf8');
    for (const reference of references(source, path.extname(file))) {
      if (reference.startsWith('#') || reference.startsWith('data:')) continue;
      if (reference.startsWith('/') || reference.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(reference)) {
        throw new Error(`Non-portable resource in ${file}: ${reference}`);
      }
      const resolved = new URL(reference, new URL(file, siteBase));
      if (!resolved.href.startsWith(siteBase.href)) {
        throw new Error(`Resource escapes site prefix in ${file}: ${reference}`);
      }
      const target = decodeURIComponent(resolved.pathname.slice(siteBase.pathname.length));
      if (!allowed.has(target)) {
        throw new Error(`Unreviewed or missing resource in ${file}: ${reference}. Update the explicit publishing allowlist.`);
      }
    }
  }
  try {
    const stat = await lstat(output);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('dist must be a real directory, not a link or file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // dist is generated output only. Clean it so old or private files cannot survive.
  // Keep the directory itself: Windows locks it while a preview uses it as cwd.
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(output)) {
    await rm(path.join(output, entry), { recursive: true, force: true });
  }
  for (const file of files) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
  }
  await writeFile(path.join(output, '.nojekyll'), '');
  console.log(`Prepared dist/: ${files.length} runtime files and .nojekyll. This is a local artifact, not a public deployment.`);
}

prepare().catch((error) => {
  console.error(`Pages preparation failed: ${error.message}`);
  process.exitCode = 1;
});
