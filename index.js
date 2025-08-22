const { Telegraf } = require('telegraf');
     const sqlite3 = require('sqlite3').verbose();

     const TOKEN = '8202218400:AAG5fM1M_sKD6nnzEaXQAQQBdyMTlfZq_BE';
     const SELLERS = [6413382806];

     const bot = new Telegraf(TOKEN);
     const db = new sqlite3.Database('./loyalty.db');

     db.run(`CREATE TABLE IF NOT EXISTS users (
       telegram_id TEXT PRIMARY KEY,
       password TEXT,
       points INTEGER,
       purchases TEXT
     )`);

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
           keyboard: [['/register', '/addpoints', '/discount']],
           resize_keyboard: true
         }
       };
     }

     bot.start((ctx) => {
       if (SELLERS.includes(ctx.from.id)) {
         ctx.reply('Добро пожаловать, продавец!', sellerKeyboard());
       } else {
         ctx.reply('Добро пожаловать, клиент!', clientKeyboard());
       }
     });

     bot.command('register', (ctx) => {
       if (!SELLERS.includes(ctx.from.id)) {
         ctx.reply('Только продавцы могут регистрировать клиентов!');
         return;
       }
       const args = ctx.message.text.split(' ').slice(1);
       if (args.length < 2) {
         ctx.reply('Используйте: /register @username пароль');
         return;
       }
       const username = args[0].replace('@', '');
       const password = args[1];
       db.get(`SELECT telegram_id FROM users WHERE telegram_id = ?`, [username], (err, row) => {
         if (row) {
           ctx.reply(`Клиент ${username} уже зарегистрирован!`);
         } else {
           db.run(`INSERT INTO users (telegram_id, password, points, purchases) VALUES (?, ?, ?, ?)`,
             [username, password, 0, ''], () => {
               ctx.reply(`Клиент ${username} зарегистрирован!`);
               ctx.telegram.sendMessage(ctx.chat.id, `${username}, вы зарегистрированы! Используйте /profile пароль`, clientKeyboard());
             });
         }
       });
     });

     bot.command('profile', (ctx) => {
       const args = ctx.message.text.split(' ').slice(1);
       if (args.length < 1) {
         ctx.reply('Введите: /profile пароль');
         return;
       }
       const password = args[0];
       db.get(`SELECT * FROM users WHERE telegram_id = ? AND password = ?`,
         [ctx.from.username || '', password], (err, row) => {
           if (row) {
             ctx.reply(`Ваш профиль:\nБаллы: ${row.points}\nПокупки: ${row.purchases || 'Нет покупок'}`, clientKeyboard());
           } else {
             ctx.reply('Неверный пароль или вы не зарегистрированы!');
           }
         });
     });

     bot.command('order', (ctx) => {
       const args = ctx.message.text.split(' ').slice(1).join(' ');
       if (!args) {
         ctx.reply('Введите: /order товар доставка(дом/магазин)');
         return;
       }
       db.get(`SELECT purchases FROM users WHERE telegram_id = ?`, [ctx.from.username || ''], (err, row) => {
         const newPurchases = (row ? row.purchases + '\n' : '') + args;
         db.run(`UPDATE users SET purchases = ? WHERE telegram_id = ?`, [newPurchases, ctx.from.username || ''], () => {
           ctx.reply(`Заказ '${args}' принят! Ожидайте подтверждения.`);
           SELLERS.forEach(sellerId => {
             ctx.telegram.sendMessage(sellerId, `Новый заказ от ${ctx.from.username}: ${args}`);
           });
         });
       });
     });

     bot.command('addpoints', (ctx) => {
       if (!SELLERS.includes(ctx.from.id)) {
         ctx.reply('Только продавцы могут начислять баллы!');
         return;
       }
       const args = ctx.message.text.split(' ').slice(1);
       if (args.length < 2) {
         ctx.reply('Используйте: /addpoints @username количество');
         return;
       }
       const username = args[0].replace('@', '');
       const points = parseInt(args[1]);
       db.get(`SELECT points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
         const newPoints = (row ? row.points + points : points);
         db.run(`INSERT OR REPLACE INTO users (telegram_id, password, points, purchases) VALUES (?, ?, ?, ?)`,
           [username, '', newPoints, ''], () => {
             ctx.reply(`Добавлено ${points} баллов для ${username}`);
             ctx.telegram.sendMessage(ctx.chat.id, `${username}, вам начислено ${points} баллов!`);
           });
       });
     });

     bot.command('discount', (ctx) => {
       if (!SELLERS.includes(ctx.from.id)) {
         ctx.reply('Только продавцы могут применять скидки!');
         return;
       }
       const args = ctx.message.text.split(' ').slice(1);
       if (args.length < 3) {
         ctx.reply('Используйте: /discount @username сумма процент');
         return;
       }
       const username = args[0].replace('@', '');
       const amount = parseFloat(args[1]);
       const percent = parseFloat(args[2]);
       const discount = amount * (percent / 100);
       const pointsNeeded = Math.floor(discount * 10);
       db.get(`SELECT points FROM users WHERE telegram_id = ?`, [username], (err, row) => {
         if (row && row.points >= pointsNeeded) {
           db.run(`UPDATE users SET points = points - ? WHERE telegram_id = ?`,
             [pointsNeeded, username], () => {
               ctx.reply(`Скидка ${percent}% (${discount} руб) применена для ${username}, списано ${pointsNeeded} баллов`);
               ctx.telegram.sendMessage(ctx.chat.id, `${username}, вам применена скидка ${percent}% на ${amount} руб!`);
             });
         } else {
           ctx.reply(`У ${username} недостаточно баллов (${row ? row.points : 0}/${pointsNeeded})`);
         }
       });
     });

     bot.launch();
     console.log('Bot is running...');
