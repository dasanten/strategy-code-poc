# Code Strategy PoC

A persistent, real-time strategy world. Players run their realm through UI orders and, later,
scripts in our own small language (ADR 0002). The server runs the world at 1 tick per second.

Design decisions live in `docs/adr/`; the domain glossary is `CONTEXT.md`.

## Layout

| Path              | What it is                                                                   |
| ----------------- | ---------------------------------------------------------------------------- |
| `packages/lang`   | The script language: lexer, parser, interpreter (public surface only so far) |
| `packages/shared` | World types and the WebSocket protocol, shared by server and client          |
| `apps/server`     | Fastify HTTP API, `ws` tick stream, the simulation loop, SQLite via Drizzle  |
| `apps/web`        | Vite + React client: PixiJS tile map and a CodeMirror script editor          |

## Getting started

Needs Node 22.12+ (Vite 8 needs it) and pnpm 10. The exact Node version is pinned in
`.node-version` and pnpm in `package.json` (`packageManager`). With fnm and corepack:

```sh
fnm use            # picks up .node-version (fnm install first if it's missing)
corepack enable    # makes `pnpm` the pinned 10.x
```

An older Node makes `pnpm install` stop with an error. No native build tools are needed:
better-sqlite3 ships prebuilt binaries. Copy `.env.example` to `.env` for local settings.

```sh
pnpm install
pnpm dev        # server on :3000, client on http://localhost:5173 (proxies /api and /ws)
```

Signing up needs an invite code (ADR 0005). Create yourself an admin and a code:

```sh
pnpm --filter @csp/server admin:create Daniel   # asks for a password (or set ADMIN_PASSWORD)
pnpm --filter @csp/server admin:invite          # prints an invite code
```

Admins can also create invite codes and reset passwords in the client.

Other scripts:

```sh
pnpm build      # type-check and compile all packages, bundle the client
pnpm start      # run the compiled server
pnpm test       # Vitest
pnpm lint       # ESLint
pnpm format     # Prettier
```

The server stores everything in `data/world.db` (override with `DB_PATH`). The world lives in
memory and is saved as a gzipped snapshot every 30 ticks and on shutdown; old saves are pruned
(ADR 0006).

- **Table changes:** edit `apps/server/src/db/schema.ts`, then run
  `pnpm --filter @csp/server db:generate` to add a migration; migrations run on startup.
- **World state changes:** the world is never reset. Changing the shape of `WorldState` bumps
  `WORLD_FORMAT_VERSION` in `apps/server/src/world-format.ts` and adds a migration step with a
  test.

## Monitoring

See ADR 0004. The server logs JSON lines with pino (pretty-printed outside production; level via
`LOG_LEVEL`). Set `SENTRY_DSN` (server) and `VITE_SENTRY_DSN` (client) to report to Sentry;
without them reporting is off. Each tick runs the invariant checks in `apps/server/src/invariants.ts`
(every tick in dev, 10% of ticks in production, `INVARIANT_SAMPLE_RATE` overrides) and reports tick
duration and unit and action counts; a tick above 800 ms is logged and sent to Sentry as a warning.
CI on GitHub Actions runs lint, typecheck and test on every push.

## How packages resolve each other

Workspace packages export a `source` condition pointing at `src/index.ts`. Vite, Vitest and
`tsx` use it, so dev needs no build step. `tsc -b` builds `dist/` for `pnpm start`.

## Deploy

Every push to `main` that passes CI builds an image, pushes it to GHCR and deploys it over SSH
to Daniel's server, where Caddy serves it over HTTPS (ADR 0007). One-time setup:

1. On the server: Docker with the compose plugin, ports 80 and 443 open, a DNS record for the
   domain, and a deploy user in the `docker` group with an SSH key for GitHub.
2. In the deploy directory (`~/strategy-code-poc` by default): a `.env` copied from
   `deploy/.env.example`.
3. In GitHub: repository secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (the private key)
   and `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan <host>`); repository variable
   `DEPLOY_ENABLED=true`, optionally `DEPLOY_DIR` and `VITE_SENTRY_DSN`. Until
   `DEPLOY_ENABLED` is set, CI only builds the image.
4. After the first deploy, in the deploy directory:
   `docker compose exec server node dist/cli/admin.js create <name>` for the admin and
   `docker compose exec server node dist/cli/admin.js invite` for invite codes.

Backups go to the `world-backups` volume before every start and daily, 14 days kept. To roll
back, deploy the previous image tag (`IMAGE_TAG=<tag> docker compose up -d`) and, if a migration
already ran, stop the server and copy the `-start` backup over `/data/world.db`.

Before scripts see exactly their script views (ADR 0011), list the fields Players' active scripts
read that the views don't declare, with each script and Player. It only reads, so it is safe while
the server runs; the image must be one with the command (Epic 24 released):

```sh
docker compose exec server node dist/cli/check-fields.js
```

Locally: `pnpm --filter @csp/server check:fields` (reads `DB_PATH`, `data/world.db` by default).
It finds reads from values the checker is sure of (`me`, a query's result, a `for … of` over one,
a `let` holding one); a read through `memory` or a function's parameters isn't found.

## Status

- Accounts, the tick loop, persistence, per-Player sync and deploy work end to end.
- Units move randomly as a stand-in until the interpreter exists.
- `checkScript` in `packages/lang` is a stub; the parser and interpreter are next.
