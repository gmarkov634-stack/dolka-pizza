import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

function loadDotEnv() {
  const filename = path.resolve('.env');
  if (!fs.existsSync(filename)) return;
  for (const rawLine of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const databasePath = process.env.DATABASE_PATH || path.resolve('data/dolka.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const rawDb = new DatabaseSync(databasePath);
const db = {
  prepare: (...args) => rawDb.prepare(...args),
  exec: (...args) => rawDb.exec(...args),
  transaction(fn) {
    return (...args) => {
      rawDb.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        return result;
      } catch (error) {
        try { rawDb.exec('ROLLBACK'); } catch {}
        throw error;
      }
    };
  }
};

db.exec(fs.readFileSync(path.resolve('schema.sql'), 'utf8'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

const isoNow = () => new Date().toISOString();
const hashToken = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const safeText = (value, max = 500) =>
  String(value ?? '').trim().slice(0, max);

const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (!/^7\d{10}$/.test(digits)) throw new Error('Введите корректный телефон.');
  return `+7 ${digits.slice(1,4)} ${digits.slice(4,7)}-${digits.slice(7,9)}-${digits.slice(9,11)}`;
}

const seedSettings = {
  businessName: 'Пиццерия Долька',
  phone: '+7 (953) 949-06-02',
  address: 'г. Луза',
  workingHours: 'Ежедневно 10:00–20:00',
  deliveryPriceKopecks: 15000,
  minimumOrderKopecks: 50000,
  acceptOrders: true,
  paymentMethods: [
    { code: 'cash', name: 'Наличными при получении', enabled: true, hint: 'Оплата курьеру или при самовывозе' },
    { code: 'card_on_delivery', name: 'Картой при получении', enabled: true, hint: 'Оплата терминалом при получении' },
    { code: 'sbp', name: 'Онлайн через СБП', enabled: false, hint: 'Заказ оформится после успешной оплаты' }
  ]
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for (const [key, value] of Object.entries(seedSettings)) {
  insertSetting.run(key, JSON.stringify(value));
}

const seedProducts = [
  ['pizza-01','Пицца','Маргарита','Томатный соус, моцарелла, томаты',49000,'','🍕',1,10],
  ['pizza-02','Пицца','Пепперони','Томатный соус, моцарелла, пепперони',59000,'','🍕',1,20],
  ['pizza-03','Пицца','Четыре сыра','Моцарелла, чеддер, дорблю, пармезан',65000,'','🍕',1,30],
  ['pizza-04','Пицца','Мясная','Курица, ветчина, пепперони, бекон',69000,'','🍕',1,40],
  ['pizza-05','Пицца','Гавайская','Курица, ананас, моцарелла, соус',62000,'','🍕',1,50],
  ['pizza-06','Пицца','Грибная','Шампиньоны, моцарелла, сливочный соус',59000,'','🍕',1,60],
  ['pizza-07','Пицца','Барбекю','Курица, бекон, лук, соус барбекю',65000,'','🍕',1,70],
  ['pizza-08','Пицца','Охотничья','Охотничьи колбаски, перец, сыр',67000,'','🍕',1,80],
  ['pizza-09','Пицца','Ветчина и сыр','Ветчина, моцарелла, томатный соус',58000,'','🍕',1,90],
  ['pizza-10','Пицца','Острая','Пепперони, халапеньо, острый соус',63000,'','🍕',1,100],
  ['shawarma-01','Шаурма','Классическая','Курица, овощи, соус, лаваш',29000,'','🌯',1,110],
  ['shawarma-02','Шаурма','Сырная','Курица, овощи, сыр, фирменный соус',34000,'','🌯',1,120],
  ['shawarma-03','Шаурма','Острая','Курица, овощи, халапеньо, острый соус',33000,'','🌯',1,130],
  ['drink-01','Напитки','Морс','Домашний ягодный морс',12000,'','🥤',1,200]
];

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products(
    id,category,name,description,price_kopecks,image_url,emoji,
    available,sort_order,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
`);
for (const product of seedProducts) insertProduct.run(...product, isoNow(), isoNow());

function readSettings() {
  const result = {};
  for (const row of db.prepare('SELECT key,value FROM settings').all()) {
    try { result[row.key] = JSON.parse(row.value); }
    catch { result[row.key] = row.value; }
  }
  return result;
}

function writeSettings(values) {
  const statement = db.prepare(`
    INSERT INTO settings(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      statement.run(key, JSON.stringify(value));
    }
  })();
}

function yooConfigured() {
  return String(process.env.YOOKASSA_ENABLED).toLowerCase() === 'true' &&
    Boolean(process.env.YOOKASSA_SHOP_ID) &&
    Boolean(process.env.YOOKASSA_SECRET_KEY);
}

function publicSettings() {
  const settings = readSettings();
  const methods = Array.isArray(settings.paymentMethods) ? settings.paymentMethods : [];
  return {
    businessName: String(settings.businessName || 'Пиццерия Долька'),
    phone: String(settings.phone || ''),
    address: String(settings.address || ''),
    workingHours: String(settings.workingHours || ''),
    deliveryPriceKopecks: Number(settings.deliveryPriceKopecks || 0),
    minimumOrderKopecks: Number(settings.minimumOrderKopecks || 0),
    acceptOrders: settings.acceptOrders !== false,
    paymentMethods: methods.map(method => ({
      ...method,
      enabled: method.code === 'sbp'
        ? Boolean(method.enabled && yooConfigured())
        : Boolean(method.enabled)
    }))
  };
}

function publicProduct(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    priceKopecks: row.price_kopecks,
    imageUrl: row.image_url,
    emoji: row.emoji,
    available: Boolean(row.available),
    sortOrder: row.sort_order
  };
}

function generateOrderId() {
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).replaceAll('-', '');

  const number = db.transaction(() => {
    const row = db.prepare('SELECT value FROM order_counters WHERE counter_date=?').get(date);
    const next = Number(row?.value || 0) + 1;
    db.prepare(`
      INSERT INTO order_counters(counter_date,value) VALUES(?,?)
      ON CONFLICT(counter_date) DO UPDATE SET value=excluded.value
    `).run(date, next);
    return next;
  })();

  return `PZ-${date}-${String(number).padStart(3, '0')}`;
}

function validateOrderPayload(body) {
  if (!body || typeof body !== 'object') throw new Error('Некорректные данные заказа.');
  const customer = body.customer || {};
  const name = String(customer.name || '').trim();
  const address = String(customer.address || '').trim();
  const comment = String(customer.comment || '').trim();
  const deliveryType = String(body.deliveryType || '');
  const paymentType = String(body.paymentType || '');
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name || name.length > 80) throw new Error('Введите имя.');
  if (!['delivery','pickup'].includes(deliveryType)) throw new Error('Выберите способ получения.');
  if (!['cash','card_on_delivery','sbp'].includes(paymentType)) throw new Error('Выберите способ оплаты.');
  if (deliveryType === 'delivery' && !address) throw new Error('Введите адрес доставки.');
  if (address.length > 250 || comment.length > 400) throw new Error('Слишком длинный адрес или комментарий.');
  if (!items.length || items.length > 100) throw new Error('Корзина пуста.');

  const normalizedItems = items.map(item => {
    const id = String(item?.id || '').trim();
    const quantity = Number(item?.quantity);
    if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error('Проверьте количество товаров.');
    }
    return { id, quantity };
  });

  return {
    customer: {
      name,
      phone: normalizePhone(customer.phone),
      address,
      comment
    },
    deliveryType,
    paymentType,
    items: normalizedItems
  };
}

function calculateOrder(payload) {
  const settings = publicSettings();
  if (!settings.acceptOrders) throw new Error('Приём заказов сейчас закрыт.');

  const productStatement = db.prepare('SELECT * FROM products WHERE id=? AND available=1');
  const seen = new Set();
  const items = payload.items.map(requested => {
    if (seen.has(requested.id)) throw new Error('Один товар передан несколько раз.');
    seen.add(requested.id);
    const product = productStatement.get(requested.id);
    if (!product) throw new Error(`Товар ${requested.id} недоступен.`);
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      quantity: requested.quantity,
      unitPriceKopecks: product.price_kopecks,
      lineTotalKopecks: product.price_kopecks * requested.quantity
    };
  });

  const subtotalKopecks = items.reduce((sum, item) => sum + item.lineTotalKopecks, 0);
  if (subtotalKopecks < settings.minimumOrderKopecks) {
    throw new Error(`Минимальная сумма заказа — ${Math.round(settings.minimumOrderKopecks / 100)} ₽.`);
  }
  const deliveryKopecks = payload.deliveryType === 'delivery'
    ? settings.deliveryPriceKopecks
    : 0;
  return {
    items,
    subtotalKopecks,
    deliveryKopecks,
    totalKopecks: subtotalKopecks + deliveryKopecks
  };
}

function insertFinalOrder({
  orderId, payload, calculation, tokenHash, paymentStatus,
  paymentId = null, status = 'Новый'
}) {
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM orders WHERE id=?').get(orderId)) return false;
    const timestamp = isoNow();
    db.prepare(`
      INSERT INTO orders(
        id,created_at,updated_at,customer_name,phone,delivery_type,address,comment,
        payment_method,payment_status,yookassa_payment_id,subtotal_kopecks,
        delivery_kopecks,total_kopecks,status,tracking_token_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      orderId, timestamp, timestamp,
      safeText(payload.customer.name, 80), payload.customer.phone,
      payload.deliveryType,
      payload.deliveryType === 'delivery' ? safeText(payload.customer.address, 250) : '',
      safeText(payload.customer.comment, 400),
      payload.paymentType, paymentStatus, paymentId,
      calculation.subtotalKopecks, calculation.deliveryKopecks,
      calculation.totalKopecks, status, tokenHash
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items(
        order_id,product_id,product_name,category,quantity,
        unit_price_kopecks,line_total_kopecks
      ) VALUES(?,?,?,?,?,?,?)
    `);
    for (const item of calculation.items) {
      insertItem.run(
        orderId, item.productId, item.name, item.category, item.quantity,
        item.unitPriceKopecks, item.lineTotalKopecks
      );
    }
    return true;
  })();
}

async function yooRequest(pathname, options = {}) {
  if (!yooConfigured()) throw new Error('ЮKassa не настроена.');
  const auth = Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`
  ).toString('base64');
  const response = await fetch(`https://api.yookassa.ru/v3${pathname}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(body.description || body.code || `ЮKassa: HTTP ${response.status}`);
  return body;
}

async function createSbpPayment(orderId, totalKopecks, trackingToken) {
  const returnPage = String(process.env.YOOKASSA_RETURN_URL || '').trim();
  if (!returnPage) throw new Error('YOOKASSA_RETURN_URL не настроен.');
  const separator = returnPage.includes('?') ? '&' : '?';
  return yooRequest('/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': crypto.randomUUID()
    },
    body: JSON.stringify({
      amount: { value: (totalKopecks / 100).toFixed(2), currency: 'RUB' },
      capture: true,
      payment_method_data: { type: 'sbp' },
      confirmation: {
        type: 'redirect',
        return_url: `${returnPage}${separator}order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(trackingToken)}`
      },
      description: `Заказ ${orderId}`,
      metadata: { order_id: orderId }
    })
  });
}

async function sendMaxNotification(orderId) {
  if (String(process.env.MAX_NOTIFY_ENABLED).toLowerCase() !== 'true') return;
  const token = String(process.env.MAX_BOT_TOKEN || '').trim();
  const chatId = String(process.env.MAX_CHAT_ID || '').trim();
  if (!token || !chatId) throw new Error('MAX_BOT_TOKEN или MAX_CHAT_ID не настроены.');

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(orderId);
  const paymentLabel = ({
    cash: 'наличными при получении',
    card_on_delivery: 'картой при получении',
    sbp: 'оплачено через СБП'
  })[order.payment_method] || order.payment_method;

  const lines = [
    `🟢 Новый заказ № ${order.id}`,
    '',
    order.delivery_type === 'pickup' ? 'Получение: самовывоз' : `Доставка: ${order.address}`,
    `Телефон: ${order.phone}`,
    '',
    ...items.map(item => `${item.product_name} × ${item.quantity} — ${Math.round(item.line_total_kopecks / 100)} ₽`),
    order.delivery_kopecks ? `Доставка — ${Math.round(order.delivery_kopecks / 100)} ₽` : '',
    '',
    `Итого: ${Math.round(order.total_kopecks / 100)} ₽`,
    `Оплата: ${paymentLabel}`,
    order.comment ? `Комментарий: ${order.comment}` : ''
  ].filter((line, index) => line || [1,4].includes(index)).join('\n');

  const adminUrl = String(process.env.ADMIN_PUBLIC_URL || '').trim();
  const attachments = adminUrl ? [{
    type: 'inline_keyboard',
    payload: {
      buttons: [[{
        type: 'link',
        text: 'Открыть админку',
        url: adminUrl
      }]]
    }
  }] : [];

  const base = String(process.env.MAX_API_BASE || 'https://platform-api2.max.ru').replace(/\/+$/, '');
  const response = await fetch(`${base}/messages?chat_id=${encodeURIComponent(chatId)}`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: lines, disable_link_preview: true, attachments })
  });
  const responseText = await response.text();

  db.prepare(`
    INSERT INTO notification_log(order_id,channel,created_at,success,response)
    VALUES(?,'max',?,?,?)
  `).run(orderId, isoNow(), response.ok ? 1 : 0, responseText.slice(0, 3000));

  if (!response.ok) {
    throw new Error(`MAX API HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
}

async function notifyOrder(orderId) {
  try { await sendMaxNotification(orderId); }
  catch (error) { const cause = error?.cause?.code || error?.cause?.message || ''; console.error('MAX notification:', orderId, error.message, cause); }
}

async function syncPayment(payment) {
  const orderId = String(payment?.metadata?.order_id || '').trim().toUpperCase();
  if (!orderId || !payment?.id) throw new Error('В платеже нет номера заявки.');

  const pending = db.prepare('SELECT * FROM pending_orders WHERE id=?').get(orderId);
  if (!pending) {
    return { finalized: Boolean(db.prepare('SELECT 1 FROM orders WHERE id=?').get(orderId)) };
  }
  if (pending.payment_id && pending.payment_id !== payment.id) {
    throw new Error('ID платежа не совпадает.');
  }

  const actualKopecks = Math.round(Number(payment?.amount?.value || 0) * 100);
  if (payment?.amount?.currency !== 'RUB' || actualKopecks !== pending.total_kopecks) {
    db.prepare('UPDATE pending_orders SET error=?,updated_at=? WHERE id=?')
      .run('Сумма или валюта платежа не совпадает.', isoNow(), orderId);
    throw new Error('Сумма или валюта платежа не совпадает.');
  }

  db.prepare('UPDATE pending_orders SET payment_status=?,updated_at=? WHERE id=?')
    .run(String(payment.status), isoNow(), orderId);

  if (payment.status !== 'succeeded' || payment.paid !== true) {
    return { finalized: false };
  }

  const payload = JSON.parse(pending.payload_json);
  const calculation = {
    items: JSON.parse(pending.items_json),
    subtotalKopecks: pending.subtotal_kopecks,
    deliveryKopecks: pending.delivery_kopecks,
    totalKopecks: pending.total_kopecks
  };

  const created = insertFinalOrder({
    orderId,
    payload,
    calculation,
    tokenHash: pending.tracking_token_hash,
    paymentStatus: 'Оплачено',
    paymentId: payment.id,
    status: 'Подтверждён'
  });

  db.prepare(`
    UPDATE pending_orders
    SET payment_status='succeeded',finalized_at=?,updated_at=?
    WHERE id=?
  `).run(isoNow(), isoNow(), orderId);

  if (created) void notifyOrder(orderId);
  return { finalized: created };
}

function orderStatusResult(order) {
  const items = db.prepare(`
    SELECT product_name,quantity,line_total_kopecks
    FROM order_items WHERE order_id=? ORDER BY id
  `).all(order.id);
  return {
    orderCreated: true,
    pendingPayment: false,
    orderId: order.id,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    status: order.status,
    deliveryLabel: order.delivery_type === 'pickup'
      ? 'Самовывоз'
      : `Доставка (${order.address})`,
    paymentStatus: order.payment_status,
    paymentUrl: '',
    totalKopecks: order.total_kopecks,
    items: items.map(item => ({
      name: item.product_name,
      quantity: item.quantity,
      lineTotalKopecks: item.line_total_kopecks
    }))
  };
}

function pendingStatusResult(row) {
  const payload = JSON.parse(row.payload_json);
  const items = JSON.parse(row.items_json);
  return {
    orderCreated: false,
    pendingPayment: true,
    orderId: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.payment_status === 'canceled' ? 'Оплата отменена' : 'Заказ ещё не оформлен',
    deliveryLabel: payload.deliveryType === 'pickup'
      ? 'Самовывоз'
      : `Доставка (${payload.customer.address})`,
    paymentStatus: ({
      pending: 'Ожидает оплаты',
      succeeded: 'Оплачено',
      canceled: 'Оплата отменена',
      creating: 'Создаётся платёж',
      error: 'Ошибка платежа'
    })[row.payment_status] || row.payment_status,
    paymentUrl: row.confirmation_url,
    totalKopecks: row.total_kopecks,
    items: items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      lineTotalKopecks: item.lineTotalKopecks
    }))
  };
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password) {
  const stored = String(process.env.ADMIN_PASSWORD_HASH || '');
  if (!stored) throw new Error('ADMIN_PASSWORD_HASH не настроен.');
  const [kind, saltText, hashText] = stored.split('$');
  if (kind !== 'scrypt' || !saltText || !hashText) throw new Error('Некорректный ADMIN_PASSWORD_HASH.');
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createAdminSession() {
  const token = randomToken(36);
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 3600000
  );
  db.prepare(`
    INSERT INTO admin_sessions(token_hash,created_at,expires_at)
    VALUES(?,?,?)
  `).run(hashToken(token), createdAt.toISOString(), expiresAt.toISOString());
  return { token, expiresAt: expiresAt.toISOString() };
}

function adminTokenFromRequest(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireAdmin(req) {
  const token = adminTokenFromRequest(req);
  if (!token) throw Object.assign(new Error('Требуется вход в админку.'), { status: 401 });
  const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?')
    .get(hashToken(token));
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('Сессия истекла. Войдите снова.'), { status: 401 });
  }
  return token;
}

const allowedOrigins = String(process.env.FRONTEND_ORIGINS || '')
  .split(',').map(value => value.trim()).filter(Boolean);

function setCommonHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  const origin = String(req.headers.origin || '');
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

async function readJson(req, maxBytes = 150 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Слишком большой запрос.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Некорректный JSON.'), { status: 400 }); }
}

const limitBuckets = new Map();
function rateAllowed(req, scope, limit, windowMs) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  const key = `${scope}:${ip}`;
  const nowMs = Date.now();
  let bucket = limitBuckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) bucket = { count: 0, resetAt: nowMs + windowMs };
  bucket.count += 1;
  limitBuckets.set(key, bucket);
  if (limitBuckets.size > 10000) {
    for (const [bucketKey, value] of limitBuckets) {
      if (value.resetAt <= nowMs) limitBuckets.delete(bucketKey);
    }
  }
  return bucket.count <= limit;
}

async function handleRequest(req, res) {
  setCommonHeaders(req, res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const origin = String(req.headers.origin || '');

  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return json(res, 403, { error: 'Этот адрес фронтенда не разрешён.' });
  }
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, time: isoNow() });
  }

  if (pathname.startsWith('/api/public') && !rateAllowed(req, 'public', 120, 60000)) {
    return json(res, 429, { error: 'Слишком много запросов. Повторите позже.' });
  }

  if (method === 'GET' && pathname === '/api/public/settings') {
    return json(res, 200, publicSettings());
  }

  if (method === 'GET' && pathname === '/api/public/products') {
    const products = db.prepare('SELECT * FROM products ORDER BY sort_order,name').all();
    return json(res, 200, products.map(publicProduct));
  }

  if (method === 'POST' && pathname === '/api/orders') {
    if (!rateAllowed(req, 'orders', 20, 10 * 60000)) {
      return json(res, 429, { error: 'Слишком много попыток. Повторите позже.' });
    }
    const payload = validateOrderPayload(await readJson(req));
    const settings = publicSettings();
    const methodConfig = settings.paymentMethods.find(item =>
      item.code === payload.paymentType && item.enabled
    );
    if (!methodConfig) throw Object.assign(new Error('Выбранный способ оплаты недоступен.'), { status: 400 });

    const calculation = calculateOrder(payload);
    const orderId = generateOrderId();
    const trackingToken = randomToken(32);
    const trackingTokenHash = hashToken(trackingToken);

    if (payload.paymentType === 'sbp') {
      const timestamp = isoNow();
      db.prepare(`
        INSERT INTO pending_orders(
          id,created_at,updated_at,payload_json,items_json,subtotal_kopecks,
          delivery_kopecks,total_kopecks,tracking_token_hash,payment_status
        ) VALUES(?,?,?,?,?,?,?,?,?,'creating')
      `).run(
        orderId, timestamp, timestamp,
        JSON.stringify(payload), JSON.stringify(calculation.items),
        calculation.subtotalKopecks, calculation.deliveryKopecks,
        calculation.totalKopecks, trackingTokenHash
      );

      try {
        const payment = await createSbpPayment(orderId, calculation.totalKopecks, trackingToken);
        const confirmationUrl = String(payment?.confirmation?.confirmation_url || '');
        db.prepare(`
          UPDATE pending_orders
          SET payment_id=?,payment_status=?,confirmation_url=?,updated_at=?
          WHERE id=?
        `).run(payment.id, payment.status, confirmationUrl, isoNow(), orderId);
        if (payment.status === 'succeeded') await syncPayment(payment);
        return json(res, 200, {
          ok: true,
          pendingPayment: payment.status !== 'succeeded',
          orderId,
          trackingToken,
          totalKopecks: calculation.totalKopecks,
          confirmationUrl
        });
      } catch (error) {
        db.prepare(`
          UPDATE pending_orders
          SET payment_status='error',error=?,updated_at=?
          WHERE id=?
        `).run(error.message, isoNow(), orderId);
        throw error;
      }
    }

    insertFinalOrder({
      orderId,
      payload,
      calculation,
      tokenHash: trackingTokenHash,
      paymentStatus: 'Оплата при получении'
    });
    void notifyOrder(orderId);
    return json(res, 200, {
      ok: true,
      pendingPayment: false,
      orderId,
      trackingToken,
      totalKopecks: calculation.totalKopecks,
      confirmationUrl: ''
    });
  }

  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (method === 'GET' && statusMatch) {
    if (!rateAllowed(req, 'status', 120, 60000)) {
      return json(res, 429, { error: 'Слишком много запросов. Повторите позже.' });
    }
    const orderId = decodeURIComponent(statusMatch[1]).trim().toUpperCase();
    const token = String(url.searchParams.get('token') || '').trim();
    const phone = String(url.searchParams.get('phone') || '').replace(/\D/g, '');

    let order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (order) {
      const tokenOk = Boolean(token) && hashToken(token) === order.tracking_token_hash;
      const phoneOk = Boolean(phone) && order.phone.replace(/\D/g, '') === phone;
      if (!tokenOk && !phoneOk) throw Object.assign(new Error('Заказ не найден. Проверьте данные.'), { status: 404 });
      return json(res, 200, orderStatusResult(order));
    }

    let pending = db.prepare('SELECT * FROM pending_orders WHERE id=?').get(orderId);
    if (!pending) throw Object.assign(new Error('Заказ не найден. Проверьте данные.'), { status: 404 });
    const payload = JSON.parse(pending.payload_json);
    const tokenOk = Boolean(token) && hashToken(token) === pending.tracking_token_hash;
    const phoneOk = Boolean(phone) && payload.customer.phone.replace(/\D/g, '') === phone;
    if (!tokenOk && !phoneOk) throw Object.assign(new Error('Заказ не найден. Проверьте данные.'), { status: 404 });

    if (pending.payment_id && ['pending','creating'].includes(pending.payment_status)) {
      try {
        const payment = await yooRequest(`/payments/${encodeURIComponent(pending.payment_id)}`);
        await syncPayment(payment);
      } catch (error) {
        console.error('Payment refresh:', orderId, error.message);
      }
    }

    order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (order) return json(res, 200, orderStatusResult(order));
    pending = db.prepare('SELECT * FROM pending_orders WHERE id=?').get(orderId);
    return json(res, 200, pendingStatusResult(pending));
  }

  if (method === 'POST' && pathname === '/api/webhooks/yookassa') {
    const body = await readJson(req);
    const paymentId = String(body?.object?.id || '').trim();
    if (!paymentId) throw new Error('В уведомлении нет ID платежа.');
    const payment = await yooRequest(`/payments/${encodeURIComponent(paymentId)}`);
    await syncPayment(payment);
    res.statusCode = 200;
    return res.end('OK');
  }

  if (method === 'POST' && pathname === '/api/admin/login') {
    if (!rateAllowed(req, 'login', 10, 15 * 60000)) {
      return json(res, 429, { error: 'Слишком много попыток входа. Повторите позже.' });
    }
    const body = await readJson(req);
    if (!verifyPassword(body.password)) return json(res, 401, { error: 'Неверный пароль.' });
    return json(res, 200, createAdminSession());
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    const token = requireAdmin(req);
    db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/me') {
    requireAdmin(req);
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/orders') {
    requireAdmin(req);
    const status = String(url.searchParams.get('status') || '').trim();
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 1000').all();
    return json(res, 200, rows.map(order => ({
      id: order.id,
      createdAt: order.created_at,
      customerName: order.customer_name,
      phone: order.phone,
      deliveryLabel: order.delivery_type === 'pickup' ? 'Самовывоз' : `Доставка: ${order.address}`,
      paymentLabel: ({ cash: 'Наличные', card_on_delivery: 'Карта при получении', sbp: 'СБП' })[order.payment_method] || order.payment_method,
      paymentStatus: order.payment_status,
      totalKopecks: order.total_kopecks,
      status: order.status
    })));
  }

  const orderStatusAdminMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
  if (method === 'PATCH' && orderStatusAdminMatch) {
    requireAdmin(req);
    const body = await readJson(req);
    const status = String(body.status || '');
    const allowed = ['Новый','Подтверждён','Готовится','Готов','Передан курьеру','Завершён','Отменён'];
    if (!allowed.includes(status)) return json(res, 400, { error: 'Недопустимый статус.' });
    const result = db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?')
      .run(status, isoNow(), decodeURIComponent(orderStatusAdminMatch[1]).toUpperCase());
    if (!result.changes) return json(res, 404, { error: 'Заказ не найден.' });
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/products') {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM products ORDER BY sort_order,name').all();
    return json(res, 200, rows.map(publicProduct));
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (method === 'PUT' && productMatch) {
    requireAdmin(req);
    const body = await readJson(req);
    const oldId = decodeURIComponent(productMatch[1]);
    const product = {
      id: String(body.id || '').trim(),
      category: String(body.category || '').trim(),
      name: String(body.name || '').trim(),
      description: String(body.description || '').trim().slice(0, 500),
      priceKopecks: Math.round(Number(body.priceKopecks || 0)),
      imageUrl: String(body.imageUrl || '').trim().slice(0, 800),
      emoji: String(body.emoji || '🍕').trim().slice(0, 10),
      available: Boolean(body.available),
      sortOrder: Math.round(Number(body.sortOrder || 100))
    };
    if (!/^[a-zA-Z0-9_-]{2,100}$/.test(product.id)) return json(res, 400, { error: 'ID товара: только латинские буквы, цифры, - и _.' });
    if (!product.category || !product.name) return json(res, 400, { error: 'Укажите категорию и название.' });
    if (!Number.isFinite(product.priceKopecks) || product.priceKopecks < 0) return json(res, 400, { error: 'Проверьте цену.' });

    const existing = db.prepare('SELECT created_at FROM products WHERE id=?').get(oldId);
    const createdAt = existing?.created_at || isoNow();
    db.transaction(() => {
      if (oldId && oldId !== product.id) db.prepare('DELETE FROM products WHERE id=?').run(oldId);
      db.prepare(`
        INSERT INTO products(
          id,category,name,description,price_kopecks,image_url,emoji,
          available,sort_order,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          category=excluded.category,name=excluded.name,description=excluded.description,
          price_kopecks=excluded.price_kopecks,image_url=excluded.image_url,
          emoji=excluded.emoji,available=excluded.available,
          sort_order=excluded.sort_order,updated_at=excluded.updated_at
      `).run(
        product.id, product.category, product.name, product.description,
        product.priceKopecks, product.imageUrl, product.emoji,
        product.available ? 1 : 0, product.sortOrder, createdAt, isoNow()
      );
    })();
    return json(res, 200, { ok: true });
  }

  if (method === 'DELETE' && productMatch) {
    requireAdmin(req);
    db.prepare('DELETE FROM products WHERE id=?').run(decodeURIComponent(productMatch[1]));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/settings') {
    requireAdmin(req);
    const settings = publicSettings();
    const rawSettings = readSettings();
    const paymentMethods = Array.isArray(rawSettings.paymentMethods)
      ? rawSettings.paymentMethods
      : [];
    const methodEnabled = code =>
      paymentMethods.find(item => item.code === code)?.enabled !== false;

    return json(res, 200, {
      businessName: settings.businessName,
      phone: settings.phone,
      address: settings.address,
      workingHours: settings.workingHours,
      deliveryPriceRubles: settings.deliveryPriceKopecks / 100,
      minimumOrderRubles: settings.minimumOrderKopecks / 100,
      acceptOrders: settings.acceptOrders,
      cashEnabled: methodEnabled('cash'),
      cardOnDeliveryEnabled: methodEnabled('card_on_delivery'),
      sbpEnabled: methodEnabled('sbp')
    });
  }

  if (method === 'PUT' && pathname === '/api/admin/settings') {
    requireAdmin(req);
    const body = await readJson(req);
    const current = readSettings();
    const currentMethods = Array.isArray(current.paymentMethods)
      ? current.paymentMethods
      : seedSettings.paymentMethods;
    const enabledByCode = {
      cash: Boolean(body.cashEnabled),
      card_on_delivery: Boolean(body.cardOnDeliveryEnabled),
      sbp: Boolean(body.sbpEnabled)
    };
    const paymentMethods = currentMethods.map(method => ({
      ...method,
      enabled: Object.hasOwn(enabledByCode, method.code)
        ? enabledByCode[method.code]
        : Boolean(method.enabled)
    }));

    writeSettings({
      businessName: safeText(body.businessName, 100),
      phone: safeText(body.phone, 50),
      address: safeText(body.address, 250),
      workingHours: safeText(body.workingHours, 100),
      deliveryPriceKopecks: Math.max(0, Math.round(Number(body.deliveryPriceRubles || 0) * 100)),
      minimumOrderKopecks: Math.max(0, Math.round(Number(body.minimumOrderRubles || 0) * 100)),
      acceptOrders: Boolean(body.acceptOrders),
      paymentMethods
    });
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/orders.csv') {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    const headers = ['Номер заказа','Создан','Имя','Телефон','Получение','Адрес','Оплата','Статус оплаты','Товары','Доставка','Итого','Статус'];
    const lines = [headers.map(csvCell).join(';')];
    for (const order of rows) {
      lines.push([
        order.id, order.created_at, order.customer_name, order.phone,
        order.delivery_type, order.address, order.payment_method,
        order.payment_status, order.subtotal_kopecks / 100,
        order.delivery_kopecks / 100, order.total_kopecks / 100, order.status
      ].map(csvCell).join(';'));
    }
    res.setHeader('Content-Disposition', 'attachment; filename="dolka-orders.csv"');
    return text(res, 200, `\uFEFF${lines.join('\n')}`, 'text/csv; charset=utf-8');
  }

  return json(res, 404, { error: 'Маршрут не найден.' });
}

const port = Math.max(1, Number(process.env.PORT || 3000));
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(error);
    if (res.headersSent) return res.end();
    const status = Number(error.status || 0) || (/^(Введите|Выберите|Проверьте|Минимальная|Корзина|Товар|Приём|Некоррект)/.test(error.message) ? 400 : 500);
    json(res, status, { error: status >= 500 ? (error.message || 'Внутренняя ошибка сервера.') : error.message });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Dolka API listening on port ${port}`);
});
