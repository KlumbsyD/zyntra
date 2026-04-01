FROM node:20-alpine

# Install ffmpeg and build tools for native modules
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    libc6-compat \
    libsodium-dev

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies (including native modules)
RUN npm install --omit=dev

# Copy source
COPY . .

# Persistent state directory (queue save, DJ roles)
VOLUME ["/data"]

# Web dashboard port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/status || exit 1

CMD ["node", "src/index.js"]
