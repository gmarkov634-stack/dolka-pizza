import { url, money, esc } from './shared.js';

const $ = id => document.getElementById(id);
const sessionKey = 'dolka_admin_token_v1';
const statuses = [
  'Новый', 'Подтверждён', 'Готовится', 'Готов',
  'Передан курьеру', 'Завершён', 'Отменён'
];

let token = sessionStorage.getItem(sessionKey) || '';

async function request(path, options = {}) {
  const response = await fetch(url(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(body?.error || `Ошибка ${response.status}`);
  }

  return body;
}

window.dolkaAdminApi = request;

function setLoggedIn(value) {
  $('login').classList.toggle('hidden', value);
  $('main').classList.toggle('show', value);
}

function notify(message, type = 'ok') {
  $('feedback').textContent = message;
  $('feedback').className = `feedback show ${type}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    $('feedback').className = 'feedback';
  }, 3000);
}

async function login() {
  try {
    const response = await fetch(url('/api/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Не удалось войти.');

    token = body.token;
    sessionStorage.setItem(sessionKey, token);
    $('loginFeedback').className = 'feedback';
    setLoggedIn(true);
    await loadAll();
  } catch (error) {
    $('loginFeedback').textContent = error.message;
    $('loginFeedback').className = 'feedback show error';
  }
}

function handleSessionError(error) {
  if (error.message.includes('Сессия') || error.message.includes('Требуется вход')) {
    token = '';
    sessionStorage.removeItem(sessionKey);
    setLoggedIn(false);
    return true;
  }
  return false;
}

function renderOrders(rows) {
  $('orders').innerHTML = rows.length
    ? rows.map(order => `
      <tr>
        <td><strong>${esc(order.id)}</strong></td>
        <td>${new Date(order.createdAt).toLocaleString('ru-RU')}</td>
        <td>${esc(order.customerName)}<br><a href="tel:${esc(order.phone)}">${esc(order.phone)}</a></td>
        <td>${esc(order.deliveryLabel)}</td>
        <td>${esc(order.paymentLabel)}<br>${esc(order.paymentStatus)}</td>
        <td><strong>${money(order.totalKopecks)}</strong></td>
        <td>
          <select data-status="${esc(order.id)}" style="margin:0;min-width:160px">
            ${statuses.map(status => `
              <option ${status === order.status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
        </td>
        <td><button class="button" data-save-order="${esc(order.id)}" type="button">Сохранить</button></td>
      </tr>
    `).join('')
    : '<tr><td colspan="8">Заказов нет.</td></tr>';

  $('orders').querySelectorAll('[data-save-order]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveOrder;
      const select = $('orders').querySelector(`[data-status="${CSS.escape(id)}"]`);
      try {
        await request(`/api/admin/orders/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: select.value })
        });
        notify('Статус сохранён.');
        await loadOrders();
      } catch (error) {
        if (!handleSessionError(error)) notify(error.message, 'error');
      }
    });
  });
}

async function loadOrders() {
  const filter = $('filter').value;
  const query = filter ? `?status=${encodeURIComponent(filter)}` : '';
  try {
    renderOrders(await request(`/api/admin/orders${query}`));
  } catch (error) {
    if (!handleSessionError(error)) notify(error.message, 'error');
  }
}

function productEditor(product = {}) {
  const originalId = product.id || `new-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const displayedId = product.id || `product-${Date.now()}`;

  return `
    <article class="product-editor" data-product-row="${esc(originalId)}">
      <div class="product-editor-grid">
        <label>
          ID
          <input data-field="id" value="${esc(displayedId)}" maxlength="100">
        </label>
        <label>
          Категория
          <input data-field="category" value="${esc(product.category || 'Пицца')}" maxlength="80">
        </label>
        <label>
          Название
          <input data-field="name" value="${esc(product.name || '')}" maxlength="120">
        </label>
        <label>
          Цена, ₽
          <input data-field="priceRubles" type="number" min="0" step="1"
                 value="${Number(product.priceKopecks || 0) / 100}">
        </label>
        <label class="full">
          Описание
          <textarea data-field="description" maxlength="500">${esc(product.description || '')}</textarea>
        </label>
        <label class="full">
          Ссылка на фотографию
          <input data-field="imageUrl" value="${esc(product.imageUrl || '')}" maxlength="800"
                 placeholder="https://.../photo.jpg">
        </label>
        <label>
          Значок
          <input data-field="emoji" value="${esc(product.emoji || '🍕')}" maxlength="10">
        </label>
        <label>
          Порядок
          <input data-field="sortOrder" type="number" value="${Number(product.sortOrder || 100)}">
        </label>
        <label class="switch-row compact">
          <input data-field="available" type="checkbox" ${product.available !== false ? 'checked' : ''}>
          <span><strong>Доступен</strong></span>
        </label>
      </div>
      <div class="actions product-editor-actions">
        <button class="button primary" data-save-product type="button">Сохранить</button>
        <button class="button danger-button" data-delete-product type="button">Удалить</button>
      </div>
    </article>
  `;
}

function bindProductEditors() {
  $('productsAdmin').querySelectorAll('[data-product-row]').forEach(row => {
    if (row.dataset.bound === '1') return;
    row.dataset.bound = '1';

    row.querySelector('[data-save-product]').addEventListener('click', async () => {
      const field = name => row.querySelector(`[data-field="${name}"]`);
      const body = {
        id: field('id').value.trim(),
        category: field('category').value.trim(),
        name: field('name').value.trim(),
        description: field('description').value.trim(),
        priceKopecks: Math.round(Number(field('priceRubles').value || 0) * 100),
        imageUrl: field('imageUrl').value.trim(),
        emoji: field('emoji').value.trim(),
        sortOrder: Number(field('sortOrder').value || 100),
        available: field('available').checked
      };

      try {
        await request(`/api/admin/products/${encodeURIComponent(row.dataset.productRow)}`, {
          method: 'PUT',
          body: JSON.stringify(body)
        });
        notify('Товар сохранён.');
        await loadProducts();
      } catch (error) {
        if (!handleSessionError(error)) notify(error.message, 'error');
      }
    });

    row.querySelector('[data-delete-product]').addEventListener('click', async () => {
      if (!confirm('Удалить этот товар?')) return;
      try {
        if (row.dataset.productRow.startsWith('new-')) {
          row.remove();
          return;
        }
        await request(`/api/admin/products/${encodeURIComponent(row.dataset.productRow)}`, {
          method: 'DELETE'
        });
        notify('Товар удалён.');
        await loadProducts();
      } catch (error) {
        if (!handleSessionError(error)) notify(error.message, 'error');
      }
    });
  });
}

async function loadProducts() {
  try {
    const products = await request('/api/admin/products');
    $('productsAdmin').innerHTML = products.map(productEditor).join('');
    bindProductEditors();
  } catch (error) {
    if (!handleSessionError(error)) notify(error.message, 'error');
  }
}

async function loadSettings() {
  try {
    const settings = await request('/api/admin/settings');
    $('businessName').value = settings.businessName || '';
    $('businessPhone').value = settings.phone || '';
    $('businessAddress').value = settings.address || '';
    $('workingHours').value = settings.workingHours || '';
    $('deliveryPrice').value = settings.deliveryPriceRubles ?? 0;
    $('minimumOrder').value = settings.minimumOrderRubles ?? 0;
    $('acceptOrders').checked = Boolean(settings.acceptOrders);
    $('inventoryEnabled').checked = Boolean(settings.inventoryEnabled);
    $('cashEnabled').checked = Boolean(settings.cashEnabled);
    $('cardEnabled').checked = Boolean(settings.cardOnDeliveryEnabled);
    $('sbpEnabled').checked = Boolean(settings.sbpEnabled);
  } catch (error) {
    if (!handleSessionError(error)) notify(error.message, 'error');
  }
}

async function saveSettings() {
  try {
    await request('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        businessName: $('businessName').value.trim(),
        phone: $('businessPhone').value.trim(),
        address: $('businessAddress').value.trim(),
        workingHours: $('workingHours').value.trim(),
        deliveryPriceRubles: Number($('deliveryPrice').value || 0),
        minimumOrderRubles: Number($('minimumOrder').value || 0),
        acceptOrders: $('acceptOrders').checked,
        inventoryEnabled: $('inventoryEnabled').checked,
        cashEnabled: $('cashEnabled').checked,
        cardOnDeliveryEnabled: $('cardEnabled').checked,
        sbpEnabled: $('sbpEnabled').checked
      })
    });
    notify('Настройки сохранены.');
  } catch (error) {
    if (!handleSessionError(error)) notify(error.message, 'error');
  }
}

async function loadAll() {
  await Promise.all([loadOrders(), loadProducts(), loadSettings()]);
}

async function verifySession() {
  if (!token) return setLoggedIn(false);
  try {
    await request('/api/admin/me');
    setLoggedIn(true);
    await loadAll();
  } catch {
    token = '';
    sessionStorage.removeItem(sessionKey);
    setLoggedIn(false);
  }
}

$('filter').innerHTML = '<option value="">Все статусы</option>' +
  statuses.map(status => `<option>${status}</option>`).join('');

$('loginButton').addEventListener('click', login);
$('password').addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});
$('logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); } catch {}
  token = '';
  sessionStorage.removeItem(sessionKey);
  setLoggedIn(false);
});
$('refresh').addEventListener('click', loadOrders);
$('filter').addEventListener('change', loadOrders);
$('addProduct').addEventListener('click', () => {
  $('productsAdmin').insertAdjacentHTML('afterbegin', productEditor());
  bindProductEditors();
  $('productsAdmin').firstElementChild?.scrollIntoView({ behavior: 'smooth' });
});
$('saveSettings').addEventListener('click', saveSettings);

$('export').addEventListener('click', async () => {
  try {
    const response = await fetch(url('/api/admin/orders.csv'), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Не удалось сформировать CSV.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `dolka-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    notify(error.message, 'error');
  }
});

document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    document.querySelectorAll('.admin-section').forEach(section => {
      section.classList.toggle('show', section.id === button.dataset.tab);
    });
  });
});

verifySession();
