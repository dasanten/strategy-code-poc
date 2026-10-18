import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One `.env` at the repo root serves server and client; real env vars win over it.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH ?? path.resolve('data/world.db'),
  /** A world save is written every this many ticks, and on shutdown (ADR 0006). */
  saveEveryTicks: 30,
  /** Where SQLite backups go (ADR 0007). Unset means no backups, the default in dev. */
  backupDir: process.env.BACKUP_DIR || undefined,
  /** The built client, served by the server in production. Unset in dev, where Vite serves it. */
  webDist: process.env.WEB_DIST || undefined,
  /** Session cookies only over HTTPS. On in production, where Caddy terminates TLS. */
  secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : isProduction,
  /** Trust X-Forwarded-For from the reverse proxy, so rate limits see the real client IP. */
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === 'true' : isProduction,
  environment: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Pretty logs for a human at a terminal; JSON lines in production. */
  prettyLogs: !isProduction,
  /** Unset means Sentry reporting is off and only logs are written. */
  sentryDsn: process.env.SENTRY_DSN || undefined,
  /** Share of ticks whose invariants are checked: every tick in dev, sampled in prod. */
  invariantSampleRate: Number(process.env.INVARIANT_SAMPLE_RATE ?? (isProduction ? 0.1 : 1)),
  /** A tick slower than this is reported as a warning (the budget is TICK_MS). */
  slowTickMs: 800,
}
