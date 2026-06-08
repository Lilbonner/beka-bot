import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_user
    ON messages (chat_id, user_id);

  CREATE TABLE IF NOT EXISTS users (
    chat_id      INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    display_name TEXT,
    has_left     INTEGER NOT NULL DEFAULT 0,
    left_at      INTEGER,
    PRIMARY KEY (chat_id, user_id)
  );
`);

// ---------- подготовленные запросы ----------
const stmtInsertMessage = db.prepare(
  `INSERT INTO messages (chat_id, user_id, text, created_at) VALUES (?, ?, ?, ?)`
);

const stmtUpsertUser = db.prepare(`
  INSERT INTO users (chat_id, user_id, display_name, has_left)
  VALUES (?, ?, ?, 0)
  ON CONFLICT(chat_id, user_id)
  DO UPDATE SET display_name = excluded.display_name
`);

const stmtMarkLeft = db.prepare(`
  INSERT INTO users (chat_id, user_id, display_name, has_left, left_at)
  VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(chat_id, user_id)
  DO UPDATE SET has_left = 1,
               left_at = excluded.left_at,
               display_name = COALESCE(excluded.display_name, users.display_name)
`);

const stmtMarkBack = db.prepare(`
  UPDATE users SET has_left = 0, left_at = NULL
  WHERE chat_id = ? AND user_id = ?
`);

const stmtUserMessages = db.prepare(
  `SELECT text FROM messages WHERE chat_id = ? AND user_id = ?`
);

const stmtRandomMessage = db.prepare(`
  SELECT text FROM messages
  WHERE chat_id = ? AND user_id = ?
  ORDER BY RANDOM() LIMIT 1
`);

const stmtGhostChatActivity = db.prepare(`
  SELECT chat_id AS chatId, MAX(created_at) AS lastTs
  FROM messages
  WHERE chat_id IN (SELECT chat_id FROM users WHERE has_left = 1)
  GROUP BY chat_id
`);

const stmtGhosts = db.prepare(`
  SELECT u.user_id AS userId,
         u.display_name AS name,
         COUNT(m.id) AS count
  FROM users u
  JOIN messages m ON m.chat_id = u.chat_id AND m.user_id = u.user_id
  WHERE u.chat_id = ? AND u.has_left = 1
  GROUP BY u.user_id
  HAVING count >= ?
  ORDER BY count DESC
`);

const stmtUserSummary = db.prepare(`
  SELECT u.user_id      AS userId,
         u.display_name AS name,
         u.has_left     AS hasLeft,
         COUNT(m.id)    AS count
  FROM users u
  LEFT JOIN messages m ON m.chat_id = u.chat_id AND m.user_id = u.user_id
  WHERE u.chat_id = ?
  GROUP BY u.user_id
  ORDER BY count DESC
`);

// ---------- публичный API ----------
export function recordMessage(chatId, userId, displayName, text) {
  stmtUpsertUser.run(chatId, userId, displayName);
  stmtInsertMessage.run(chatId, userId, text, Date.now());
}

export function markUserLeft(chatId, userId, displayName = null) {
  stmtMarkLeft.run(chatId, userId, displayName, Date.now());
}

export function markUserBack(chatId, userId) {
  stmtMarkBack.run(chatId, userId);
}

export function getGhosts(chatId, minMessages) {
  return stmtGhosts.all(chatId, minMessages);
}

export function getUserMessages(chatId, userId) {
  return stmtUserMessages.all(chatId, userId).map((r) => r.text);
}

export function getRandomMessage(chatId, userId) {
  const row = stmtRandomMessage.get(chatId, userId);
  return row?.text ?? null;
}

export function getGhostChatActivity() {
  return stmtGhostChatActivity.all();
}

export function getUserSummary(chatId) {
  return stmtUserSummary.all(chatId);
}

// Массовый импорт исторических сообщений (с исходными датами) одной транзакцией
export function importMessages(rows) {
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmtUpsertUser.run(r.chatId, r.userId, r.name);
      stmtInsertMessage.run(r.chatId, r.userId, r.text, r.ts);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export default db;
