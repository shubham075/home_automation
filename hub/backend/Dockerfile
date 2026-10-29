# Hub backend image. Build context: repository root.
#   docker compose -f hub/docker-compose.prod.yml build backend
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY hub/backend/package.json hub/backend/
RUN pnpm install --frozen-lockfile --filter @sw6/backend...

COPY packages/protocol packages/protocol
COPY hub/backend hub/backend
WORKDIR /app/hub/backend
RUN pnpm exec prisma generate

ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>r.json()).then(j=>process.exit(j.ok&&j.mqtt?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/start.sh"]
