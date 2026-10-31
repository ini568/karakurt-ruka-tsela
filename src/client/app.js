import { createGame, stepGame, serializeProgress, readProgress } from '../game/model.js';
import { renderGame } from '../art/renderer.js';
import { createAudio } from '../art/audio.js';
import { createInput } from './input.js';

const WIDTH = 1280;
const HEIGHT = 720;
const STEP = 1 / 60;
const MAX_STEPS = 5;
const STORAGE_KEY = 'karakurt.progress.v1';

export function mountGame({ canvas, overlay, hud }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Для игры необходим Canvas 2D.');
  const host = canvas.parentElement;
  const removers = [];
  const audio = createAudio();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let state = createGame({ seed: Date.now() >>> 0 });
  let mode = 'start';
  let destroyed = false;
  let muted = false;
  let lastTime = null;
  let accumulator = 0;
  let raf = 0;
  let resultSaved = false;
  let storageAvailable = true;
  let progress;
  try { progress = readProgress(window.localStorage.getItem(STORAGE_KEY)); }
  catch { progress = readProgress(null); storageAvailable = false; }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function sound(method, ...args) {
    try { const promise = audio[method](...args); promise?.catch?.(() => {}); } catch { /* Audio is optional. */ }
  }
  function unlock() { sound('unlock'); }
  const originalPosition = host.style.position;
  if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const input = createInput({ canvas, host, isActive: () => mode === 'playing', unlock });
  const originalTabIndex = canvas.getAttribute('tabindex');
  canvas.tabIndex = 0;
  const hudFields = {};
  hud.replaceChildren();
  for (const [key, label] of [['hp', 'Жизнь'], ['silk', 'Шёлк'], ['time', 'Время'], ['score', 'Счёт'], ['best', 'Рекорд']]) {
    const element = document.createElement('span');
    element.dataset.hud = key;
    element.setAttribute('aria-label', label);
    hudFields[key] = element;
    hud.append(element);
  }
  function button(label, action, parent = hud) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'game-button';
    element.textContent = label;
    element.addEventListener('click', () => { if (!destroyed) action(); });
    parent.append(element);
    return element;
  }
  const pauseButton = button('Пауза', () => pause());
  function toggleMute() {
    muted = !muted;
    sound('setMuted', muted);
    unlock();
    for (const control of [muteButton, ...overlay.querySelectorAll('[data-mute]')]) {
      control.textContent = muted ? 'Звук: выкл.' : 'Звук: вкл.';
      control.setAttribute('aria-pressed', String(muted));
      control.setAttribute('aria-label', muted ? 'Включить звук' : 'Отключить звук');
    }
  }
  const muteButton = button('Звук: вкл.', toggleMute);
  muteButton.setAttribute('aria-pressed', 'false');
  muteButton.setAttribute('aria-label', 'Отключить звук');

  function timeText(seconds) {
    const value = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  let hudText = '';
  function updateHud() {
    const values = {
      hp: `Жизнь ${'♥'.repeat(Math.max(0, Math.ceil(state.player.hp)))} ${state.player.hp}/3`,
      silk: `Шёлк ${Math.round(state.player.silk)}%`,
      time: `Осталось ${timeText(state.duration - state.time)}`,
      score: `Счёт ${state.score}`,
      best: `Рекорд ${Math.max(progress.bestScore, state.score)}`,
    };
    const text = JSON.stringify(values);
    if (text !== hudText) {
      for (const key of Object.keys(values)) hudFields[key].textContent = values[key];
      hudText = text;
    }
    pauseButton.disabled = mode !== 'playing';
  }
  function clearTiming() { accumulator = 0; lastTime = null; input.reset(); }
  // Per-party client bookkeeping for the final screen; never saved and never shared with the model.
  const HAZARD_NAMES = { slap: 'рука', glass: 'стакан', sweep: 'сметающий удар' };
  let run = { hits: 0, lastHit: null, seenHazards: new Set(), previousBest: 0 };
  // Last input.consume() aim in logical 1280×720; null until the party has sampled input (no anchor highlight).
  let aim = null;
  // Keys physically held while an overlay panel appears must not activate its button.
  const heldKeys = new Set();
  let staleKeys = new Set();
  const KEYBOARD_HINT = 'Клавиатура: WASD / стрелки — движение · наведите курсор на точку крепления и удерживайте ЛКМ или Space — паутина, отпустите — полёт по инерции · Shift — рывок (нужен шёлк) · Escape — пауза.';
  const TOUCH_HINT = 'Сенсор: левая половина поля или «Движение ↔» — направление · правая половина или «Паутина ◎» — удерживайте у точки крепления (от кнопки можно тянуть палец к любой точке) · «Рывок» — отдельная кнопка.';
  function panel(title, paragraphs, actionLabel, action) {
    overlay.replaceChildren();
    overlay.hidden = false;
    staleKeys = new Set(heldKeys);
    const section = document.createElement('section');
    section.className = 'game-panel';
    section.setAttribute('aria-labelledby', 'game-panel-title');
    const heading = document.createElement('h1');
    heading.id = 'game-panel-title';
    heading.textContent = title;
    section.append(heading);
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      section.append(p);
    }
    const primary = button(actionLabel, action, section);
    if (mode === 'paused') {
      const sound = button(muted ? 'Звук: выкл.' : 'Звук: вкл.', toggleMute, section);
      sound.dataset.mute = '';
      sound.setAttribute('aria-pressed', String(muted));
      sound.setAttribute('aria-label', muted ? 'Включить звук' : 'Отключить звук');
    }
    overlay.append(section);
    input.setVisible();
    primary.focus({ preventScroll: true });
  }
  function start() {
    // The mode guard makes repeated clicks/keys a no-op once the party is running.
    if (destroyed || document.hidden || (mode !== 'start' && mode !== 'result')) return;
    unlock();
    state = createGame({ seed: Date.now() >>> 0 });
    run = { hits: 0, lastHit: null, seenHazards: new Set(), previousBest: progress.bestScore };
    resultSaved = false;
    aim = null;
    mode = 'playing';
    clearTiming();
    overlay.hidden = true;
    overlay.replaceChildren();
    input.setVisible();
    canvas.focus({ preventScroll: true });
    updateHud();
  }
  function resume() {
    if (destroyed || mode !== 'paused' || document.hidden) return;
    unlock();
    mode = 'playing';
    clearTiming();
    overlay.hidden = true;
    overlay.replaceChildren();
    input.setVisible();
    canvas.focus({ preventScroll: true });
    updateHud();
  }
  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    clearTiming();
    panel('Пауза', [
      `Время остановлено: осталось ${timeText(state.duration - state.time)}, жизнь ${state.player.hp}/3, счёт ${state.score}.`,
      KEYBOARD_HINT,
      TOUCH_HINT,
      'Нажмите «Продолжить» или Escape. Зажатые клавиши после паузы нужно нажать заново.',
    ], 'Продолжить', resume);
    updateHud();
  }
  function saveResult() {
    if (resultSaved) return;
    resultSaved = true;
    const result = readProgress(serializeProgress(state));
    // Refresh another tab's records, but never let inaccessible storage stop play.
    let stored = readProgress(null);
    try { stored = readProgress(window.localStorage.getItem(STORAGE_KEY)); }
    catch { storageAvailable = false; }
    progress = {
      version: 1,
      bestScore: Math.max(progress.bestScore, stored.bestScore, result.bestScore),
      bestSurvival: Math.max(progress.bestSurvival, stored.bestSurvival, result.bestSurvival),
      wins: Math.max(progress.wins, stored.wins) + result.wins,
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); storageAvailable = true; }
    catch { storageAvailable = false; }
  }
  function lossReason() {
    const name = HAZARD_NAMES[run.lastHit];
    const last = name ? `Последний удар: ${name}.` : 'Здоровье закончилось.';
    const tip = run.lastHit === 'sweep'
      ? 'Сметающий удар идёт полосой через всё поле: уходите поперёк полосы, а не вдоль.'
      : run.lastHit === 'glass'
        ? 'Стакан держится дольше руки: покиньте контур до удара и не возвращайтесь, пока он не исчезнет.'
        : 'Контур «СКОРО» показывает, куда ударят: выйдите из него рывком или на паутине до вспышки «УДАР».';
    return `Паук получил ${run.hits} ${run.hits === 1 ? 'удар' : run.hits < 5 ? 'удара' : 'ударов'} и потерял все 3 жизни. ${last} ${tip}`;
  }
  function scoreBreakdown() {
    const parts = [
      `выживание ${Math.floor(state.time)} с × 5 = +${Math.floor(state.time) * 5}`,
      // Fly reward is the model's current +100 per catch.
      `мухи ${state.stats.flies} × 100 = +${state.stats.flies * 100}`,
      `уклонения ${state.stats.dodges} × 25 = +${state.stats.dodges * 25}`,
    ];
    if (run.hits) parts.push(`удары ${run.hits} × 10 = −${run.hits * 10}`);
    if (state.status === 'won') parts.push('рассвет +500');
    return `Итог: ${state.score} очков (${parts.join(' · ')}).`;
  }
  function finish() {
    mode = 'result';
    clearTiming();
    saveResult();
    const won = state.status === 'won';
    const record = state.score > run.previousBest && state.score > 0;
    panel(won ? 'Рука цела' : 'Паук попался', [
      `Счёт: ${state.score} · Уклонения: ${state.stats.dodges} · Мухи: ${state.stats.flies}`,
      won ? `Паук дожил до рассвета: 3:00 выжито, осталось жизней ${state.player.hp}/3.` : lossReason(),
      won ? scoreBreakdown() : `Продержались ${timeText(state.time)} из 3:00. ${scoreBreakdown()}`,
      record ? `Новый рекорд! Прежний: ${run.previousBest}.` : `Рекорд: ${progress.bestScore} · Побед: ${progress.wins}`,
      ...(storageAvailable ? [] : ['Хранилище недоступно: рекорд сохранён только до закрытия этой страницы.']),
      'Сыграть ещё раз: кнопка «Новая партия» или клавиша Enter.',
    ], 'Новая партия', start);
    updateHud();
  }
  listen(window, 'keydown', (event) => {
    if (!overlay.hidden && (event.repeat || staleKeys.has(event.code))) {
      // Auto-repeat of a key held from gameplay (Enter/Space) would click the focused panel button.
      if (event.code !== 'Escape' && event.code !== 'Tab') event.preventDefault();
    }
    // Enter starts a new party from the start/result panels even if the button lost focus.
    // start() ignores any other mode, so the focused button's own click cannot start twice.
    if (event.code === 'Enter' && !event.repeat && !staleKeys.has(event.code) && (mode === 'start' || mode === 'result')) {
      event.preventDefault();
      start();
      return;
    }
    heldKeys.add(event.code);
    if (event.code !== 'Escape' || event.repeat) return;
    event.preventDefault();
    if (mode === 'playing') pause();
    else if (mode === 'paused') resume();
  });
  listen(window, 'keyup', (event) => {
    heldKeys.delete(event.code);
    // Space activates buttons on keyup: releasing a key held since play must not restart/resume.
    if (staleKeys.delete(event.code) && !overlay.hidden) event.preventDefault();
  });
  function dropHeldKeys() { heldKeys.clear(); staleKeys.clear(); }
  listen(window, 'blur', () => { input.reset(); dropHeldKeys(); pause(); });
  listen(window, 'pagehide', () => { input.reset(); dropHeldKeys(); pause(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { input.reset(); dropHeldKeys(); pause(); } });

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / WIDTH, height / HEIGHT);
    ctx.setTransform(scale, 0, 0, scale, (width - WIDTH * scale) / 2, (height - HEIGHT * scale) / 2);
    renderGame(ctx, state, { width: WIDTH, height: HEIGHT, reducedMotion: motion.matches, aim });
  }
  function observeStep() {
    // Events are replaced on every model step, not consumed per render frame.
    for (const event of state.events) {
      // 'warning' sounds only from the per-id tracking below, so a model event cannot double it.
      if (event.type !== 'warning') sound('play', event.type);
      if (event.type === 'hurt') {
        run.hits++;
        const source = state.hazards.find((hazard) => hazard.phase === 'active');
        if (source) run.lastHit = source.kind;
      }
    }
    for (const hazard of state.hazards) {
      if (hazard.phase === 'warning' && !run.seenHazards.has(hazard.id)) {
        run.seenHazards.add(hazard.id);
        sound('play', 'warning');
      }
    }
    if (run.seenHazards.size > 64) {
      const live = new Set(state.hazards.map((hazard) => hazard.id));
      run.seenHazards = new Set([...run.seenHazards].filter((id) => live.has(id)));
    }
  }
  function frame(now) {
    if (destroyed) return;
    // Do not rely on visibilitychange arriving before a queued animation frame.
    if (document.hidden && mode === 'playing') pause();
    if (mode === 'playing') {
      if (lastTime !== null) accumulator += Math.min(Math.max((now - lastTime) / 1000, 0), STEP * MAX_STEPS);
      lastTime = now;
      let steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS && mode === 'playing') {
        const sample = input.consume();
        aim = { x: sample.aimX, y: sample.aimY };
        stepGame(state, sample, STEP);
        observeStep();
        accumulator -= STEP;
        steps++;
        if (state.status !== 'playing') finish();
      }
      if (steps === MAX_STEPS) accumulator = 0;
    } else { lastTime = null; accumulator = 0; }
    updateHud();
    draw();
    raf = window.requestAnimationFrame(frame);
  }
  panel('КАРАКУРТ: Рука цела', [
    'Цель: продержаться 3:00 и не потерять все 3 жизни. Рука, стакан и сметающий удар бьют туда, где паук стоял при появлении контура «СКОРО». Контур безопасен: выйдите из него до вспышки «УДАР».',
    'Управление: WASD или стрелки — ход · ЛКМ или Space (удерживать у точки крепления) — паутина · Shift — рывок · Escape — пауза. Начать можно кнопкой или клавишей Enter.',
    'Очки: +5 за секунду, +25 за уклонение, +100 за муху (она ещё и пополняет шёлк), −10 за удар, +500 за рассвет.',
    KEYBOARD_HINT,
    TOUCH_HINT,
    `Рекорд: ${progress.bestScore} · Побед: ${progress.wins}`,
    ...(storageAvailable ? [] : ['Хранилище недоступно — играть можно, но рекорд не переживёт перезагрузку.']),
  ], 'Начать ночь', start);
  updateHud();
  raf = window.requestAnimationFrame(frame);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.cancelAnimationFrame(raf);
      input.destroy();
      sound('dispose');
      for (const remove of removers) remove();
      overlay.replaceChildren();
      overlay.hidden = true;
      hud.replaceChildren();
      host.style.position = originalPosition;
      if (originalTabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', originalTabIndex);
    },
  };
}
