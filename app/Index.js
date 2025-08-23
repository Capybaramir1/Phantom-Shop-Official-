const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const TOKEN = '8202218400:AAG5fM1M_sKD6nnzEaXQAQQBdyMTlfZq_BE';
const ADMIN_ID = 6413382806;
const SELLER_PASSWORD = '123456';

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./loyalty.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  discount_card TEXT,
  points INTEGER DEFAULT 0,
  purchases TEXT DEFAULT '',
  total_spent INTEGER DEFAULT 0,
  discount_level INTEGER DEFAULT 1
)`);

db.run(`CREATE TABLE IF NOT EXISTS sellers (
  telegram_id INTEGER PRIMARY KEY
)`);

db.run(`CREATE TABLE IF NOT EXISTS admins (
  telegram_id INTEGER PRIMARY KEY
)`);

db.run(`INSERT OR IGNORE INTO admins (telegram_id) VALUES (?)`, [ADMIN_ID]);

// Клавиатуры
function numberKeyboard() {
  return { reply_markup: { keyboard: [
    ['0', '1', '2'],
    ['3', '4', '5'],
    ['6', '7', '8'],
    ['9', 'ОК']
  ], resize_keyboard: true } };
}

function clientKeyboard() {
  return { reply_markup: { keyboard: [['/profile', '/order'], ['/my_discount_card']], resize_keyboard: true } };
}

function sellerKeyboard() {
  return { reply_markup: { keyboard: [['/register_client', '/generate_card'], ['/calculate_sum']], resize_keyboard: true } };
}

function adminKeyboard() {
  return { reply_markup: { keyboard: [['/view_all', '/add_seller'], ['/remove_seller']], resize_keyboard: true } };
}

function deliveryKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: 'На дом', callback_data: 'delivery_home' }],
    [{ text: 'В магазин', callback_data: 'delivery_shop' }]
  ] } };
}

function goodsKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: 'Алмазы (10 шт) - 100 руб', callback_data: 'goods_diamonds' }],
    [{ text: 'Броня (железная) - 200 руб', callback_data: 'goods_armor' }],
    [{ text: 'Меч (алмазный) - 150 руб', callback_data: 'goods_sword' }]
  ] } };
}

// Утилиты
function getDiscount(discountLevel) {
  const levels = [1, 5, 10, 13];
  return levels[Math.min(discountLevel - 1, 3)] / 100;
}

function getBonusAmount(totalSpent) {
  if (totalSpent >= 10000) return 50;
  if (totalSpent >= 5000) return 25;
  if (totalSpent >= 1000) return 5;
  return 0;
}

function updateDiscountLevel(telegramId, totalSpent) {
  let level = 1;
  if (totalSpent >= 25000) level = 4;
  else if (totalSpent >= 18000) level = 3;
  else if (totalSpent >= 10000) level = 2;
  db.run(`UPDATE users SET discount_level = ? WHERE telegram_id = ?`, [level, telegramId]);
}

// Состояния
const states = {};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (userId === ADMIN_ID) {
    bot.sendMessage(chatId, 'Добро пожаловать, админ!', adminKeyboard());
  } else if (db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [userId])) {
    bot.sendMessage(chatId, 'Добро пожаловать, продавец! Введите пароль:', numberKeyboard());
    states[chatId] = { state: 'seller_login', input: '' };
  } else {
    db.get(`SELECT telegram_id FROM users WHERE telegram_id = ?`, [userId], (err, row) => {
      bot.sendMessage(chatId, row ? 'Добро пожаловать, клиент!' : 'Вы не зарегистрированы. Обратитесь к продавцу.', clientKeyboard());
    });
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (states[chatId] && states[chatId].state === 'seller_login') {
    if (msg.text === 'ОК') {
      if (states[chatId].input === SELLER_PASSWORD) {
        bot.sendMessage(chatId, 'Логин успешный!', sellerKeyboard());
      } else {
        bot.sendMessage(chatId, 'Неверный пароль!', numberKeyboard());
      }
      delete states[chatId];
    } else if (msg.text.match(/^\d$/)) {
      states[chatId].input += msg.text;
      bot.sendMessage(chatId, `Введите пароль (введено: ${states[chatId].input})`, numberKeyboard());
    }
    return;
  }

  if (msg.text === '/register_client' && (userId === ADMIN_ID || db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [userId]))) {
    bot.sendMessage(chatId, 'Введите Telegram ID клиента:', { reply_markup: { remove_keyboard: true } });
    states[chatId] = { state: 'register_client' };
  } else if (states[chatId] && states[chatId].state === 'register_client') {
    const clientId = parseInt(msg.text);
    if (!isNaN(clientId)) {
      const discountCard = Math.floor(10000000 + Math.random() * 90000000).toString();
      db.run(`INSERT OR IGNORE INTO users (telegram_id, discount_card, points, total_spent, discount_level) VALUES (?, ?, ?, ?, ?)`,
        [clientId, discountCard, 0, 0, 1], () => {
          bot.sendMessage(chatId, `Клиент ${clientId} зарегистрирован! Дисконтная карта: ${discountCard} (скидка 1%, бонусы 0)`, userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
        });
    } else {
      bot.sendMessage(chatId, 'Неверный ID!', userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
    }
    delete states[chatId];
  }

  if (msg.text === '/profile') {
    db.get(`SELECT points, purchases, discount_card, discount_level, total_spent FROM users WHERE telegram_id = ?`, [userId], (err, row) => {
      if (row) {
        const discount = getDiscount(row.discount_level);
        bot.sendMessage(chatId, `Ваш профиль:\nПокупки: ${row.purchases || 'Нет'}\nБонусы: ${row.points} (1 бонус = 10 монет)\nСкидка: ${discount * 100}%\nПотрачено: ${row.total_spent} монет\nКарта: ${row.discount_card}`, clientKeyboard());
      } else {
        bot.sendMessage(chatId, 'Вы не зарегистрированы! Обратитесь к продавцу.', clientKeyboard());
      }
    });
  }

  if (msg.text === '/order') {
    db.get(`SELECT telegram_id FROM users WHERE telegram_id = ?`, [userId], (err, row) => {
      if (row) {
        bot.sendMessage(chatId, 'Выберите товар:', goodsKeyboard());
      } else {
        bot.sendMessage(chatId, 'Вы не зарегистрированы! Обратитесь к продавцу.', clientKeyboard());
      }
    });
  }

  if (msg.text === '/my_discount_card') {
    db.get(`SELECT discount_card FROM users WHERE telegram_id = ?`, [userId], (err, row) => {
      if (row) {
        bot.sendMessage(chatId, `Ваша дисконтная карта: ${row.discount_card}`, clientKeyboard());
      } else {
        bot.sendMessage(chatId, 'У вас нет карты! Обратитесь к продавцу.', clientKeyboard());
      }
    });
  }

  if (msg.text === '/generate_card' && (userId === ADMIN_ID || db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [userId]))) {
    bot.sendMessage(chatId, 'Введите Telegram ID клиента:', { reply_markup: { remove_keyboard: true } });
    states[chatId] = { state: 'generate_card' };
  } else if (states[chatId] && states[chatId].state === 'generate_card') {
    const clientId = parseInt(msg.text);
    if (!isNaN(clientId)) {
      const discountCard = Math.floor(10000000 + Math.random() * 90000000).toString();
      db.run(`UPDATE users SET discount_card = ?, points = 0, discount_level = 1 WHERE telegram_id = ?`,
        [discountCard, clientId], () => {
          bot.sendMessage(chatId, `Дисконтная карта для ${clientId}: ${discountCard} (скидка 1%, бонусы 0)`, userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
        });
    } else {
      bot.sendMessage(chatId, 'Неверный ID!', userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
    }
    delete states[chatId];
  }

  if (msg.text === '/calculate_sum' && (userId === ADMIN_ID || db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [userId]))) {
    bot.sendMessage(chatId, 'Есть ли у клиента дисконтная карта? (да/нет)', { reply_markup: { remove_keyboard: true } });
    states[chatId] = { state: 'calculate_sum_step1' };
  } else if (states[chatId] && states[chatId].state === 'calculate_sum_step1') {
    if (msg.text.toLowerCase() === 'да') {
      bot.sendMessage(chatId, 'Введите код карты:');
      states[chatId] = { state: 'calculate_sum_step2' };
    } else {
      bot.sendMessage(chatId, 'Введите стоимости товаров через запятую (например: 100,200,300):');
      states[chatId] = { state: 'calculate_sum_step3', hasCard: false };
    }
  } else if (states[chatId] && states[chatId].state === 'calculate_sum_step2') {
    const card = msg.text;
    db.get(`SELECT telegram_id, points, discount_level, total_spent FROM users WHERE discount_card = ?`, [card], (err, row) => {
      if (row) {
        states[chatId] = { state: 'calculate_sum_step3', userId: row.telegram_id, points: row.points, discountLevel: row.discount_level, totalSpent: row.total_spent, hasCard: true };
        bot.sendMessage(chatId, 'Введите стоимости товаров через запятую (например: 100,200,300):');
      } else {
        bot.sendMessage(chatId, 'Карта не найдена!', userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
        delete states[chatId];
      }
    });
  } else if (states[chatId] && states[chatId].state === 'calculate_sum_step3') {
    const prices = msg.text.split(',').map(Number).filter(n => !isNaN(n));
    if (prices.length) {
      const total = prices.reduce((a, b) => a + b, 0);
      let discount = 0, discountAmount = 0, bonus = 0, finalTotal = total;
      if (states[chatId].hasCard) {
        discount = getDiscount(states[chatId].discountLevel);
        discountAmount = total * discount;
        finalTotal = total - discountAmount;
        bonus = getBonusAmount(states[chatId].totalSpent + total);
        db.run(`UPDATE users SET points = ?, total_spent = ? WHERE telegram_id = ?`,
          [states[chatId].points + bonus, states[chatId].totalSpent + total, states[chatId].userId]);
      }
      bot.sendMessage(chatId, `Сумма: ${total} монет${states[chatId].hasCard ? `\nСкидка: ${discount * 100}% (${discountAmount} монет)\nИтог: ${finalTotal} монет\nБонусы: +${bonus} (итого ${states[chatId].points + bonus})` : ''}`, userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
    } else {
      bot.sendMessage(chatId, 'Неверный формат!', userId === ADMIN_ID ? adminKeyboard() : sellerKeyboard());
    }
    delete states[chatId];
  }

  if (msg.text === '/view_all' && userId === ADMIN_ID) {
    db.all(`SELECT telegram_id, points, purchases, total_spent, discount_level FROM users`, [], (err, rows) => {
      let response = 'Все пользователи:\n';
      rows.forEach(row => {
        response += `${row.telegram_id}: Баллы ${row.points}, Потрачено ${row.total_spent}, Скидка ${getDiscount(row.discount_level) * 100}%, Покупки: ${row.purchases || 'Нет'}\n`;
      });
      bot.sendMessage(chatId, response || 'Нет данных', adminKeyboard());
    });
  }

  if (msg.text === '/add_seller' && userId === ADMIN_ID) {
    bot.sendMessage(chatId, 'Введите Telegram ID продавца:');
    bot.once('message', (msg2) => {
      const sellerId = parseInt(msg2.text);
      if (!isNaN(sellerId)) {
        db.run(`INSERT OR IGNORE INTO sellers (telegram_id) VALUES (?)`, [sellerId]);
        bot.sendMessage(chatId, `Продавец ${sellerId} добавлен!`, adminKeyboard());
      } else {
        bot.sendMessage(chatId, 'Неверный ID!', adminKeyboard());
      }
    });
  }

  if (msg.text === '/remove_seller' && userId === ADMIN_ID) {
    bot.sendMessage(chatId, 'Введите Telegram ID продавца для удаления:');
    bot.once('message', (msg2) => {
      const sellerId = parseInt(msg2.text);
      if (!isNaN(sellerId)) {
        db.run(`DELETE FROM sellers WHERE telegram_id = ?`, [sellerId]);
        bot.sendMessage(chatId, `Продавец ${sellerId} удалён!`, adminKeyboard());
      } else {
        bot.sendMessage(chatId, 'Неверный ID!', adminKeyboard());
      }
    });
  }
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const userId = query.from.id;
  if (query.data.startsWith('goods_')) {
    const good = query.data.replace('goods_', '');
    const prices = { diamonds: 100, armor: 200, sword: 150 };
    bot.editMessageText(`Вы выбрали: ${query.message.text.split('-')[0].trim()} (${prices[good]} монет). Выберите доставку:`, { chat_id: chatId, message_id: msgId, ...deliveryKeyboard() });
  } else if (query.data.startsWith('delivery_')) {
    db.get(`SELECT total_spent, points FROM users WHERE telegram_id = ?`, [userId], (err, row) => {
      if (row) {
        const delivery = query.data.replace('delivery_', '');
        const prices = { diamonds: 100, armor: 200, sword: 150 };
        const good = query.message.text.split('-')[0].trim().toLowerCase().replace(' ', '_');
        const price = prices[good.replace(' ', '_').replace('(', '').replace(')', '')];
        const newTotalSpent = row.total_spent + price;
        const bonus = getBonusAmount(newTotalSpent);
        updateDiscountLevel(userId, newTotalSpent);
        db.run(`UPDATE users SET total_spent = ?, points = points + ?, purchases = purchases || ? WHERE telegram_id = ?`,
          [newTotalSpent, bonus, `\n${query.message.text} | ${delivery}`, userId], () => {
            bot.editMessageText(`Заказ подтверждён! Доставка: ${delivery}\nБонусы: +${bonus} (итого ${row.points + bonus})`, { chat_id: chatId, message_id: msgId });
            db.all(`SELECT telegram_id FROM sellers`, [], (err, sellers) => {
              sellers.forEach(seller => bot.sendMessage(seller.telegram_id, `Новый заказ от ${userId}: ${query.message.text} | ${delivery}`));
            });
          });
      } else {
        bot.editMessageText('Вы не зарегистрированы!', { chat_id: chatId, message_id: msgId });
      }
    });
  }
});

console.log('Bot is running...');
