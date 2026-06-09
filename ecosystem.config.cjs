// Конфиг PM2 для автозапуска бота БЕКС.
//   pm2 start ecosystem.config.cjs   — запустить
//   pm2 save                         — запомнить (чтобы поднимался после ребута)
//
// PM2 вызывает node напрямую (не через npm) — это обходит баг PM2+npm.cmd на
// Windows. cwd зафиксирован на папке конфига, чтобы .env и data/ находились
// независимо от того, откуда запущен pm2.
module.exports = {
  apps: [
    {
      name: 'beka',
      cwd: __dirname,
      script: 'src/index.js',
      interpreter: 'node',
      interpreter_args: '--disable-warning=ExperimentalWarning',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      time: true, // таймстемпы в логах
    },
  ],
};
