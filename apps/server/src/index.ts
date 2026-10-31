import { eq } from 'drizzle-orm'
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
import { openDb, schema } from './db/index.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { ExploredTerrain } from './explored.js'
import { attachRealtime } from './realtime.js'
import { SightTracker } from './sight.js'
import { Walking } from './walking.js'
import { setScriptParamOrder } from './script-params.js'
import { loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import {
  ScriptRunner,
  armyRunScriptOrder,
  runScriptOrder,
  taskOrder,
  type ScriptHost,
} from './script-runner.js'
import {
  checkScriptLibrary,
  defaultScriptId,
  runnableScript,
  syncDefaultScripts,
} from './scripts.js'
import { noteScriptViewChanges } from './field-check.js'
import { generateTerrain } from './terrain-gen.js'
import { TerritoryTracker } from './territory.js'
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
const territory = new TerritoryTracker()

const app = await buildApp({
  db,
  explored,
  logger,
  secureCookies: config.secureCookies,
  trustProxy: config.trustProxy,
  webDist: config.webDist,
  tick: () => world.tick,
  world,
  terrain,
  territory,
  // Attached below, once the app has its server; logout and resets only run after that.
  sockets: {
    disconnectSession: (tokenHash) => realtime.disconnectSession(tokenHash),
    disconnectUser: (userId) => realtime.disconnectUser(userId),
  },
})
if (sentryOn) setupFastifyErrorHandler(app)

const reporter = createTickReporter(logger)
const scriptHost: ScriptHost = {
  script: (id) => runnableScript(db, id),
  sender: (userId) => {
    const user = db
      .select({ name: schema.users.name, isAdmin: schema.users.isAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get()
    return user && { userId, account: user }
  },
  explored: (userId, x, y) => explored.isExplored({ id: userId }, x, y),
  defaultScript: (userId, task) => defaultScriptId(db, userId, task),
  scriptError: (world, error, where) => reporter.scriptError(world, error, where),
}
const kinds = {
  ...orderKinds,
  runScript: runScriptOrder(scriptHost),
  armyRunScript: armyRunScriptOrder(scriptHost),
  setScriptParam: setScriptParamOrder(scriptHost),
  task: taskOrder({
    defaultScript: (userId, task) => defaultScriptId(db, userId, task),
    script: (id) => runnableScript(db, id),
  }),
}
const orders = new OrderQueue(kinds, terrain)
const queues = new QueueRunner(scriptHost, kinds, terrain)
const scripts = new ScriptRunner(terrain, scriptHost)
const sight = new SightTracker()
const walking = new Walking(terrain)
// Players who haven't edited a default script run the game's current default from now on.
syncDefaultScripts(db)
// Players whose scripts read a field a script view dropped since the last start are told so.
if (noteScriptViewChanges(db, world)) saveWorld(db, world)
// The script library lives in the database, so its invariant is checked at start and daily.
reporter.invariantViolations(world, checkScriptLibrary(db))
const realtime = attachRealtime(app.server, {
  db,
  world,
  terrain,
  explored,
  sight,
  orders,
  territory,
  sightCheck: { reporter, sampleRate: config.invariantSampleRate },
  logger,
})

const loop = setInterval(() => {
  runTick(world, terrain, {
    reporter,
    orders,
    queues,
    scripts,
    walking,
    invariantSampleRate: config.invariantSampleRate,
    slowTickMs: config.slowTickMs,
  })
  tagWorld(world)
  territory.update(world, terrain)
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
  reporter.invariantViolations(world, checkScriptLibrary(db))
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
