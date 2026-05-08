FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./package.json
COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8080

CMD ["node", "backend/src/server.js"]
