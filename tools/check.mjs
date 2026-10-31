#!/usr/bin/env node
// Статическая проверка проекта перед деплоем, без зависимостей.
//
//   node tools/check.mjs            — проверить корень проекта (папка над tools/)
//   node tools/check.mjs <папка>    — проверить другую папку (используется фикстурами)
//
// Что проверяется:
//  * index.html: каждый относительный src/href существует на диске с ТОЧНЫМ регистром
//    (Windows/macOS прощают «Src/Main.js», Linux-хостинг — нет);
//  * <script src> и import не ссылаются на внешние URL (http://, https://, //cdn...);
//  * все .js/.mjs в src/ (и модули, достижимые по import): локальные import
//    существуют, «голые» спецификаторы ('three', 'lodash') и node: запрещены —
//    без сборки браузер их не разрешит; tests/ и tools/ отдельно не обходятся;
//  * импортируемые имена реально экспортируются целевым модулем
//    (export function/class/const/let/var, export default, export {...}, export * from).
// Также: обязательные файлы, package.json type=module, локальные CSS-ресурсы,
// отсутствие внешних URL в загружаемых HTML/JS/CSS. Никакой код игры не исполняется.
// Итог: «CHECK OK» и код 0, либо ошибки «путь:строка: сообщение» и код 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..'));

const errors = [];
const checked = new Set();
const dirCache = new Map();

const rel = (p) => path.relative(root, p).split(path.sep).join('/') || '.';
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const err = (file, line, msg) => errors.push(`${rel(file)}${line ? ':' + line : ''}: ${msg}`);

// ---------- файловая система с точным регистром ----------

function listDir(dir) {
  if (!dirCache.has(dir)) {
    let names = null;
    try { names = fs.readdirSync(dir); } catch { names = null; }
    dirCache.set(dir, names);
  }
  return dirCache.get(dir);
}

/** Возвращает null, если путь существует с точным регистром, иначе текст проблемы. */
function exactExists(abs) {
  const relPath = path.relative(root, abs);
  if (relPath === '..' || relPath.startsWith('..' + path.sep) || path.isAbsolute(relPath)) {
    return 'путь вне корня статического сайта';
  }
  const parts = relPath.split(path.sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    const names = listDir(cur);
    if (!names) return 'файл не найден';
    if (!names.includes(part)) {
      const alt = names.find((n) => n.toLowerCase() === part.toLowerCase());
      return alt
        ? `регистр не совпадает: «${part}», на диске «${alt}» (на Linux-хостинге будет 404)`
        : 'файл не найден';
    }
    cur = path.join(cur, part);
  }
  try {
    if (!fs.statSync(abs).isFile()) return 'ожидается файл, получена папка';
  } catch { return 'файл недоступен'; }
  return null;
}

function walk(dir, out) {
  const names = listDir(dir);
  if (!names) return out;
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(n)) out.push(p);
  }
  return out;
}

// ---------- разбор JS ----------

/**
 * Заменяет комментарии пробелами (длина и переводы строк сохраняются, чтобы номера
 * строк совпадали). Строки и шаблоны оставляет как есть. Регулярные выражения
 * не распознаются — для кода игры этого достаточно.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { out += src[i++]; }
        if (i < n) out += src[i++];
        if (c !== '`' && src[i - 1] === '\n') break; // незакрытая строка — не тянем дальше
      }
      if (i < n) out += src[i++];
    } else {
      out += c; i++;
    }
  }
  return out;
}

const parseCache = new Map();

function readJs(abs) {
  if (!parseCache.has(abs)) {
    let raw = null;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch { raw = null; }
    parseCache.set(abs, raw === null ? null : stripComments(raw));
  }
  return parseCache.get(abs);
}

/** Список импортов: {spec, idx, names:[импортируемые имена]|null, kind}. */
function findImports(code) {
  const res = [];
  let m;
  // import X from '..' | import {a as b} from '..' | import * as ns from '..' | import '..'
  const reImport = /(^|[^\w$.])import\s*(?:([\w$*\s{},]+?)\s*from\s*)?(['"])([^'"\n]+)\3/g;
  while ((m = reImport.exec(code))) {
    res.push({ spec: m[4], idx: m.index + m[1].length, names: parseImportClause(m[2]), kind: 'import' });
  }
  // export {a, b as c} from '..' | export * from '..' | export * as ns from '..'
  const reReexport = /(^|[^\w$.])export\s*(\*\s*(?:as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\3/g;
  while ((m = reReexport.exec(code))) {
    const clause = m[2].trim();
    const names = clause.startsWith('{') ? parseBraces(clause).map((x) => x.local) : [];
    res.push({ spec: m[4], idx: m.index + m[1].length, names, kind: 'export-from' });
  }
  // import('..') — только строковый литерал
  const reDyn = /(^|[^\w$.])import\s*\(\s*(['"`])([^'"`\n]+)\2\s*\)/g;
  while ((m = reDyn.exec(code))) {
    res.push({ spec: m[3], idx: m.index + m[1].length, names: [], kind: 'dynamic' });
  }
  return res;
}

/** «{ a, b as c, default as d }» → [{local:'a', alias:'a'}, ...] */
function parseBraces(text) {
  const inner = text.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '');
  return inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = s.split(/\s+as\s+/);
    return { local: parts[0].trim(), alias: (parts[1] || parts[0]).trim() };
  });
}

function parseImportClause(clause) {
  if (!clause) return [];
  const names = [];
  const c = clause.trim();
  const brace = c.indexOf('{');
  const head = (brace >= 0 ? c.slice(0, brace) : c).replace(/,\s*$/, '').trim();
  if (head && !head.startsWith('*')) {
    const def = head.split(',')[0].trim();
    if (def) names.push('default');
  }
  if (brace >= 0) for (const b of parseBraces(c.slice(brace))) names.push(b.local);
  return names;
}

/** Множество экспортируемых имён модуля (с раскрытием export * from). */
function collectExports(abs, stack = new Set()) {
  const code = readJs(abs);
  const names = new Set();
  if (code === null || stack.has(abs)) return names;
  stack.add(abs);
  let m;
  const reDecl = /(^|[^\w$.])export\s+(?:async\s+)?(?:function\s*\*?|class)\s*([\w$]+)/g;
  while ((m = reDecl.exec(code))) names.add(m[2]);
  const reVar = /(^|[^\w$.])export\s+(?:const|let|var)\s+([\w$]+|\{[^}]*\}|\[[^\]]*\])/g;
  while ((m = reVar.exec(code))) {
    const t = m[2];
    if (t[0] === '{' || t[0] === '[') {
      t.slice(1, -1).split(',').forEach((p) => {
        const nm = p.split(/[:=]/).pop().trim().replace(/^\.\.\./, '');
        const id = (p.includes(':') ? p.split(':')[1] : p).split('=')[0].trim().replace(/^\.\.\./, '');
        if (/^[\w$]+$/.test(id)) names.add(id); else if (/^[\w$]+$/.test(nm)) names.add(nm);
      });
    } else names.add(t);
  }
  if (/(^|[^\w$.])export\s+default\b/.test(code)) names.add('default');
  const reList = /(^|[^\w$.])export\s*(\{[^}]*\})(\s*from\s*(['"])([^'"\n]+)\4)?/g;
  while ((m = reList.exec(code))) for (const b of parseBraces(m[2])) names.add(b.alias);
  const reStar = /(^|[^\w$.])export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*(['"])([^'"\n]+)\3/g;
  while ((m = reStar.exec(code))) {
    if (m[2]) { names.add(m[2]); continue; }
    if (!isRelative(m[4])) continue;
    const target = resolveSpec(abs, m[4]);
    for (const nm of collectExports(target, stack)) if (nm !== 'default') names.add(nm);
  }
  stack.delete(abs);
  return names;
}

// ---------- спецификаторы ----------

const isExternal = (s) => /^(https?:)?\/\//i.test(s);
const isRelative = (s) => s.startsWith('./') || s.startsWith('../') || s.startsWith('/');
const isSkippable = (s) => !s || s.startsWith('#') || /^(data|blob|mailto|tel|javascript|about):/i.test(s);

function resolveSpec(fromFile, spec) {
  let clean;
  try { clean = decodeURIComponent(spec.split(/[?#]/)[0]); }
  catch { err(fromFile, 0, `некорректный URL: ${spec}`); return path.join(root, '__invalid_url__'); }
  return clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(fromFile), clean);
}

// ---------- проверка модуля ----------

const queue = [];

// URL-литералы запрещены и вне import (fetch, Worker, шрифты, изображения).
// Это намеренно консервативная проверка, не полноценный парсер JavaScript.
function checkExternalUrls(file, code) {
  const re = /https?:\/\/[^\s'"`<>)]*|(['"`(=]\s*)(\/\/[^\s'"`<>)]*)/gi;
  for (const m of code.matchAll(re)) {
    err(file, lineOf(code, m.index), `внешний URL запрещён: ${m[2] || m[0]}`);
  }
}

function checkModuleCode(file, code) {
  checkExternalUrls(file, code);
  for (const imp of findImports(code)) {
    const line = lineOf(code, imp.idx);
    const spec = imp.spec;
    if (isExternal(spec)) { err(file, line, `внешний URL в ${imp.kind}: ${spec} (без CDN — положите файл в проект)`); continue; }
    if (spec.startsWith('node:')) {
      err(file, line, `Node-импорт '${spec}' недоступен в браузере; Node-проверки размещайте в tests/, не в src/`);
      continue;
    }
    if (!isRelative(spec)) { err(file, line, `«голый» спецификатор '${spec}' — без сборки браузер его не найдёт, используйте './…'`); continue; }
    if (spec.includes('\\')) { err(file, line, `import '${spec}': в браузерном URL нужны прямые слеши '/'`); continue; }
    const target = resolveSpec(file, spec);
    const problem = exactExists(target);
    if (problem) { err(file, line, `import '${spec}' → ${rel(target)}: ${problem}`); continue; }
    if (!/\.m?js$/i.test(target)) {
      err(file, line, `import '${spec}': ожидается браузерный .js/.mjs-модуль с расширением в пути`);
      continue;
    }
    queue.push(target);
    if (!imp.names || imp.names.length === 0) continue;
    const exported = collectExports(target);
    for (const nm of imp.names) {
      if (!exported.has(nm)) {
        const list = [...exported].sort().join(', ') || 'нет экспортов';
        err(file, line, `'${nm}' не экспортируется из ${rel(target)} (есть: ${list})`);
      }
    }
  }
}

function checkJsFile(abs) {
  if (checked.has(abs)) return;
  checked.add(abs);
  const code = readJs(abs);
  if (code === null) { err(abs, 0, 'не удалось прочитать файл'); return; }
  checkModuleCode(abs, code);
}

function checkCss(abs) {
  if (checked.has(abs)) return;
  checked.add(abs);
  let code;
  try { code = fs.readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' ')); }
  catch { err(abs, 0, 'не удалось прочитать CSS'); return; }
  checkExternalUrls(abs, code);
  const resources = /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi;
  for (const m of code.matchAll(resources)) {
    const spec = m[1] || m[2];
    if (spec.startsWith('#') || spec.startsWith('data:')) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(spec)) {
      err(abs, lineOf(code, m.index), `нелокальный CSS-ресурс: ${spec}`);
      continue;
    }
    const target = resolveSpec(abs, spec);
    const problem = exactExists(target);
    if (problem) err(abs, lineOf(code, m.index), `${spec} → ${rel(target)}: ${problem}`);
    else if (/\.css$/i.test(target)) checkCss(target);
  }
}

// ---------- проверка HTML ----------

function checkHtml(abs) {
  checked.add(abs);
  let html;
  try { html = fs.readFileSync(abs, 'utf8'); } catch { err(abs, 0, 'файл не найден — index.html обязателен в корне'); return; }
  // Комментарии заменяем пробелами, сохраняя переводы строк.
  html = html.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));

  const reTag = /<(script|link|img|source|audio|video|iframe|a|use|image)\b([^>]*)>/gi;
  let m;
  while ((m = reTag.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const line = lineOf(html, m.index);
    const reAttr = /(?:^|\s)(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
    let a;
    while ((a = reAttr.exec(attrs))) {
      const url = (a[2] ?? a[3] ?? a[4] ?? '').trim();
      if (isSkippable(url)) continue;
      if (isExternal(url) || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
        if (tag !== 'a') err(abs, line, `внешний URL в <${tag}>: ${url} (без CDN)`);
        continue; // обычные навигационные ссылки не загружают игровой код
      }
      const target = resolveSpec(abs, url);
      const problem = exactExists(target);
      if (problem) { err(abs, line, `<${tag} ${a[1].toLowerCase()}="${url}"> → ${rel(target)}: ${problem}`); continue; }
      if (tag === 'script' && a[1].toLowerCase() === 'src') {
        if (!/\btype\s*=\s*(?:"module"|'module'|module(?=\s|$))/i.test(attrs)) {
          err(abs, line, `<script src="${url}">: для ES-модуля требуется type="module"`);
        }
        if (!/\.m?js$/i.test(target)) err(abs, line, `<script src="${url}">: ожидается .js/.mjs-модуль`);
        else queue.push(target);
      }
      if (/\.css$/i.test(target)) checkCss(target);
    }
  }

  // Встроенные <script type="module"> без src тоже могут импортировать.
  const reInline = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = reInline.exec(html))) {
    if (/\bsrc\s*=/.test(m[1]) || !/type\s*=\s*["']?module/i.test(m[1])) continue;
    const offset = m.index + m[0].indexOf('>') + 1;
    const pad = html.slice(0, offset).replace(/[^\n]/g, ' ');
    checkModuleCode(abs, stripComments(pad + m[2]));
  }
}

// ---------- запуск ----------

const required = [
  'index.html', 'src/main.js', 'src/client/app.js', 'src/game/model.js',
  'src/art/renderer.js', 'src/art/audio.js', 'src/art/styles.css',
  'src/art/palette.js', 'package.json',
];
for (const name of required) {
  const file = path.join(root, name);
  const problem = exactExists(file);
  if (problem) err(file, 0, `обязательный файл: ${problem}`);
}
const packageFile = path.join(root, 'package.json');
try {
  const config = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (config?.type !== 'module') err(packageFile, 0, 'требуется type="module"');
} catch (error) { err(packageFile, 0, `не удалось прочитать JSON: ${error.message}`); }
checkHtml(path.join(root, 'index.html'));
checkCss(path.join(root, 'src/art/styles.css'));
for (const f of walk(path.join(root, 'src'), [])) queue.push(f);
while (queue.length) checkJsFile(queue.shift());

if (errors.length) {
  console.error(`FAIL: ${errors.length} error(s) in ${rel(root) === '.' ? root : rel(root)}`);
  for (const e of errors) console.error('  ' + e);
  process.exitCode = 1;
} else {
  console.log('CHECK OK');
}
