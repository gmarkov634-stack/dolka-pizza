(() => {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();

  const user = tg.initDataUnsafe?.user;
  const fillTelegramName = () => {
    const input = document.getElementById('customerName');
    if (!input || input.value.trim() || !user) return;
    input.value = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fillTelegramName, { once: true });
  } else {
    fillTelegramName();
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const requestUrl = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(options.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

    if (
      method === 'POST' &&
      requestUrl.endsWith('/api/orders') &&
      tg.initData &&
      typeof options.body === 'string'
    ) {
      try {
        const body = JSON.parse(options.body);
        body.telegramInitData = tg.initData;
        options = { ...options, body: JSON.stringify(body) };
      } catch {
        // Обычная отправка заказа продолжится без Telegram-привязки.
      }
    }

    return originalFetch(input, options);
  };
})();
