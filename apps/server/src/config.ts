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
  /** A world snapshot is written every this many ticks, and on shutdown. */
  snapshotEveryTicks: 10,
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
