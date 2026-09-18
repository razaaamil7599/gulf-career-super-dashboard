# Single-stage Dockerfile for reliability
FROM node:22

# Install browser dependencies for OpenClaw autonomous actions
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    fontconfig \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Next.js build
RUN npm run build

# Remove dev dependencies after build to save space (optional, but safer to keep them for now if unsure)
# RUN npm prune --production

ENV NODE_ENV=production
# NOTE: raising --max-old-space-size here was tried and reverted — it made
# the free-tier instance die silently (OS-level kill, no V8 error at all)
# instead of the original clean "heap out of memory" crash, which points to
# the container's *actual* usable memory being close to V8's original
# auto-detected ~256MB ceiling, not the nominal 512MB. The real fix is
# using less memory (see server/services/matchingService.js's candidate
# counts cache), not raising this ceiling.
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV PORT=8080
EXPOSE 8080

# Start unified server
CMD ["node", "server/customServer.js"]
