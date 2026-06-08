// Импорт истории чата в базу бота. Поддерживает два формата экспорта Telegram Desktop:
//   • JSON  — путь к result.json
//   • HTML  — путь к ПАПКЕ экспорта (с файлами messages*.html)
//
// Режимы:
//   1) Показать, кто есть в экспорте (в базу не пишет):
//      node --disable-warning=ExperimentalWarning src/import.js <путь> --list
//
//   2) Импортировать ТОЛЬКО одного человека и сделать его призраком:
//      node --disable-warning=ExperimentalWarning src/import.js <путь> --only <id|имя>
//
//   3) Импортировать всех:
//      node --disable-warning=ExperimentalWarning src/import.js <путь> [--ghost <id> ...]
//
//   --chat   ID чата как его видит бот (узнать командой /chatid). Если не задан —
//            берётся CHAT_ID из .env, иначе вычисляется из JSON-экспорта.
//   --only   импортировать только этого юзера (числовой id ИЛИ подстрока имени);
//            он автоматически помечается призраком.
//   --ghost  пометить юзера призраком вручную (можно несколько раз).
//   --list   только показать список юзеров экспорта и выйти.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { importMessages, markUserLeft, getUserSummary } from './db.js';
import { parseHtmlExport } from './parseHtml.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const hasFlag = (name) => args.includes(`--${name}`);

function flagValue(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function flagValues(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}

if (!file || !existsSync(file)) {
  console.error('Использование: node src/import.js <путь к result.json ИЛИ к папке HTML-экспорта> [--list] [--chat <ID>] [--only <id|имя>] [--ghost <id> ...]');
  if (file) console.error(`Не найдено: ${file}`);
  process.exit(1);
}

// ---------- разбор JSON-формата ----------
function flattenText(t) {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
  return '';
}
function parseUserId(fromId) {
  if (typeof fromId === 'number') return fromId;
  if (typeof fromId === 'string') {
    const m = fromId.match(/^user(\d+)$/);
    if (m) return Number(m[1]);
  }
  return null;
}
function deriveChatId(data) {
  const type = String(data.type || '').toLowerCase();
  if (type.includes('supergroup') || type.includes('channel')) return Number(`-100${data.id}`);
  return -Math.abs(Number(data.id));
}
function extractJson(raw) {
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const rows = [];
  let skipped = 0;
  for (const m of messages) {
    if (m.type !== 'message') { skipped++; continue; }
    const userId = parseUserId(m.from_id);
    if (!userId) { skipped++; continue; }
    const text = flattenText(m.text).trim();
    if (!text) { skipped++; continue; }
    const ts = m.date_unixtime ? Number(m.date_unixtime) * 1000 : (Date.parse(m.date) || Date.now());
    rows.push({ userId, name: m.from || `id${userId}`, text, ts });
  }
  return { rows, skipped };
}

// ---------- загрузка экспорта (JSON или HTML) ----------
const isDir = statSync(file).isDirectory();
const isHtml = isDir || file.toLowerCase().endsWith('.html');

let allRows;
let skipped = 0;
let exportName;
let rawForDerive = null;

if (isHtml) {
  const dir = isDir ? file : dirname(file);
  allRows = parseHtmlExport(dir);
  exportName = `HTML-экспорт (${dir})`;
} else {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  rawForDerive = raw;
  exportName = raw.name ?? '?';
  ({ rows: allRows, skipped } = extractJson(raw));
}

if (allRows.length === 0) {
  console.error('❌ Не нашёл ни одного текстового сообщения. Проверь путь и формат экспорта.');
  process.exit(1);
}

// ---------- режим --list ----------
if (hasFlag('list')) {
  const byUser = new Map();
  for (const r of allRows) {
    const u = byUser.get(r.userId) ?? { name: r.name, count: 0 };
    u.count++;
    byUser.set(r.userId, u);
  }
  const list = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`\nЮзеры в «${exportName}» (всего текстовых сообщений: ${allRows.length}):\n`);
  console.log('  ' + 'ID'.padEnd(14) + 'сообщ.'.padEnd(8) + 'имя');
  for (const [id, u] of list) {
    console.log('  ' + String(id).padEnd(14) + String(u.count).padEnd(8) + u.name);
  }
  console.log('\nИмпортировать только нужного: node src/import.js <путь> --only <id-или-имя>');
  process.exit(0);
}

// ---------- определяем chat_id ----------
const chatArg = flagValue('chat');
const only = flagValue('only');
const ghostIds = flagValues('ghost').map(Number).filter(Number.isFinite);

let chatId;
if (chatArg) {
  chatId = Number(chatArg);
} else if (config.chatId != null) {
  chatId = config.chatId;
  console.log(`ℹ️  --chat не задан, беру CHAT_ID из .env: ${chatId}`);
} else if (rawForDerive) {
  chatId = deriveChatId(rawForDerive);
  console.warn(`⚠️  --chat и CHAT_ID не заданы. Вычислил из экспорта: ${chatId} (лучше указать явно через /chatid).`);
} else {
  console.error('❌ Для HTML-экспорта укажи чат: --chat <ID> или CHAT_ID в .env (узнать командой /chatid).');
  process.exit(1);
}

// ---------- фильтр --only ----------
function matchesOnly(r) {
  if (!only) return true;
  const asNum = Number(only);
  if (Number.isFinite(asNum) && asNum === r.userId) return true;
  return r.name.toLowerCase().includes(String(only).toLowerCase());
}

const rows = allRows
  .filter(matchesOnly)
  .map((r) => ({ chatId, userId: r.userId, name: r.name, text: r.text, ts: r.ts }));

if (rows.length === 0) {
  console.error(`❌ По фильтру --only "${only}" ничего не нашлось. Проверь имя/ID через --list.`);
  process.exit(1);
}

importMessages(rows);

// помечаем призраками: явные --ghost + всех, кого импортировали по --only
const toGhost = new Set(ghostIds);
if (only) for (const r of rows) toGhost.add(r.userId);
for (const id of toGhost) markUserLeft(chatId, id);

// ---------- отчёт ----------
console.log(`\n✅ Импортировано сообщений: ${rows.length}${skipped ? ` (пропущено в экспорте: ${skipped})` : ''}`);
console.log(`   Чат: ${chatId}`);
if (only) console.log(`   Фильтр --only: "${only}"`);
if (toGhost.size) console.log(`   Помечены призраками (id): ${[...toGhost].join(', ')}`);
console.log('\nУчастники в базе этого чата:');
console.log('  ' + 'ID'.padEnd(14) + 'сообщ.'.padEnd(8) + 'призрак  имя');
for (const u of getUserSummary(chatId)) {
  const ghost = u.hasLeft ? '  👻   ' : '       ';
  console.log('  ' + String(u.userId).padEnd(14) + String(u.count).padEnd(8) + ghost + (u.name ?? ''));
}
console.log('\nЗови призрака командой /ghost в группе.');
