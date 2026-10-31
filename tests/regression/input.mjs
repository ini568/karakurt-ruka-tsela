import assert from 'node:assert/strict';
import { createInput } from '../../src/client/input.js';
import { environment } from './harness.mjs';

export function checkInput() {
  const env = environment();
  let input;
  const checks = [];
  const pointer = (pointerId, x = 100, y = 500, pointerType = 'touch') =>
    ({ pointerId, clientX: x, clientY: y, pointerType, button: 0, buttons: 1 });
  const neutral = message => {
    const sample = input.consume();
    assert.equal(sample.moveX, 0, message);
    assert.equal(sample.moveY, 0, message);
    assert.equal(sample.webHeld, false, message);
    assert.equal(sample.dashPressed, false, message);
  };
  try {
    input = createInput({ ...env, isActive: () => true, unlock() {} });
    for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      const target = ending === 'lostpointercapture' ? env.canvas : env.window;
      env.canvas.emit('pointerdown', pointer(1, 900, 200, 'mouse'));
      assert.equal(input.consume().webHeld, true, `${ending}: mouse held before release`);
      target.emit(ending, ending === 'pointerup' ? pointer(1, 900, 200, 'mouse') : { pointerId: 1 });
      assert.equal(input.consume().webHeld, false, `${ending}: mouse does not stick, even without pointerType`);

      env.canvas.emit('pointerdown', pointer(2));
      env.window.emit('pointermove', pointer(2, 148, 452));
      env.canvas.emit('pointerdown', pointer(3, 900, 200));
      assert.equal(input.consume().moveX, 1);
      assert.equal(input.consume().webHeld, true);
      target.emit(ending, { ...pointer(3, 900, 200), button: 0 });
      let sample = input.consume();
      assert.equal(sample.moveX, 1, `${ending}: releasing web must preserve independent movement`);
      assert.equal(sample.webHeld, false);
      target.emit(ending, pointer(2));
      neutral(`${ending}: both contacts released`);

      // Reverse cancellation order: releasing movement must preserve the web contact.
      env.canvas.emit('pointerdown', pointer(2));
      env.window.emit('pointermove', pointer(2, 148, 452));
      env.canvas.emit('pointerdown', pointer(3, 900, 200));
      target.emit(ending, pointer(2));
      sample = input.consume();
      assert.equal(sample.moveX, 0);
      assert.equal(sample.webHeld, true, `${ending}: releasing movement preserves web`);
      target.emit(ending, pointer(3, 900, 200));
      neutral(ending);
    }
    checks.push('input: up/cancel/lost capture; independent movement and web contacts');

    env.canvas.emit('pointerdown', pointer(1, 900, 200, 'mouse'));
    env.window.emit('pointerup', { ...pointer(1, 900, 200, 'mouse'), button: 2, buttons: 1 });
    assert.equal(input.consume().webHeld, true, 'secondary mouse release must not release held LMB');
    env.window.emit('pointerup', { ...pointer(1, 900, 200, 'mouse'), buttons: 0 });
    neutral('LMB release');
    const capture = env.canvas.setPointerCapture;
    env.canvas.setPointerCapture = () => { throw new Error('capture unavailable'); };
    env.canvas.emit('pointerdown', pointer(1, 900, 200, 'mouse'));
    assert.equal(input.consume().webHeld, true, 'capture refusal does not abort input');
    env.window.emit('pointercancel', { pointerId: 1 });
    neutral('cancel after refused capture');
    env.canvas.setPointerCapture = capture;
    checks.push('input: secondary mouse button and refused pointer capture');

    for (const reset of [() => input.reset(), () => env.window.emit('blur')]) {
      env.window.emit('keydown', { code: 'KeyD', repeat: false });
      env.window.emit('keydown', { code: 'Space', repeat: false });
      env.window.emit('keydown', { code: 'ShiftLeft', repeat: false });
      env.canvas.emit('pointerdown', pointer(5));
      env.window.emit('pointermove', pointer(5, 148, 500));
      env.canvas.emit('pointerdown', pointer(6, 900, 200));
      reset();
      neutral('reset/blur clears keys, contacts and unconsumed dash');
      env.window.emit('pointermove', pointer(5, 148, 500));
      neutral('orphan movement after reset does not resurrect contact');
      env.window.emit('keyup', { code: 'KeyD' });
      env.window.emit('keyup', { code: 'Space' });
      env.window.emit('keyup', { code: 'ShiftLeft' });
      env.window.emit('keydown', { code: 'ShiftLeft', repeat: false });
      assert.equal(input.consume().dashPressed, true);
      assert.equal(input.consume().dashPressed, false, 'dash impulse is consumed once');
      env.window.emit('keyup', { code: 'ShiftLeft' });
    }
    checks.push('input: explicit reset, blur, orphan events and single dash impulse');
    input.destroy();
    neutral('destroy clears input');
    assert.equal(env.window.listenerCount(), 0);
    assert.equal(env.canvas.listenerCount(), 0);
    assert.equal(env.media.listenerCount(), 0);
    assert.equal(env.host.children.length, 3, 'destroy removes injected touch controls');
    checks.push('input: destroy removes listeners and injected controls');
    return checks;
  } finally { input?.destroy(); env.restore(); }
}
