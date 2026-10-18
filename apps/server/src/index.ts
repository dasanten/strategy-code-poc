import { TICK_MS } from '@csp/shared'
import { deleteExpiredSessions } from './auth.js'
import { buildApp } from './app.js'
import { backupDb } from './backup.js'
import { config } from './config.js'
import { logger } from './log.js'
import {
  createTickReporter,
  flushSentry,
  initSentry,
  setupFastifyErrorHandler,
  tagWorld,
} from './monitoring.js'
import { openDb } from './db/index.js'
import { OrderQueue, orderKinds } from './orders.js'
import { ExploredTerrain } from './explored.js'
import { attachRealtime } from './realtime.js'
import { SightTracker } from './sight.js'
import { Walking } from './walking.js'
import { loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { generateTerrain } from './terrain-gen.js'
import { runTick } from './tick.js'

const sentryOn = initSentry({ dsn: config.sentryDsn, environment: config.environment })

const backupDir = config.backupDir
// Back up before migrations run, so a bad migration can be undone (ADR 0007).
const {
  db,
  sqlite,
  close: closeDb,
} = await openDb(config.dbPath, {
  beforeMigrate: backupDir
    ? async (s) => logger.info({ file: await backupDb(s, backupDir, 'start') }, 'backup written')
    : undefined,
})
const { world, terrain } = loadOrCreateWorld(db, (seed) => generateTerrain(seed))
const explored = ExploredTerrain.load(db, terrain, world.nodes)
tagWorld(world)

const app = await buildApp({
  db,
  explored,
  logger,
  secureCookies: config.secureCookies,
  trustProxy: config.trustProxy,
  webDist: config.webDist,
  tick: () => world.tick,
})
if (sentryOn) setupFastifyErrorHandler(app)

const orders = new OrderQueue(orderKinds, terrain)
const sight = new SightTracker()
const walking = new Walking(terrain)
const realtime = attachRealtime(app.server, { db, world, terrain, explored, sight, orders })

const reporter = createTickReporter(logger)
const loop = setInterval(() => {
  runTick(world, terrain, {
    reporter,
    orders,
    walking,
    invariantSampleRate: config.invariantSampleRate,
    slowTickMs: config.slowTickMs,
  })
  tagWorld(world)
  realtime.broadcastTick(sight.update(world, explored))
  if (world.tick % config.saveEveryTicks === 0) {
    saveWorld(db, world)
    explored.save(db)
    pruneSaves(db)
  }
}, TICK_MS)

const DAY_MS = 24 * 60 * 60 * 1000
const daily = setInterval(() => {
  deleteExpiredSessions(db)
  if (backupDir) {
    backupDb(sqlite, backupDir, 'daily')
      .then((file) => logger.info({ file }, 'backup written'))
      .catch((err: unknown) => logger.error({ err }, 'backup failed'))
  }
}, DAY_MS)

async function shutdown() {
  clearInterval(loop)
  clearInterval(daily)
  saveWorld(db, world)
  explored.save(db)
  realtime.close()
  await app.close()
  closeDb()
  await flushSentry()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

await app.listen({ port: config.port, host: config.host })
logger.info(
  { tick: world.tick, seed: world.seed, sentry: sentryOn },
  `world at tick ${world.tick}, ticking every ${TICK_MS} ms`,
)
