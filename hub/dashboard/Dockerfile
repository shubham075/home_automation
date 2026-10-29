# Web image: builds the PWA and serves it with Caddy (TLS with the hub-local certificate,
# reverse proxy for /api and /ws). Build context: repository root.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY hub/dashboard/package.json hub/dashboard/
RUN pnpm install --frozen-lockfile --filter @sw6/dashboard...
COPY packages/protocol packages/protocol
COPY hub/dashboard hub/dashboard
RUN pnpm --filter @sw6/dashboard exec vite build

FROM caddy:2-alpine
COPY hub/dashboard/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/hub/dashboard/dist /srv
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
