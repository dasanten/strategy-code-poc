# Code Strategy PoC

A persistent, real-time strategy world where players control their units with scripts written
in our own small language. The server runs every unit's script once per tick (1 tick per second)
with a step budget, then resolves all requested actions together.

Design decisions live in `docs/adr/`; the domain glossary is `CONTEXT.md`.

## Layout

| Path              | What it is                                                                   |
| ----------------- | ---------------------------------------------------------------------------- |
| `packages/lang`   | The script language: lexer, parser, interpreter (public surface only so far) |
| `packages/shared` | World types and the WebSocket protocol, shared by server and client          |
| `apps/server`     | Fastify HTTP API, `ws` tick stream, the simulation loop, SQLite via Drizzle  |
| `apps/web`        | Vite + React client: PixiJS tile map and a CodeMirror script editor          |

## Getting started

Needs Node 22.12+ (Vite 8 needs it) and pnpm 10. Copy `.env.example` to `.env` for local settings.

```sh
pnpm install
pnpm dev        # server on :3000, client on http://localhost:5173 (proxies /api and /ws)
```

Other scripts:

```sh
pnpm build      # type-check and compile all packages, bundle the client
pnpm start      # run the compiled server
pnpm test       # Vitest
pnpm lint       # ESLint
pnpm format     # Prettier
```

The server stores the world in `data/world.db` (override with `DB_PATH`). It writes a snapshot
every 10 ticks and on shutdown, and resumes from the latest one on start. After changing
`apps/server/src/db/schema.ts`, run `pnpm --filter @csp/server db:generate` to add a migration;
migrations run on startup.

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

## Status

- The tick loop, persistence and live map work end to end.
- Units move randomly as a stand-in until the interpreter exists.
- `checkScript` in `packages/lang` is a stub; the parser and interpreter are next.
