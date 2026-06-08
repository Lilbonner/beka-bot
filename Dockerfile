# БЕКС — Telegram-бот на Node.js. node:sqlite встроен, нативной сборки не нужно.
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Долгоиграющий процесс (long polling), без HTTP-порта
CMD ["npm", "start"]
