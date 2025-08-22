const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const TOKEN = '8202218400:AAG5fM1M_sKD6nnzEaXQAQQBdyMTlfZq_BE';
const ADMIN_ID = 6413382806;
const SELLER_PASSWORD = '123456';

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./loyalty.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  discount_card TEXT,
  points INTEGER DEFAULT 0,
  purchases TEXT DEFAULT '',
  total_spent INTEGER DEFAULT 0,
  discount_level INTEGER DEFAULT 1
)`);

db.run(`CREATE TABLE IF NOT EXISTS sellers (
  telegram_id TEXT PRIMARY KEY
)`);

db.run(`CREATE TABLE IF NOT EXISTS admins (
  telegram_id TEXT PRIMARY KEY
)`);

db.run(`INSERT OR IGNORE INTO admins (telegram_id) VALUES (?)`, [ADMIN_ID]);

// Клавиатуры
function numberKeyboard() {
  const keyboard = [];
  for (let i = 0; i < 10; i += 3) {
    keyboard.push([String(i), String(i + 1), String(i + 2)].map(n => ({ text: n })));
  }
  keyboard.push([{ text: 'ОК' }]);
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

function clientKeyboard() {
  return { reply_markup: { keyboard: [['/profile', '/order']], resize_keyboard: true } };
}

function sellerKeyboard() {
  return { reply_markup: { keyboard: [['/register_client', '/addpoints'], ['/discount', '/calculate_sum'], ['/generate_card']], resize_keyboard: true } };
}

function adminKeyboard() {
  return { reply_markup: { keyboard: [['/view_all', '/add_seller'], ['/remove_seller']], resize_keyboard: true } };
}

function deliveryKeyboard() {
  return { reply_markup: { inline_keyboard: [['На дом', 'delivery_home'], ['В магазин', 'delivery_shop']] } };
}

function goodsKeyboard() {
  return { reply_markup: { inline_keyboard: [
    ['Алмазы (10 шт) - 100 руб', 'goods_diamonds'],
    ['Броня (железная) - 200 руб', 'goods_armor'],
    ['Меч (алмазный) - 150 руб', 'goods_sword']
  ].map(([text, data]) => [{ text, callback_data: data }]) } };
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

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(chatId, 'Добро пожаловать, админ!', adminKeyboard());
  } else if (db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [msg.from.id])) {
    bot.sendMessage(chatId, 'Добро пожаловать, продавец! Введите пароль:', numberKeyboard());
  } else {
    bot.sendMessage(chatId, 'Добро пожаловать, клиент!', clientKeyboard());
  }
});

// Логин продавца
let sellerPasswordInput = {};
bot.on('message', (msg) => {
  if (sellerPasswordInput[msg.chat.id] && msg.text !== 'ОК') {
    sellerPasswordInput[msg.chat.id] += msg.text;
    return;
  }
  if (msg.text === 'ОК' && sellerPasswordInput[msg.chat.id]) {
    if (sellerPasswordInput[msg.chat.id] === SELLER_PASSWORD) {
      bot.sendMessage(msg.chat.id, 'Логин успешный!', sellerKeyboard());
    } else {
      bot.sendMessage(msg.chat.id, 'Неверный пароль!', numberKeyboard());
    }
    delete sellerPasswordInput[msg.chat.id];
    return;
  }
  if (!sellerPasswordInput[msg.chat.id] && msg.text.match(/^\d$/)) {
    sellerPasswordInput[msg.chat.id] = msg.text;
    bot.sendMessage(msg.chat.id, 'Введите пароль (ещё цифры):', numberKeyboard());
  }
});

// Регистрация клиента
bot.onText(/\/register_client/, (msg) => {
  if (db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [msg.from.id])) {
    bot.sendMessage(msg.chat.id, 'Введите @username клиента:', { reply_markup: { remove_keyboard: true } });
    bot.once('message', (msg2) => {
      const username = msg2.text.replace('@', '');
      const discountCard = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8-значный код
      db.run(`INSERT OR IGNORE INTO users (telegram_id, discount_card, points, total_spent, discount_level) VALUES (?, ?, ?, ?, ?)`,
        [username, discountCard, 0, 0, 1], () => {
          bot.sendMessage(msg.chat.id, `Клиент ${username} зарегистрирован! Дисконтная карта: ${discountCard} (скидка 1%, бонусы 0)`);
        });
    });
  }
});

// Профиль клиента
bot.onText(/\/profile/, (msg) => {
  const username = msg.from.username || '';
  db.get(`SELECT points, purchases, discount_card, discount_level, total_spent FROM users WHERE telegram_id = ?`, [username], (err, row) => {
    if (row) {
      const discount = getDiscount(row.discount_level);
      bot.sendMessage(msg.chat.id, `Ваш профиль:\nПокупки: ${row.purchases || 'Нет'}\nБонусы: ${row.points} (1 бонус = 10 монет)\nСкидка: ${discount * 100}%\nПотрачено: ${row.total_spent} монет\nКарта: ${row.discount_card}`, clientKeyboard());
    } else {
      bot.sendMessage(msg.chat.id, 'Вы не зарегистрированы!');
    }
  });
});

// Заказ
bot.onText(/\/order/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Выберите товар:', goodsKeyboard());
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  if (query.data.startsWith('goods_')) {
    const good = query.data.replace('goods_', '');
    const prices = { diamonds: 100, armor: 200, sword: 150 };
    bot.editMessageText(`Вы выбрали: ${query.message.text.split('-')[0].trim()} (${prices[good]} монет). Выберите доставку:`, { chat_id: chatId, message_id: msgId, ...deliveryKeyboard() });
  } else if (query.data.startsWith('delivery_')) {
    const username = query.from.username || '';
    db.get(`SELECT total_spent, points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
      if (row) {
        const delivery = query.data.replace('delivery_', '');
        const prices = { diamonds: 100, armor: 200, sword: 150 };
        const good = query.message.text.split('-')[0].trim().toLowerCase().replace(' ', '_');
        const price = prices[good.replace(' ', '_').replace('(', '').replace(')', '')];
        const newTotalSpent = row.total_spent + price;
        const bonus = getBonusAmount(newTotalSpent);
        updateDiscountLevel(username, newTotalSpent);
        db.run(`UPDATE users SET total_spent = ?, points = points + ?, purchases = purchases || ? WHERE telegram_id = ?`,
          [newTotalSpent, bonus, `\n${query.message.text} | ${delivery}`, username], () => {
            bot.editMessageText(`Заказ подтверждён! Доставка: ${delivery}\nБонусы: +${bonus} (итого ${row.points + bonus})`, { chat_id: chatId, message_id: msgId });
            SELLERS.forEach(sellerId => bot.sendMessage(sellerId, `Новый заказ от ${username}: ${query.message.text} | ${delivery}`));
          });
      }
    });
  }
});

// Генерация дисконтной карты
bot.onText(/\/generate_card/, (msg) => {
  if (db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [msg.from.id])) {
    bot.sendMessage(msg.chat.id, 'Введите @username клиента:', { reply_markup: { remove_keyboard: true } });
    bot.once('message', (msg2) => {
      const username = msg2.text.replace('@', '');
      const discountCard = Math.floor(10000000 + Math.random() * 90000000).toString();
      db.run(`UPDATE users SET discount_card = ?, points = 0, discount_level = 1 WHERE telegram_id = ?`,
        [discountCard, username], () => {
          bot.sendMessage(msg.chat.id, `Дисконтная карта для ${username}: ${discountCard} (скидка 1%, бонусы 0)`);
        });
    });
  }
});

// Расчёт суммы
bot.onText(/\/calculate_sum/, (msg) => {
  if (db.get(`SELECT telegram_id FROM sellers WHERE telegram_id = ?`, [msg.from.id])) {
    bot.sendMessage(msg.chat.id, 'Есть ли у клиента дисконтная карта? (да/нет)', { reply_markup: { remove_keyboard: true } });
    bot.once('message', (msg2) => {
      if (msg2.text.toLowerCase() === 'да') {
        bot.sendMessage(msg.chat.id, 'Введите код карты:');
        bot.once('message', (msg3) => {
          const card = msg3.text;
          db.get(`SELECT telegram_id, points, discount_level, total_spent FROM users WHERE discount_card = ?`, [card], (err, row) => {
            if (row) {
              bot.sendMessage(msg.chat.id, 'Введите стоимости товаров через запятую (например: 100,200,300):');
              bot.once('message', (msg4) => {
                const prices = msg4.text.split(',').map(Number).filter(n => !isNaN(n));
                if (prices.length) {
                  const total = prices.reduce((a, b) => a + b, 0);
                  const discount = getDiscount(row.discount_level);
                  const discountAmount = total * discount;
                  const finalTotal = total - discountAmount;
                  const bonus = getBonusAmount(row.total_spent + total);
                  db.run(`UPDATE users SET points = points + ?, total_spent = total_spent + ? WHERE telegram_id = ?`,
                    [bonus, total, row.telegram_id], () => {
                      bot.sendMessage(msg.chat.id, `Сумма: ${total} монет\nСкидка: ${discount * 100}% (${discountAmount} монет)\nИтог: ${finalTotal} монет\nБонусы: +${bonus} (итого ${row.points + bonus})`);
                    });
                } else {
                  bot.sendMessage(msg.chat.id, 'Неверный формат!');
                }
              });
            } else {
              bot.sendMessage(msg.chat.id, 'Карта не найдена!');
            }
          });
        });
      } else {
        bot.sendMessage(msg.chat.id, 'Введите стоимости товаров через запятую (например: 100,200,300):');
        bot.once('message', (msg3) => {
          const prices = msg3.text.split(',').map(Number).filter(n => !isNaN(n));
          if (prices.length) {
            const total = prices.reduce((a, b) => a + b, 0);
            bot.sendMessage(msg.chat.id, `Сумма без скидки: ${total} монет`);
          } else {
            bot.sendMessage(msg.chat.id, 'Неверный формат!');
          }
        });
      }
    });
  }
});

// Просмотр всех операций (админ)
bot.onText(/\/view_all/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    db.all(`SELECT telegram_id, points, purchases, total_spent, discount_level FROM users`, [], (err, rows) => {
      let response = 'Все пользователи:\n';
      rows.forEach(row => {
        response += `${row.telegram_id}: Баллы ${row.points}, Потрачено ${row.total_spent}, Скидка ${getDiscount(row.discount_level) * 100}%, Покупки: ${row.purchases || 'Нет'}\n`;
      });
      bot.sendMessage(msg.chat.id, response || 'Нет данных', adminKeyboard());
    });
  }
});

// Добавление/удаление продавца (админ)
bot.onText(/\/add_seller/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, 'Введите Telegram ID продавца:');
    bot.once('message', (msg2) => {
      const sellerId = parseInt(msg2.text);
      if (!isNaN(sellerId)) {
        db.run(`INSERT OR IGNORE INTO sellers (telegram_id) VALUES (?)`, [sellerId]);
        bot.sendMessage(msg.chat.id, `Продавец ${sellerId} добавлен!`, adminKeyboard());
      } else {
        bot.sendMessage(msg.chat.id, 'Неверный ID!', adminKeyboard());
      }
    });
  }
});

bot.onText(/\/remove_seller/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, 'Введите Telegram ID продавца для удаления:');
    bot.once('message', (msg2) => {
      const sellerId = parseInt(msg2.text);
      if (!isNaN(sellerId)) {
        db.run(`DELETE FROM sellers WHERE telegram_id = ?`, [sellerId]);
        bot.sendMessage(msg.chat.id, `Продавец ${sellerId} удалён!`, adminKeyboard());
      } else {
        bot.sendMessage(msg.chat.id, 'Неверный ID!', adminKeyboard());
      }
    });
  }
});

console.log('Bot is running...');
