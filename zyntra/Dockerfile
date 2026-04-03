FROM node:20-alpine

# Install ffmpeg and build tools
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    libsodium-dev \
    sqlite-dev

WORKDIR /app

COPY package*.json ./

# Install deps, then forcibly remove sodium-native so @discordjs/voice
# falls back to libsodium-wrappers (pure JS, works on Alpine musl)
RUN npm install --omit=dev && \
    npm uninstall sodium-native --ignore-scripts 2>/dev/null || true && \
    rm -rf node_modules/sodium-native

COPY . .

VOLUME ["/data"]
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3333/api/status || exit 1

CMD ["node", "src/index.js"]
