// Загрузка переменных из .env (встроено в Node 20.6+). Не падаем, если файла нет.
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — значения берём из окружения / по умолчанию
}

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v !== 'false' && v !== '0';
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  dbPath: process.env.DB_PATH ?? './data/beks.db',

  // ID целевого чата (используется как дефолт для импорта истории); null — не задан
  chatId: process.env.CHAT_ID ? Number(process.env.CHAT_ID) : null,

  // Вероятность, что бот сам встрянет в случайное сообщение (0..1)
  triggerProbability: num('TRIGGER_PROBABILITY', 0.07),

  // Сколько минимум сообщений нужно от человека, чтобы он стал «призраком»
  minMessages: num('MIN_MESSAGES', 20),

  // Вероятность выдать дословную цитату вместо сгенерированной фразы (0..1)
  verbatimProbability: num('VERBATIM_PROBABILITY', 0.4),

  // Порядок цепи Маркова (1 — хаотичнее, 2 — связнее)
  markovOrder: num('MARKOV_ORDER', 2),

  // Максимум слов в сгенерированной фразе
  markovMaxWords: num('MARKOV_MAX_WORDS', 40),

  // Показывать ли имя призрака перед фразой
  showGhostName: bool('SHOW_GHOST_NAME', true),

  // Тишина дольше N минут → бот сам пишет фразу призрака (0 — выключено)
  idleMinutes: num('IDLE_MINUTES', 60),
};

if (!config.botToken) {
  console.error(
    '❌ BOT_TOKEN не задан. Скопируй .env.example в .env и впиши токен от @BotFather.'
  );
  process.exit(1);
}
