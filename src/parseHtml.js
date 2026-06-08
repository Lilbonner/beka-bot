// Парсер HTML-экспорта Telegram Desktop (messages*.html).
// Возвращает [{ userId, name, text, ts }]. Числового id в HTML нет,
// поэтому userId — стабильный хэш отображаемого имени.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// FNV-1a 32-bit → положительный синтетический id по имени
function hashId(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const NAMED_ENTITIES = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};
function decodeEntities(s) {
  return s
    .replace(/&lt;|&gt;|&amp;|&quot;|&#39;|&nbsp;/g, (m) => NAMED_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripText(html) {
  return decodeEntities(
    html
      .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/g, '$1') // эмодзи как <img alt="😀">
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/ /g, ' ')
    .trim();
}

// "24.11.2022 23:18:08 UTC+06:00" → миллисекунды
function parseDate(title) {
  const m = title && title.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2}) UTC([+-]\d{2}:\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}${m[5]}`);
  return Number.isFinite(t) ? t : null;
}

// messages.html = 1, messagesN.html = N (нужен числовой порядок)
function fileIndex(name) {
  const m = name.match(/^messages(\d*)\.html$/);
  if (!m) return Infinity;
  return m[1] === '' ? 1 : Number(m[1]);
}

export function parseHtmlExport(dir) {
  const files = readdirSync(dir)
    .filter((f) => /^messages\d*\.html$/.test(f))
    .sort((a, b) => fileIndex(a) - fileIndex(b));

  const rows = [];
  let currentName = null; // автор текущей «серии» сообщений (для joined)
  let fallbackTs = 0;

  for (const file of files) {
    const html = readFileSync(join(dir, file), 'utf8');
    const blocks = html.split('<div class="message ').slice(1);

    for (const block of blocks) {
      if (/^service/.test(block)) continue; // сервисные — пропускаем, автора не сбрасываем

      const nameM = block.match(/<div class="from_name">\s*([\s\S]*?)\s*<\/div>/);
      if (nameM) {
        const nm = stripText(nameM[1]);
        if (nm) currentName = nm;
      }

      const textM = block.match(/<div class="text">([\s\S]*?)<\/div>/);
      if (!textM) continue; // медиа без подписи и т.п.
      const text = stripText(textM[1]);
      if (!text || !currentName) continue;

      const dateM = block.match(/class="pull_right date details" title="([^"]+)"/);
      const ts = parseDate(dateM && dateM[1]) ?? (fallbackTs += 1000);

      rows.push({ userId: hashId(currentName), name: currentName, text, ts });
    }
  }
  return rows;
}
