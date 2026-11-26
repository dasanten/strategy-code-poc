# The production image (ADR 0007, ADR 0030): the Rust server (`csp-server`) with its admin
# commands (`csp-admin`, `check-fields`), and the built client, which the server serves. Built by
# CI; production never builds anything. Same volumes, port, environment and unprivileged user as
# the TypeScript image had, so `deploy/compose.yml` and its volumes stay as they are, and rolling
# back to a TypeScript image is the previous tag plus the `-start` backup (README, Deploy).

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
RUN cargo build --release --package csp-server --bin csp-server --bin csp-admin --bin check-fields

# --- the editor's WebAssembly checker (T88.3); wasm-bindgen-cli at the version in Cargo.lock --
# and binaryen's wasm-opt at the version of the `binaryen` dev dependency in package.json (#1637),
# with the flags of scripts/wasm-build.mjs.
FROM chef AS wasm
ARG BINARYEN=132
ARG BINARYEN_SHA256=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572
RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-bindgen-cli --version 0.2.130 --locked
RUN curl -fsSL -o /tmp/binaryen.tar.gz \
        https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN}/binaryen-version_${BINARYEN}-x86_64-linux.tar.gz \
    && echo "${BINARYEN_SHA256}  /tmp/binaryen.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/binaryen.tar.gz -C /tmp \
    && install /tmp/binaryen-version_${BINARYEN}/bin/wasm-opt /usr/local/bin/wasm-opt \
    && rm -rf /tmp/binaryen.tar.gz /tmp/binaryen-version_${BINARYEN} \
    && wasm-opt --version
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --profile wasm --target wasm32-unknown-unknown --package csp-lang-wasm --lib \
    && wasm-bindgen --target web --out-dir /wasm --out-name csp_lang_wasm \
        --remove-name-section --remove-producers-section \
        target/wasm32-unknown-unknown/wasm/csp_lang_wasm.wasm \
    && wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
        --enable-mutable-globals --enable-reference-types --enable-multivalue \
        /wasm/csp_lang_wasm_bg.wasm -o /wasm/csp_lang_wasm_bg.wasm

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
COPY --from=wasm /wasm packages/lang-wasm/generated
# `pnpm build` would build the checker itself, and this stage has no Rust.
ENV CSP_WASM_PREBUILT=1
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
