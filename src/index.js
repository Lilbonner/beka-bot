import { Bot } from 'grammy';
import { config } from './config.js';
import { recordMessage, markUserLeft, markUserBack, getUserSummary, getGhostChatActivity } from './db.js';
import { summon, listGhosts } from './ghost.js';

const bot = new Bot(config.botToken);

// Учёт активности для idle-сообщений
const lastActivity = new Map(); // chatId -> ts последнего сообщения человека
const lastIdlePost = new Map(); // chatId -> ts последнего авто-сообщения бота

function displayName(user) {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || `id${user.id}`;
}

// В личке прав нет — разрешаем; в группе нужны права админа
async function isAdmin(ctx) {
  if (ctx.chat?.type === 'private') return true;
  try {
    const m = await ctx.getAuthor();
    return m.status === 'administrator' || m.status === 'creator';
  } catch {
    return false;
  }
}

// ----------------------- Команды -----------------------
bot.command('start', (ctx) =>
  ctx.reply(
    '👻 Привет! Я БЕКС — память чата.\n' +
      'Я тихо собираю сообщения участников, а когда кто-то ливает — иногда оживаю и говорю его фразами.\n\n' +
      'Команды:\n' +
      '/ghost — позвать случайного призрака\n' +
      '/ghosts — список призраков чата\n' +
      '/help — помощь'
  )
);

bot.command('help', (ctx) =>
  ctx.reply(
    'Я вызываю «призраков» — тех, кто покинул чат.\n' +
      `Чтобы стать призраком, нужно уйти из чата и оставить минимум ${config.minMessages} сообщений.\n\n` +
      '/ghost — случайная фраза призрака\n' +
      '/ghosts — кто доступен'
  )
);

bot.command('ghost', (ctx) => {
  const reply = summon(ctx.chat.id);
  if (!reply) {
    return ctx.reply(
      'Пока некого вызывать — призраков нет. Нужно, чтобы кто-то ливнул, оставив достаточно сообщений 👀'
    );
  }
  return ctx.reply(reply);
});

bot.command('ghosts', (ctx) => {
  const ghosts = listGhosts(ctx.chat.id);
  if (ghosts.length === 0) return ctx.reply('Призраков пока нет 🤷');
  const lines = ghosts
    .map((g, i) => `${i + 1}. ${g.name ?? 'кто-то'} — ${g.count} сообщений`)
    .join('\n');
  return ctx.reply(`👻 Призраки чата:\n${lines}`);
});

// ID чата — нужен для импорта истории (node src/import.js ... --chat <ID>)
bot.command('chatid', (ctx) => ctx.reply(`ID этого чата: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' }));

// Список участников с ID и числом сообщений (для админов)
bot.command('users', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('Только для админов чата 🔒');
  const users = getUserSummary(ctx.chat.id).slice(0, 40);
  if (users.length === 0) return ctx.reply('В базе пока никого нет.');
  const lines = users
    .map((u) => `${u.hasLeft ? '👻' : '•'} ${u.name ?? 'кто-то'} — ${u.count} (id ${u.userId})`)
    .join('\n');
  return ctx.reply(`Участники в базе:\n${lines}`);
});

// Вручную пометить пользователя призраком (например, после импорта истории)
bot.command('makeghost', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('Только для админов чата 🔒');
  const id = Number(ctx.match);
  if (!Number.isFinite(id)) return ctx.reply('Использование: /makeghost <user_id> (id см. в /users)');
  markUserLeft(ctx.chat.id, id);
  return ctx.reply(`👻 Готово — id ${id} теперь призрак. Зови через /ghost.`);
});

// Снять метку призрака
bot.command('unghost', async (ctx) => {
  if (!(await isAdmin(ctx))) return ctx.reply('Только для админов чата 🔒');
  const id = Number(ctx.match);
  if (!Number.isFinite(id)) return ctx.reply('Использование: /unghost <user_id>');
  markUserBack(ctx.chat.id, id);
  return ctx.reply(`✅ id ${id} больше не призрак.`);
});

// ------------ Сбор сообщений + случайный триггер ------------
bot.on('message:text', async (ctx) => {
  if (!ctx.from || ctx.from.is_bot) return; // людей пишем, ботов и анонимов — нет
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // команды не собираем

  recordMessage(ctx.chat.id, ctx.from.id, displayName(ctx.from), text);
  lastActivity.set(ctx.chat.id, Date.now());

  // Случайно встреваем фразой призрака
  if (Math.random() < config.triggerProbability) {
    const reply = summon(ctx.chat.id);
    if (reply) {
      await ctx.reply(reply, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  }
});

// Человек вернулся в чат — снова «живой»
bot.on('message:new_chat_members', (ctx) => {
  for (const m of ctx.message.new_chat_members) {
    if (!m.is_bot) markUserBack(ctx.chat.id, m.id);
  }
});

// Сервисное сообщение «X вышел» (работает в обычных группах)
bot.on('message:left_chat_member', (ctx) => {
  const m = ctx.message.left_chat_member;
  if (m && !m.is_bot) markUserLeft(ctx.chat.id, m.id, displayName(m));
});

// Надёжное отслеживание выхода/входа (нужны права админа в группе)
bot.on('chat_member', (ctx) => {
  const upd = ctx.chatMember;
  const user = upd.new_chat_member.user;
  if (user.is_bot) return;

  const wasIn = ['member', 'administrator', 'creator', 'restricted'].includes(
    upd.old_chat_member.status
  );
  const status = upd.new_chat_member.status;
  const nowOut = status === 'left' || status === 'kicked';
  const nowIn = status === 'member' || status === 'administrator' || status === 'creator';

  if (wasIn && nowOut) {
    markUserLeft(ctx.chat.id, user.id, displayName(user));
  } else if (nowIn) {
    markUserBack(ctx.chat.id, user.id);
  }
});

// ---- idle: если в чате тишина дольше IDLE_MINUTES — бот сам пишет фразу ----
function startIdleWatcher() {
  if (config.idleMinutes <= 0) return;

  // сидируем временем последнего сообщения из БД — чтобы знать про тишину и после рестарта
  for (const { chatId, lastTs } of getGhostChatActivity()) {
    lastActivity.set(chatId, lastTs);
  }

  const idleMs = config.idleMinutes * 60_000;
  setInterval(async () => {
    const now = Date.now();
    for (const [chatId, ts] of lastActivity) {
      if (now - ts < idleMs) continue; // ещё активны
      if ((lastIdlePost.get(chatId) ?? 0) > ts) continue; // уже писали после последней активности
      const reply = summon(chatId);
      if (!reply) continue; // призрака нет — пропускаем
      try {
        await bot.api.sendMessage(chatId, reply);
        lastIdlePost.set(chatId, now);
      } catch (e) {
        console.error('idle send error:', e?.description ?? e?.message ?? e);
      }
    }
  }, 60_000);
}

// ----------------------- Запуск -----------------------
bot.catch((err) => {
  console.error('Ошибка в обработчике:', err.error ?? err);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

startIdleWatcher();

// Авто-ретрай на 409 Conflict: при перезапуске серверная сессия long-poll
// предыдущего инстанса может «висеть» ещё до 30с — пережидаем, а не падаем.
for (;;) {
  try {
    await bot.start({
      allowed_updates: ['message', 'chat_member', 'my_chat_member'],
      onStart: (me) => console.log(`✅ Бот @${me.username} запущен. Слушаю чаты...`),
    });
    break; // нормальная остановка
  } catch (err) {
    if (err?.error_code === 409) {
      console.warn('⏳ 409 Conflict — другой поллинг ещё активен, жду 5с и пробую снова...');
      await sleep(5000);
      continue;
    }
    throw err;
  }
}
