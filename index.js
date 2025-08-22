const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const TOKEN = '8202218400:AAG5fM1M_sKD6nnzEaXQAQQBdyMTlfZq_BE';
const ADMIN_ID = 6413382806;
const SELLER_PASSWORD = '123456';
const SELLERS = new Set(); // Будет обновляться через админ-панель

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./loyalty.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  password TEXT,
  points INTEGER DEFAULT 0,
  purchases TEXT,
  discount_card TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS sellers (
  telegram_id TEXT PRIMARY KEY,
  password TEXT
)`);

// Инициализация продавцов из базы
db.all(`SELECT telegram_id FROM sellers`, [], (err, rows) => {
  if (!err) rows.forEach(row => SELLERS.add(parseInt(row.telegram_id)));
});

// Генерация уникального кода дисконтной карты
function generateDiscountCard() {
  return 'DISC' + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Клавиатуры
function clientKeyboard() {
  return {
    reply_markup: {
      keyboard: [['/profile', '/order']],
      resize_keyboard: true
    }
  };
}

function sellerKeyboard() {
  return {
    reply_markup: {
      keyboard: [['/register_client', '/addpoints', '/discount', '/calculate']],
      resize_keyboard: true
    }
  };
}

function deliveryKeyboard() {
  return {
    reply_markup: {
      keyboard: [['Дом', 'Магазин']],
      resize_keyboard: true
    }
  };
}

function adminKeyboard() {
  return {
    reply_markup: {
      keyboard: [['/add_seller', '/remove_seller']],
      resize_keyboard: true
    }
  };
}

// Старт
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(chatId, 'Добро пожаловать, Админ!', adminKeyboard());
  } else if (SELLERS.has(msg.from.id)) {
    bot.sendMessage(chatId, 'Введите пароль продавца:', { reply_markup: { remove_keyboard: true } });
    bot.once('message', (passwordMsg) => {
      if (passwordMsg.text === SELLER_PASSWORD) {
        bot.sendMessage(chatId, 'Добро пожаловать, продавец!', sellerKeyboard());
      } else {
        bot.sendMessage(chatId, 'Неверный пароль!');
      }
    });
  } else {
    bot.sendMessage(chatId, 'Добро пожаловать, клиент!', clientKeyboard());
  }
});

// Регистрация клиента (для продавцов)
bot.onText(/\/register_client/, (msg) => {
  if (!SELLERS.has(msg.from.id)) {
    bot.sendMessage(msg.chat.id, 'Только продавцы могут регистрировать клиентов!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите: /register_client @username пароль');
  bot.once('message', (regMsg) => {
    const args = regMsg.text.split(' ').slice(1);
    if (args.length < 2 || !regMsg.text.startsWith('/register_client')) {
      bot.sendMessage(msg.chat.id, 'Неверный формат! Используйте: /register_client @username пароль');
      return;
    }
    const username = args[0].replace('@', '');
    const password = args[1];
    db.get(`SELECT telegram_id FROM users WHERE telegram_id = ?`, [username], (err, row) => {
      if (row) {
        bot.sendMessage(msg.chat.id, `Клиент ${username} уже зарегистрирован!`);
      } else {
        const discountCard = generateDiscountCard();
        db.run(`INSERT INTO users (telegram_id, password, points, purchases, discount_card) VALUES (?, ?, ?, ?, ?)`,
          [username, password, 0, '', discountCard], () => {
            bot.sendMessage(msg.chat.id, `Клиент ${username} зарегистрирован! Дисконтная карта: ${discountCard}`);
            bot.sendMessage(msg.chat.id, `${username}, вы зарегистрированы! Используйте /profile`, clientKeyboard());
          });
      }
    });
  });
});

// Профиль клиента
bot.onText(/\/profile/, (msg) => {
  const args = msg.text.split(' ').slice(1);
  if (args.length < 1) {
    bot.sendMessage(msg.chat.id, 'Введите: /profile пароль');
    return;
  }
  const password = args[0];
  db.get(`SELECT * FROM users WHERE telegram_id = ? AND password = ?`, [msg.from.username || '', password], (err, row) => {
    if (row) {
      bot.sendMessage(msg.chat.id, `Ваш профиль:\nБаллы: ${row.points}\nПокупки: ${row.purchases || 'Нет покупок'}\nДисконтная карта: ${row.discount_card}`, clientKeyboard());
    } else {
      bot.sendMessage(msg.chat.id, 'Неверный пароль или вы не зарегистрированы!');
    }
  });
});

// Заказ с выбором доставки
bot.onText(/\/order/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Выберите тип доставки:', deliveryKeyboard());
  bot.once('message', (deliveryMsg) => {
    const delivery = deliveryMsg.text;
    if (delivery !== 'Дом' && delivery !== 'Магазин') {
      bot.sendMessage(msg.chat.id, 'Выберите: Дом или Магазин!');
      return;
    }
    bot.sendMessage(msg.chat.id, 'Введите заказ (например, алмазы 10):');
    bot.once('message', (orderMsg) => {
      const args = orderMsg.text.split(' ');
      if (args.length < 2) {
        bot.sendMessage(msg.chat.id, 'Введите: товар количество (например, алмазы 10)');
        return;
      }
      const item = args[0];
      const quantity = parseInt(args[1]);
      const orderText = `${item} ${quantity} (${delivery})`;
      db.get(`SELECT purchases FROM users WHERE telegram_id = ?`, [msg.from.username || ''], (err, row) => {
        const newPurchases = (row ? row.purchases + '\n' : '') + orderText;
        db.run(`UPDATE users SET purchases = ? WHERE telegram_id = ?`, [newPurchases, msg.from.username || ''], () => {
          bot.sendMessage(msg.chat.id, `Заказ '${orderText}' принят!`);
          SELLERS.forEach(sellerId => {
            bot.sendMessage(sellerId, `Новый заказ от ${msg.from.username}: ${orderText}`);
          });
        });
      });
    });
  });
});

// Начисление баллов
bot.onText(/\/addpoints/, (msg) => {
  if (!SELLERS.has(msg.from.id)) {
    bot.sendMessage(msg.chat.id, 'Только продавцы могут начислять баллы!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите: /addpoints @username количество');
  bot.once('message', (pointsMsg) => {
    const args = pointsMsg.text.split(' ').slice(1);
    if (args.length < 2 || !pointsMsg.text.startsWith('/addpoints')) {
      bot.sendMessage(msg.chat.id, 'Неверный формат! Используйте: /addpoints @username количество');
      return;
    }
    const username = args[0].replace('@', '');
    const points = parseInt(args[1]);
    db.get(`SELECT points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
      const newPoints = (row ? row.points + points : points);
      db.run(`INSERT OR REPLACE INTO users (telegram_id, password, points, purchases, discount_card) VALUES (?, ?, ?, ?, ?)`,
        [username, '', newPoints, '', ''], () => {
          bot.sendMessage(msg.chat.id, `Добавлено ${points} баллов для ${username}`);
          bot.sendMessage(msg.chat.id, `${username}, вам начислено ${points} баллов!`);
        });
    });
  });
});

// Применение скидки
bot.onText(/\/discount/, (msg) => {
  if (!SELLERS.has(msg.from.id)) {
    bot.sendMessage(msg.chat.id, 'Только продавцы могут применять скидки!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите: /discount @username сумма процент');
  bot.once('message', (discMsg) => {
    const args = discMsg.text.split(' ').slice(1);
    if (args.length < 3 || !discMsg.text.startsWith('/discount')) {
      bot.sendMessage(msg.chat.id, 'Неверный формат! Используйте: /discount @username сумма процент');
      return;
    }
    const username = args[0].replace('@', ');
    const amount = parseFloat(args[1]);
    const percent = parseFloat(args[2]);
    const discount = amount * (percent / 100);
    const pointsNeeded = Math.floor(discount * 10);
    db.get(`SELECT points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
      if (row && row.points >= pointsNeeded) {
        db.run(`UPDATE users SET points = points - ? WHERE telegram_id = ?`, [pointsNeeded, username], () => {
          bot.sendMessage(msg.chat.id, `Скидка ${percent}% (${discount} руб) применена для ${username}, списано ${pointsNeeded} баллов`);
          bot.sendMessage(msg.chat.id, `${username}, вам применена скидка ${percent}% на ${amount} руб!`);
        });
      } else {
        bot.sendMessage(msg.chat.id, `У ${username} недостаточно баллов (${row ? row.points : 0}/${pointsNeeded})`);
      }
    });
  });
});

// Расчёт суммы покупки
bot.onText(/\/calculate/, (msg) => {
  if (!SELLERS.has(msg.from.id)) {
    bot.sendMessage(msg.chat.id, 'Только продавцы могут рассчитывать покупки!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите: /calculate @username товар количество цена');
  bot.once('message', (calcMsg) => {
    const args = calcMsg.text.split(' ').slice(1);
    if (args.length < 4 || !calcMsg.text.startsWith('/calculate')) {
      bot.sendMessage(msg.chat.id, 'Неверный формат! Используйте: /calculate @username товар количество цена');
      return;
    }
    const username = args[0].replace('@', '');
    const item = args[1];
    const quantity = parseInt(args[2]);
    const price = parseFloat(args[3]);
    const total = quantity * price;
    db.get(`SELECT points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
      const pointsEarned = Math.floor(total / 10); // 1 балл за 10 рублей
      if (row) {
        db.run(`UPDATE users SET points = points + ? WHERE telegram_id = ?`, [pointsEarned, username], () => {
          bot.sendMessage(msg.chat.id, `Сумма покупки для ${username}: ${total} руб\nНачислено ${pointsEarned} баллов`);
          bot.sendMessage(msg.chat.id, `${username}, вам начислено ${pointsEarned} баллов за покупку!`);
        });
      } else {
        bot.sendMessage(msg.chat.id, `Клиент ${username} не найден!`);
      }
    });
  });
});

// Админ-панель
bot.onText(/\/add_seller/, (msg) => {
  if (msg.from.id !== ADMIN_ID) {
    bot.sendMessage(msg.chat.id, 'Только админ может это делать!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите ID продавца для добавления:');
  bot.once('message', (addMsg) => {
    const sellerId = parseInt(addMsg.text);
    if (!isNaN(sellerId)) {
      db.run(`INSERT OR REPLACE INTO sellers (telegram_id, password) VALUES (?, ?)`, [sellerId, SELLER_PASSWORD], () => {
        SELLERS.add(sellerId);
        bot.sendMessage(msg.chat.id, `Продавец ${sellerId} добавлен!`);
      });
    } else {
      bot.sendMessage(msg.chat.id, 'Неверный ID!');
    }
  });
});

bot.onText(/\/remove_seller/, (msg) => {
  if (msg.from.id !== ADMIN_ID) {
    bot.sendMessage(msg.chat.id, 'Только админ может это делать!');
    return;
  }
  bot.sendMessage(msg.chat.id, 'Введите ID продавца для удаления:');
  bot.once('message', (removeMsg) => {
    const sellerId = parseInt(removeMsg.text);
    if (!isNaN(sellerId)) {
      db.run(`DELETE FROM sellers WHERE telegram_id = ?`, [sellerId], () => {
        SELLERS.delete(sellerId);
        bot.sendMessage(msg.chat.id, `Продавец ${sellerId} удалён!`);
      });
    } else {
      bot.sendMessage(msg.chat.id, 'Неверный ID!');
    }
  });
});

console.log('Bot is running...');
