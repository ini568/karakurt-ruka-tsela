// Client flow regressions through the real mountGame and createInput (no model/renderer stubs).
// Run standalone: node tests/regression/client-flow.mjs
import assert from 'node:assert/strict';
import { mountGame } from '../../src/client/app.js';
import { createInput } from '../../src/client/input.js';
import { environment } from './harness.mjs';

const STORAGE_KEY = 'karakurt.progress.v1';
const passed = [];

// 1. Blur clears held keys and pointers in the input layer itself.
{
  const env = environment();
  let input;
  try {
    input = createInput({ ...env, isActive: () => true, unlock() {} });
    env.window.emit('keydown', { code: 'KeyD', repeat: false });
    env.window.emit('keydown', { code: 'KeyS', repeat: false });
    env.window.emit('keydown', { code: 'Space', repeat: false });
    let sample = input.consume();
    assert.equal(sample.moveX, 1, 'зажатая D двигает вправо до blur');
    assert.equal(sample.webHeld, true, 'Space держит паутину до blur');
    env.canvas.emit('pointerdown', { pointerId: 9, clientX: 900, clientY: 200, pointerType: 'mouse', button: 0, buttons: 1 });
    env.window.emit('keydown', { code: 'ShiftLeft', repeat: false });
    env.window.emit('blur');
    sample = input.consume();
    assert.deepEqual([sample.moveX, sample.moveY, sample.webHeld, sample.dashPressed], [0, 0, false, false],
      'blur сбрасывает клавиши, ЛКМ и неизрасходованный рывок');
    // OS auto-repeat after Alt+Tab is not a fresh press.
    env.window.emit('keydown', { code: 'KeyD', repeat: true });
    assert.equal(input.consume().moveX, 0, 'автоповтор после blur не возобновляет движение');
  } finally { input?.destroy(); env.restore(); }
  passed.push('client-flow: blur сбрасывает ввод, автоповтор не воскрешает клавишу');
}

for (const blocked of [false, true]) {
  const env = environment({ blocked, storage: null });
  let app;
  try {
    env.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    env.canvas.getContext = () => ({});
    app = mountGame(env);
    const label = blocked ? 'недоступное хранилище' : 'рабочее хранилище';
    const primary = () => {
      const button = env.overlay.descendants().find(node => node.tagName === 'BUTTON');
      assert.ok(button, `на панели есть основное действие (${label})`);
      button.emit('click');
    };
    const field = key => {
      const node = env.hud.children.find(child => child.dataset.hud === key);
      assert.ok(node, `поле HUD ${key}`);
      return node.textContent;
    };
    const fresh = when => {
      assert.equal(env.overlay.hidden, true, `${when}: партия идёт`);
      assert.ok(field('hp').includes('3/3'), `${when}: 3 здоровья, получено «${field('hp')}»`);
      assert.ok(field('time').includes('3:00'), `${when}: таймер 3:00 (180 с), получено «${field('time')}»`);
    };
    let now = 1000;
    const startButton = env.overlay.descendants().find(node => node.tagName === 'BUTTON');
    primary();
    fresh('первый старт');
    env.tick(now);
    for (let i = 0; i < 90; i++) env.tick(now += 20);
    const runningTime = field('time');
    assert.notEqual(runningTime, 'Осталось 3:00', 'таймер идёт после старта');
    // A double click on the (already removed) start button must not restart the party or add a loop.
    startButton.emit('click');
    assert.equal(field('time'), runningTime, 'повторный клик «Начать» не перезапускает идущую партию');
    assert.equal(env.frames.size, 1, 'один цикл requestAnimationFrame');

    // 2. Blur in a running game pauses and resets: held D does not move the spider during/after pause.
    env.tick(now);
    for (let i = 0; i < 60; i++) env.tick(now += 20);
    env.window.emit('keydown', { code: 'KeyD', repeat: false });
    env.tick(now += 20);
    env.window.emit('blur');
    assert.equal(env.overlay.hidden, false, 'blur ставит игру на паузу');

    // 3. Pause does not advance the timer, even across a huge wall-clock gap.
    const pausedTime = field('time');
    const pausedScore = field('score');
    for (let i = 0; i < 200; i++) env.tick(now += 1000);
    assert.equal(field('time'), pausedTime, 'пауза не двигает таймер');
    assert.equal(field('score'), pausedScore, 'пауза не начисляет очки');
    primary();
    assert.equal(env.overlay.hidden, true, 'продолжение снимает паузу');
    env.tick(now += 60000);
    assert.equal(field('time'), pausedTime, 'первый кадр после паузы не догоняет пропущенное время');
    // Escape pause path as well.
    env.window.emit('keydown', { code: 'Escape', repeat: false });
    assert.equal(env.overlay.hidden, false, 'Escape ставит паузу');
    const escTime = field('time');
    for (let i = 0; i < 50; i++) env.tick(now += 1000);
    assert.equal(field('time'), escTime, 'пауза по Escape не двигает таймер');
    env.window.emit('keydown', { code: 'Escape', repeat: false });
    assert.equal(env.overlay.hidden, true, 'повторный Escape продолжает');
    env.tick(now += 20);
    for (let i = 0; i < 90; i++) env.tick(now += 20);
    assert.notEqual(field('time'), escTime, 'после продолжения время снова идёт');

    // 4. Play to the natural end with real steps; exactly one save per party.
    const writesBefore = env.writes.length;
    let frames = 0;
    while (env.overlay.hidden && frames++ < 12000) env.tick(now += 20);
    assert.equal(env.overlay.hidden, false, 'пассивная партия завершается в пределах 180 с');
    const writesAfterFirst = env.writes.length - writesBefore;
    if (blocked) assert.equal(writesAfterFirst, 0, 'недоступное хранилище не ломает финал');
    else {
      assert.equal(writesAfterFirst, 1, `одна запись сохранения за партию, получено ${writesAfterFirst}`);
      assert.equal(env.writes.at(-1).key, STORAGE_KEY);
      const saved = JSON.parse(env.writes.at(-1).value);
      assert.equal(saved.version, 1, 'формат сохранения версии 1');
      for (const key of ['bestScore', 'bestSurvival', 'wins']) {
        assert.ok(Number.isFinite(saved[key]) && saved[key] >= 0, `сохранение содержит ${key}`);
      }
    }
    for (let i = 0; i < 200; i++) env.tick(now += 20);
    env.window.emit('blur');
    env.document.hidden = true;
    env.document.emit('visibilitychange');
    env.document.hidden = false;
    assert.equal(env.writes.length - writesBefore, writesAfterFirst, 'кадры, blur и смена вкладки на финале не пишут результат повторно');

    // 5. Replay: 3 hp, 3:00, score 0, no extra save, single RAF loop.
    primary();
    fresh('повтор');
    assert.equal(field('score'), 'Счёт 0', 'повтор начинает со счёта 0');
    assert.equal(env.writes.length - writesBefore, writesAfterFirst, 'старт повтора не пишет сохранение');
    assert.equal(env.frames.size, 1, 'повтор не дублирует цикл кадров');
    env.tick(now += 20);
    for (let i = 0; i < 30; i++) env.tick(now += 20);
    assert.ok(field('hp').includes('3/3'), 'в начале повтора здоровье не наследуется из прошлой партии');

    // Second party also ends with exactly one more write.
    frames = 0;
    while (env.overlay.hidden && frames++ < 12000) env.tick(now += 20);
    assert.equal(env.overlay.hidden, false, 'вторая партия завершается');
    for (let i = 0; i < 100; i++) env.tick(now += 20);
    const secondWrites = env.writes.length - writesBefore - writesAfterFirst;
    assert.equal(secondWrites, blocked ? 0 : 1, `вторая партия — ровно одна запись, получено ${secondWrites}`);
    primary();
    fresh('второй повтор');
    passed.push(`client-flow (${label}): blur/Escape-пауза без сдвига таймера, одна запись за партию, повтор с 3 здоровьями и 3:00`);
  } finally { app?.destroy(); env.restore(); }
}

for (const line of passed) console.log(`PASS ${line}`);
console.log('REGRESSION OK');
