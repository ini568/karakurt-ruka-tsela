async function start() {
  const canvas = document.getElementById('game-canvas');
  const overlay = document.getElementById('game-overlay');
  const hud = document.getElementById('game-hud');

  try {
    if (!(canvas instanceof HTMLCanvasElement) || !overlay || !hud) {
      throw new Error('Не найдены обязательные элементы игрового экрана.');
    }

    // Catch module loading failures too, rather than leaving the loading panel forever.
    const { mountGame } = await import('./client/app.js');
    mountGame({ canvas, overlay, hud });
  } catch (error) {
    console.error('Не удалось запустить игру:', error);
    const panel = document.createElement('section');
    panel.className = 'game-panel';
    panel.setAttribute('role', 'alert');
    const heading = document.createElement('h1');
    heading.textContent = 'Не удалось открыть ночную комнату';
    const message = document.createElement('p');
    message.textContent = 'Перезагрузите страницу. Если ошибка повторяется, проверьте консоль браузера и запуск через локальный HTTP-сервер на порту 8080.';
    panel.append(heading, message);
    if (overlay) {
      overlay.hidden = false;
      overlay.replaceChildren(panel);
    } else {
      // A malformed document must still expose a readable failure message.
      (document.getElementById('game-root') || document.body).append(panel);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
