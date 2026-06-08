// Простая цепь Маркова заданного порядка для генерации «франкенштейн»-фраз.

const START = ''; // служебный маркер начала
const END = ''; // служебный маркер конца

function tokenize(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Строит карту: «N предыдущих слов» -> [возможные следующие слова]
function buildChain(messages, order) {
  const chain = new Map();
  for (const msg of messages) {
    const tokens = tokenize(msg);
    if (tokens.length === 0) continue;
    const seq = [...Array(order).fill(START), ...tokens, END];
    for (let i = 0; i + order < seq.length; i++) {
      const key = seq.slice(i, i + order).join(' ');
      const next = seq[i + order];
      let bucket = chain.get(key);
      if (!bucket) {
        bucket = [];
        chain.set(key, bucket);
      }
      bucket.push(next);
    }
  }
  return chain;
}

/**
 * Генерирует фразу из набора сообщений одного человека.
 * @returns {string|null} строка или null, если данных не хватило
 */
export function generateMarkov(messages, { order = 2, maxWords = 40 } = {}) {
  const chain = buildChain(messages, order);
  if (chain.size === 0) return null;

  let state = Array(order).fill(START);
  const out = [];

  for (let i = 0; i < maxWords; i++) {
    const choices = chain.get(state.join(' '));
    if (!choices || choices.length === 0) break;
    const next = pick(choices);
    if (next === END) break;
    out.push(next);
    state = [...state.slice(1), next];
  }

  return out.length ? out.join(' ') : null;
}
