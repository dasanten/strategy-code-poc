# The production image (ADR 0007, ADR 0030): the Rust server (`csp-server`) with its admin
# commands, and the built client, which the server serves. Built by CI; production never builds
# anything. Same volumes, port, environment and unprivileged user as the TypeScript image, so
# `deploy/compose.yml` and the volumes it already has stay as they are.

# --- the Rust server, its dependencies cached apart from our crates (cargo-chef) ---------------
FROM rust:1-bookworm AS chef
RUN cargo install cargo-chef --version 0.1.73 --locked
WORKDIR /build

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS rust
COPY --from=planner /build/recipe.json recipe.json
# Only the dependencies: this layer stays cached until Cargo.lock changes.
RUN cargo chef cook --release --recipe-path recipe.json --package csp-server
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --package csp-server \
      --bin csp-server --bin csp-admin --bin check-fields

# --- the client, built as before ------------------------------------------------------------
FROM node:22.23.3-bookworm-slim AS web
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
# Baked into the client bundle at build time.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# --- the image ----------------------------------------------------------------------------------
FROM debian:bookworm-slim
# Certificates for Sentry over HTTPS; nothing else is needed at run time (SQLite is built in).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The same unprivileged user as the node image's (uid and gid 1000), who owns the volumes.
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --no-create-home node
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/world.db \
    BACKUP_DIR=/backups \
    WEB_DIST=/app/web \
    NODE_ENV=production
WORKDIR /app
COPY --from=rust /build/target/release/csp-server /build/target/release/csp-admin \
     /build/target/release/check-fields /usr/local/bin/
COPY --from=web /app/apps/web/dist ./web
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000
CMD ["csp-server"]
