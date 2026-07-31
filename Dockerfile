FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /build

# 使用国内镜像加速
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npx playwright install chromium --with-deps 2>/dev/null || true

COPY vite.config.js ./
COPY index.html ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache python3 make g++ \
    chromium \
    nss freetype harfbuzz ca-certificates ttf-freefont \
    && rm -rf /var/cache/apk/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY server/ ./server/
COPY --from=build /build/dist ./dist

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "server/index.js"]
