FROM docker.1panel.live/library/node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /build

# 使用国内镜像加速
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY vite.config.js ./
COPY index.html ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

FROM docker.1panel.live/library/node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY server/ ./server/
COPY --from=build /build/dist ./dist
COPY sources.md ./sources.md

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "server/index.js"]
