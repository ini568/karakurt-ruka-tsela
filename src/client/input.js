const WIDTH = 1280;
const HEIGHT = 720;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Coordinates use the very same contain/letterbox transform as the renderer.
export function createInput({ canvas, host, isActive, unlock }) {
  const keys = new Set();
  const pointers = new Map();
  const removers = [];
  let dashPressed = false;
  let destroyed = false;
  let aimX = WIDTH / 2;
  let aimY = HEIGHT / 3;
  let aimClient = null;
  let mouseChord = false;
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT) || 1;
    return {
      x: clamp((event.clientX - rect.left - (rect.width - WIDTH * scale) / 2) / scale, 0, WIDTH),
      y: clamp((event.clientY - rect.top - (rect.height - HEIGHT * scale) / 2) / scale, 0, HEIGHT),
    };
  }
  function updateAim(event) {
    aimClient = { clientX: event.clientX, clientY: event.clientY };
    const p = point(aimClient);
    aimX = p.x;
    aimY = p.y;
  }
  function down(event, forcedRole, target = event.currentTarget) {
    if (destroyed || !isActive()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) {
      // Only an observed secondary press may begin the RMB → LMB chord fallback.
      mouseChord = true;
      return;
    }
    if (event.pointerType === 'mouse') mouseChord = false;
    event.preventDefault();
    unlock();
    // A lost pointerup (released outside the window) must not leave a stale capture behind.
    release(event.pointerId);
    const role = forcedRole || (event.pointerType === 'mouse' ? 'web' : point(event).x < WIDTH / 2 ? 'move' : 'web');
    if (role === 'dash') dashPressed = true;
    pointers.set(event.pointerId, {
      role, target, mouse: event.pointerType === 'mouse',
      startX: event.clientX, startY: event.clientY, x: 0, y: 0,
    });
    // Capture can fail when the browser has already cancelled this pointer.
    try { target?.setPointerCapture?.(event.pointerId); } catch { /* Window listeners remain the fallback. */ }
    if (role === 'web') updateAim(event);
  }
  function move(event) {
    const tracked = pointers.get(event.pointerId);
    // Pointerup is delayed until every mouse button is released during a chord.
    if (tracked?.mouse && typeof event.buttons === 'number' && !(event.buttons & 1)) release(event.pointerId);
    // RMB first, then LMB: browsers report the LMB press as pointermove (button 0), not pointerdown.
    if (!tracked && mouseChord && event.pointerType === 'mouse' && event.button === 0 && typeof event.buttons === 'number' &&
        (event.buttons & 1) && event.target === canvas) down(event, 'web', canvas);
    if (event.pointerType === 'mouse' && event.buttons === 0) mouseChord = false;
    const pointer = pointers.get(event.pointerId);
    if (pointer) {
      if (pointer.role === 'move') {
        pointer.x = clamp((event.clientX - pointer.startX) / 48, -1, 1);
        pointer.y = clamp((event.clientY - pointer.startY) / 48, -1, 1);
      } else if (pointer.role === 'web') updateAim(event);
      event.preventDefault();
    } else if (event.pointerType === 'mouse' && isActive()) updateAim(event);
  }
  function release(pointerId) {
    const pointer = pointers.get(pointerId);
    if (!pointer) return;
    pointers.delete(pointerId);
    try { pointer.target?.releasePointerCapture?.(pointerId); } catch { /* Capture may already be lost. */ }
  }
  function up(event) {
    // In a mouse chord, releasing RMB while LMB is still down must not release the web.
    const pointer = pointers.get(event.pointerId);
    if (pointer?.mouse && event.button !== 0 && typeof event.buttons === 'number' && (event.buttons & 1)) return;
    release(event.pointerId);
  }
  function cancel(event) { release(event.pointerId); }
  // Fallback for an LMB released outside the window when no pointerup/lostpointercapture was
  // delivered (capture refused): legacy mouseup still reaches the window, so the web is dropped.
  function mouseUp(event) {
    if (typeof event.buttons === 'number' && (event.buttons & 1) && event.button !== 0) return;
    for (const [pointerId, pointer] of [...pointers]) if (pointer.mouse) release(pointerId);
  }
  function reset() {
    keys.clear();
    mouseChord = false;
    aimClient = null;
    aimX = WIDTH / 2;
    aimY = HEIGHT / 3;
    dashPressed = false;
    for (const pointerId of [...pointers.keys()]) release(pointerId);
  }
  const codes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
  listen(window, 'keydown', (event) => {
    if (!isActive() || !codes.has(event.code)) return;
    event.preventDefault();
    // After pause/blur, an OS repeat is not a fresh press.
    if (event.repeat && !keys.has(event.code)) return;
    keys.add(event.code);
    if (!event.repeat && event.code.startsWith('Shift')) dashPressed = true;
  });
  listen(window, 'keyup', (event) => {
    // Space keyup on a focused button would otherwise "click" it during play.
    if (isActive() && codes.has(event.code)) event.preventDefault();
    keys.delete(event.code);
    // With Meta held (macOS), the browser never delivers keyup for other keys.
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') keys.clear();
  });
  listen(canvas, 'pointerdown', (event) => down(event));
  listen(window, 'pointermove', move, { passive: false });
  listen(window, 'pointerup', up);
  listen(window, 'pointercancel', cancel);
  listen(window, 'mouseup', mouseUp);
  listen(canvas, 'lostpointercapture', cancel);
  // Alt+Tab / tab switch: keyup and pointerup are delivered elsewhere, so drop all held input.
  listen(window, 'blur', reset);
  listen(window, 'pagehide', reset);
  if (typeof document.addEventListener === 'function') {
    listen(document, 'visibilitychange', () => { if (document.hidden) reset(); });
  }
  listen(canvas, 'contextmenu', (event) => event.preventDefault());

  const controls = document.createElement('div');
  controls.dataset.touchControls = '';
  controls.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
  const touchMedia = window.matchMedia('(pointer: coarse)');
  function addZone(text, role, css) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-button';
    button.textContent = text;
    button.setAttribute('aria-label', text);
    button.style.cssText = `position:absolute;pointer-events:auto;touch-action:none;user-select:none;opacity:.8;${css}`;
    listen(button, 'pointerdown', (event) => down(event, role));
    listen(button, 'lostpointercapture', cancel);
    controls.append(button);
  }
  addZone('Движение ↔', 'move', 'left:3%;bottom:18px;width:32%;min-height:76px;');
  addZone('Паутина ◎', 'web', 'right:3%;bottom:18px;width:32%;min-height:76px;');
  addZone('Рывок', 'dash', 'left:38%;bottom:24px;width:24%;min-height:60px;');
  host.append(controls);
  function setVisible() {
    controls.hidden = !isActive() || !touchMedia.matches;
  }
  listen(touchMedia, 'change', setVisible);
  setVisible();

  return {
    setVisible,
    reset,
    consume() {
      if (destroyed || !isActive()) reset();
      // Layout can move/resize without pointermove (including while LMB is held).
      if (aimClient) updateAim(aimClient);
      const has = (...values) => values.some((key) => keys.has(key));
      let moveX = Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft'));
      let moveY = Number(has('KeyS', 'ArrowDown')) - Number(has('KeyW', 'ArrowUp'));
      let webHeld = keys.has('Space');
      for (const pointer of pointers.values()) {
        if (pointer.role === 'move') { moveX += pointer.x; moveY += pointer.y; }
        if (pointer.role === 'web') webHeld = true;
      }
      const input = { moveX: clamp(moveX, -1, 1), moveY: clamp(moveY, -1, 1), aimX, aimY, webHeld, dashPressed };
      dashPressed = false;
      return input;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of removers) remove();
      reset();
      controls.remove();
      canvas.style.touchAction = originalTouchAction;
    },
  };
}
