# Bellhop Concierge tool server. node:20-slim (glibc) so better-sqlite3 uses its prebuilt binary.
# Build stage has a toolchain so better-sqlite3 can compile if its prebuilt binary
# cannot be fetched; the runtime stage stays lean.
FROM docker.io/library/node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM docker.io/library/node:20-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY config ./config
COPY compiler ./compiler
COPY personas ./personas
COPY template ./template
COPY dashboard/dist ./dashboard/dist
# Cache dir (a named volume is mounted here at run time); owned by the non-root user.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
ENV NODE_ENV=production
USER node
EXPOSE 4040
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4040)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
