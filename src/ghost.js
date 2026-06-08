import { config } from './config.js';
import { getGhosts, getUserMessages, getRandomMessage } from './db.js';
import { generateMarkov } from './markov.js';

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Список призраков чата (ливнувшие, у кого набралось достаточно сообщений)
export function listGhosts(chatId) {
  return getGhosts(chatId, config.minMessages);
}

// Случайный призрак чата (или null, если их нет)
export function pickGhost(chatId) {
  const ghosts = listGhosts(chatId);
  return ghosts.length ? pick(ghosts) : null;
}

// Генерирует одну фразу «от лица» призрака
export function speakAs(chatId, ghost) {
  // Иногда — дословная цитата
  if (Math.random() < config.verbatimProbability) {
    const real = getRandomMessage(chatId, ghost.userId);
    if (real) return real;
  }

  // Иначе — франкенштейн-фраза по Маркову
  const messages = getUserMessages(chatId, ghost.userId);
  const generated = generateMarkov(messages, {
    order: config.markovOrder,
    maxWords: config.markovMaxWords,
  });
  if (generated) return generated;

  // Фолбэк — реальная цитата, если Маркову не хватило данных
  return getRandomMessage(chatId, ghost.userId);
}

// Готовая оформленная реплика призрака (или null, если вызывать некого)
export function summon(chatId, ghost = null) {
  const g = ghost ?? pickGhost(chatId);
  if (!g) return null;
  const phrase = speakAs(chatId, g);
  if (!phrase) return null;
  return config.showGhostName ? `👻 ${g.name ?? 'кто-то'}:\n${phrase}` : phrase;
}
