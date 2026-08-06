import { api, esc } from './shared.js?v=2';

const rub = kopecks => `${(Number(kopecks || 0) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const qty = (value, unit) => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${unit || ''}`;

let loaded = false;
let current = null;

async function adminApi(path, options = {}) {
  if (typeof window.dolkaAdminApi === 'function') return window.dolkaAdminApi(path, options);
  return api(path, options);
}

function ensureUi() {
  const tabs = document.querySelector('.admin-tabs');
  const adminMain = document.querySelector('.admin-main');
  if (!tabs || !adminMain || document.getElementById('inventoryAdminSection')) return false;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'button admin-tab';
  tab.id = 'inventoryAdminTab';
  tab.textContent = 'Склад и прибыль';
  tabs.append(tab);

  const section = document.createElement('section');
  section.id = 'inventoryAdminSection';
  section.className = 'admin-section inventory-admin';
  section.innerHTML = `
    <div class="inventory-toolbar">
      <div>
        <h2>Склад и прибыль</h2>
        <div class="help">Остатки, движения, закупка и маржинальный доход по блюдам.</div>
      </div>
      <div class="inventory-toolbar-actions">
        <button class="button" id="inventoryLinkRecipes">Связать рецептуры</button>
        <button class="button primary" id="inventoryRefresh">Обновить</button>
      </div>
    </div>
    <div id="inventoryFeedback" class="feedback"></div>
    <div id="inventoryMetrics" class="inventory-metrics"></div>
    <div class="inventory-grid">
      <article class="card inventory-panel inventory-wide">
        <div class="inventory-panel-head"><h3>Остатки</h3><span class="help">Приход, списание и инвентаризация</span></div>
        <div class="table-wrap"><table><thead><tr><th>Ингредиент</th><th>Остаток</th><th>Минимум</th><th>К заказу</th><th>Действие</th></tr></thead><tbody id="inventoryStockRows"></tbody></table></div>
      </article>
      <article class="card inventory-panel inventory-wide">
        <div class="inventory-panel-head"><h3>Ожидаемая прибыль</h3><span class="help">После продуктов, упаковки, потерь, УСН и эквайринга; до постоянных расходов</span></div>
        <div class="table-wrap"><table><thead><tr><th>Товар</th><th>Цена</th><th>Прямая себестоимость</th><th>Доход с продажи</th><th>Доля себестоимости</th></tr></thead><tbody id="inventoryEconomicsRows"></tbody></table></div>
      </article>
      <article class="card inventory-panel">
        <div class="inventory-panel-head"><h3>Список закупки</h3><span class="help">До целевого остатка</span></div>
        <div id="inventoryPurchaseRows" class="inventory-list"></div>
      </article>
      <article class="card inventory-panel">
        <div class="inventory-panel-head"><h3>Последние движения</h3><span class="help">История не перезаписывается</span></div>
        <div id="inventoryMovementRows" class="inventory-list"></div>
      </article>
    </div>`;
  adminMain.append(section);

  tab.addEventListener('click', async () => {
    document.querySelectorAll('.admin-tab').forEach(el => el.classList.toggle('active', el === tab));
    document.querySelectorAll('.admin-section').forEach(el => el.classList.toggle('show', el === section));
    if (!loaded) await refresh();
  });
  document.getElementById('inventoryRefresh').addEventListener('click', refresh);
  document.getElementById('inventoryLinkRecipes').addEventListener('click', linkRecipes);
  section.addEventListener('click', onInventoryAction);
  return true;
}

function feedback(message, type = 'error') {
  const el = document.getElementById('inventoryFeedback');
  if (!el) return;
  el.textContent = message || '';
  el.className = message ? `feedback show ${type}` : 'feedback';
}

function render(data) {
  current = data;
  const t = data.totals || {};
  document.getElementById('inventoryMetrics').innerHTML = [
    ['Складской учёт', data.enabled ? 'Включён' : 'Выключен'],
    ['Позиций на складе', t.ingredients || 0],
    ['Ниже минимума', t.belowMinimum || 0],
    ['Закупка', rub(t.purchaseCostKopecks || 0)],
    ['Связано блюд', t.linkedProducts || 0],
    ['Недоступно блюд', t.unavailableProducts || 0],
  ].map(([name, value]) => `<div class="inventory-metric"><span>${esc(name)}</span><strong>${esc(String(value))}</strong></div>`).join('');

  const purchaseById = new Map((data.purchaseList || []).map(row => [row.id, row]));
  document.getElementById('inventoryStockRows').innerHTML = (data.ingredients || [])
    .filter(row => row.trackStock)
    .map(row => {
      const buy = purchaseById.get(row.id);
      const state = row.stockQty <= row.minQty ? (row.stockQty < 0 ? 'danger' : 'warn') : 'ok';
      return `<tr>
        <td><strong>${esc(row.name)}</strong><div class="help">${esc(row.category || '')}${row.supplier ? ` · ${esc(row.supplier)}` : ''}</div></td>
        <td><span class="inventory-state ${state}">${qty(row.stockQty, row.unit)}</span></td>
        <td>${qty(row.minQty, row.unit)}</td>
        <td>${buy ? `${qty(buy.recommendedQty, row.unit)}<div class="help">${buy.packages} уп. · ${rub(buy.estimatedCostKopecks)}</div>` : '—'}</td>
        <td><div class="inventory-actions">
          <button class="mini" data-inventory-action="receipt" data-id="${esc(row.id)}" title="Приход">+</button>
          <button class="mini" data-inventory-action="writeoff" data-id="${esc(row.id)}" title="Списание">−</button>
          <button class="button inventory-small" data-inventory-action="count" data-id="${esc(row.id)}">Пересчитать</button>
          <button class="button inventory-small" data-inventory-action="edit" data-id="${esc(row.id)}">Настроить</button>
        </div></td>
      </tr>`;
    }).join('');

  document.getElementById('inventoryEconomicsRows').innerHTML = (data.economics || [])
    .sort((a, b) => b.contributionKopecks - a.contributionKopecks)
    .map(row => `<tr>
      <td><strong>${esc(row.name || row.productId)}</strong>${row.recipeLinked ? '' : '<div class="help inventory-warning">Нет рецептуры</div>'}</td>
      <td>${rub(row.priceKopecks)}</td>
      <td>${rub(row.directCostKopecks)}</td>
      <td><strong>${rub(row.contributionKopecks)}</strong></td>
      <td>${(Number(row.directCostShare || 0) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</td>
    </tr>`).join('');

  document.getElementById('inventoryPurchaseRows').innerHTML = (data.purchaseList || []).length
    ? data.purchaseList.map(row => `<div class="inventory-list-row"><div><strong>${esc(row.name)}</strong><div class="help">${qty(row.recommendedQty, row.unit)} · ${row.packages} уп.</div></div><strong>${rub(row.estimatedCostKopecks)}</strong></div>`).join('')
    : '<div class="help">Все остатки выше минимального уровня.</div>';

  document.getElementById('inventoryMovementRows').innerHTML = (data.movements || []).length
    ? data.movements.slice(0, 20).map(row => `<div class="inventory-list-row"><div><strong>${esc(row.ingredientName)}</strong><div class="help">${esc(row.movementType)} · ${new Date(row.createdAt).toLocaleString('ru-RU')}</div></div><strong class="${row.deltaQty < 0 ? 'inventory-negative' : 'inventory-positive'}">${row.deltaQty > 0 ? '+' : ''}${qty(row.deltaQty, row.unit)}</strong></div>`).join('')
    : '<div class="help">Движений пока нет.</div>';
}

async function refresh() {
  feedback('');
  try {
    const data = await adminApi('/api/admin/inventory/summary');
    render(data);
    loaded = true;
  } catch (error) {
    feedback(error.message || 'Не удалось загрузить склад.');
  }
}

async function linkRecipes() {
  feedback('');
  try {
    const result = await adminApi('/api/admin/inventory/link-recipes', { method: 'POST', body: JSON.stringify({}) });
    feedback(`Связано рецептур: ${result.matched?.length || 0}. Без совпадения: ${result.unmatched?.length || 0}.`, 'ok');
    await refresh();
  } catch (error) {
    feedback(error.message || 'Не удалось связать рецептуры.');
  }
}

async function onInventoryAction(event) {
  const button = event.target.closest('[data-inventory-action]');
  if (!button || !current) return;
  const ingredient = current.ingredients.find(row => row.id === button.dataset.id);
  if (!ingredient) return;
  const action = button.dataset.inventoryAction;
  if (action === 'edit') {
    const packageQty = window.prompt(`Количество в упаковке «${ingredient.name}» (${ingredient.unit})`, ingredient.packageQty);
    if (packageQty === null) return;
    const packagePriceRubles = window.prompt('Цена упаковки, ₽', (Number(ingredient.packagePriceKopecks || 0) / 100).toString());
    if (packagePriceRubles === null) return;
    const minQty = window.prompt(`Минимальный остаток (${ingredient.unit})`, ingredient.minQty);
    if (minQty === null) return;
    const targetQty = window.prompt(`Целевой остаток (${ingredient.unit})`, ingredient.targetQty);
    if (targetQty === null) return;
    const supplier = window.prompt('Поставщик', ingredient.supplier || '');
    if (supplier === null) return;
    const values = [packageQty, packagePriceRubles, minQty, targetQty].map(value => Number(String(value).replace(',', '.')));
    if (values.some(value => !Number.isFinite(value) || value < 0) || values[0] <= 0) {
      feedback('Проверьте введённые числа.');
      return;
    }
    try {
      await adminApi(`/api/admin/inventory/ingredients/${encodeURIComponent(ingredient.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          packageQty: values[0],
          packagePriceKopecks: Math.round(values[1] * 100),
          minQty: values[2],
          targetQty: values[3],
          supplier,
        }),
      });
      feedback('Параметры ингредиента сохранены.', 'ok');
      await refresh();
    } catch (error) {
      feedback(error.message || 'Не удалось сохранить параметры.');
    }
    return;
  }
  const labels = {
    receipt: `Количество прихода для «${ingredient.name}» (${ingredient.unit})`,
    writeoff: `Количество списания для «${ingredient.name}» (${ingredient.unit})`,
    count: `Фактический остаток «${ingredient.name}» (${ingredient.unit})`,
  };
  const initial = action === 'count' ? ingredient.stockQty : '';
  const value = window.prompt(labels[action], initial);
  if (value === null) return;
  const quantity = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity < 0 || (action !== 'count' && quantity === 0)) {
    feedback('Введите корректное положительное количество.');
    return;
  }
  const note = window.prompt('Комментарий к операции', '') ?? '';
  const type = action === 'receipt' ? 'RECEIPT' : action === 'writeoff' ? 'WRITEOFF' : 'INVENTORY';
  try {
    await adminApi('/api/admin/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: ingredient.id, type, quantity, note }),
    });
    feedback('Операция сохранена.', 'ok');
    await refresh();
  } catch (error) {
    feedback(error.message || 'Не удалось сохранить операцию.');
  }
}

function boot() {
  if (ensureUi()) return;
  const observer = new MutationObserver(() => {
    if (ensureUi()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

boot();
