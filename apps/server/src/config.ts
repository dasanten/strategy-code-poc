import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One `.env` at the repo root serves server and client; real env vars win over it.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const isProduction = process.env.NODE_ENV === 'production'
/** Where Vite serves the client in development (`apps/web/vite.config.ts`). */
const DEV_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'

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
  /**
   * Which browsers may open the WebSocket (`deploy/.env.example`): the request's own host always
   * may, which is the game's domain as Caddy forwards it in production, or the server itself in
   * development; `ALLOWED_ORIGINS` lists any others, comma-separated. Unset in development it is
   * the Vite dev origin. A socket without an Origin (not a browser) is let in only outside
   * production.
   */
  origins: {
    allowed: (process.env.ALLOWED_ORIGINS ?? (isProduction ? '' : DEV_ORIGINS))
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    allowMissing: !isProduction,
  },
  /** What one WebSocket client may do, so no client can swamp the server (`realtime.ts`). */
  realtime: {
    /**
     * The largest frame a client may send, in bytes. The largest message the client has is a
     * queue of `QUEUE_MAX_STEPS` steps of `QUEUE_STEP_MAX_CHARS` each, about 20 KB; a script
     * save goes over HTTP. A larger frame closes the socket.
     */
    maxPayloadBytes: 64 * 1024,
    /**
     * Messages a socket may send at once, and how many a second it earns back (a token bucket).
     * A Player clicks a few orders a second at most; past it the socket is closed with
     * `WS_CLOSE_TOO_MANY_REQUESTS`.
     */
    messageBurst: 20,
    messagesPerSecond: 10,
    /** The most sockets one account may hold open at once (its tabs); the next is refused. */
    connectionsPerUser: 8,
    /** The most orders a realm may have waiting for the next tick; the next is rejected. */
    pendingOrdersPerRealm: 100,
  },
}
