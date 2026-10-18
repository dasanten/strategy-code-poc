# The production image (ADR 0007): the compiled server, its production dependencies and the
# built client, which the server serves. Built by CI; production never builds anything.

FROM node:22.23.3-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
# Baked into the client bundle at build time.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# The server with production dependencies only, workspace packages copied in.
RUN pnpm --filter @csp/server deploy --prod --legacy /out

FROM node:22.23.3-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/world.db \
    BACKUP_DIR=/backups \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out .
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
