import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the real checker against an in-memory overlay; never damage the delivery.
const root = fileURLToPath(new URL('../../', import.meta.url));
const checkerUrl = new URL('../../tools/check.mjs', import.meta.url);
const checker = fs.readFileSync(checkerUrl, 'utf8')
  .replace(/^#![^\n]*\n/, '')
  .replace(/^import .*;\r?$/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(checkerUrl.href));
const execute = new Function('fs', 'path', 'fileURLToPath', 'process', 'console', checker);
const entry = path.join(root, 'src/main.js');
const original = fs.readFileSync(entry, 'utf8');
function run(suffix = '') {
  const messages = [];
  const process = { argv: ['node', 'check', root], exitCode: 0 };
  const overlay = {
    ...fs,
    readFileSync(file, ...args) {
      if (path.resolve(file) === entry) return original + suffix;
      return fs.readFileSync(file, ...args);
    },
  };
  execute(overlay, path, fileURLToPath, process, {
    log: message => messages.push(message), error: message => messages.push(message),
  });
  return { status: process.exitCode, text: messages.join('\n') };
}
assert.equal(run().status, 0, 'untouched static delivery must pass');
for (const [suffix, diagnostic] of [
  ["\nimport './missing-resource.js';", /missing-resource\.js.*файл не найден/],
  ["\nimport('node:fs');", /Node-импорт/],
  ["\nimport('../package.json');", /ожидается браузерный/],
  ["\nimport { absentExport } from './game/model.js';", /absentExport.*не экспортируется/],
]) {
  const result = run(suffix);
  assert.equal(result.status, 1, `checker must reject ${suffix}`);
  assert.match(result.text, diagnostic);
}
console.log('REGRESSION OK: real checker rejects missing imports, Node imports, JSON and absent exports without editing source');
