# Changelog

## 0.1.0
- Сбор текстовых сообщений участников в SQLite (`node:sqlite`, без нативной сборки).
- Призраки ливнувших: гибрид реальных цитат и «франкенштейн»-фраз по цепям Маркова.
- Случайные вмешательства в чат (`TRIGGER_PROBABILITY`).
- Idle-сообщения: если в чате тишина дольше `IDLE_MINUTES`, бот сам пишет фразу призрака.
- Импорт истории из экспорта Telegram Desktop (JSON и HTML), фильтр по одному юзеру.
- Команды: `/ghost`, `/ghosts`, `/chatid`, `/users`, `/makeghost`, `/unghost`.
- Устойчивость к 409 Conflict при перезапуске.
- Деплой: `Dockerfile` + `render.yaml` (Background Worker + постоянный диск).
