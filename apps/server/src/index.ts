import Fastify from 'fastify'
import { WebSocketServer, WebSocket } from 'ws'
import { TICK_MS, WS_PATH, type ServerMessage } from '@csp/shared'
import { LANGUAGE_VERSION } from '@csp/lang'
import { config } from './config.js'
import { openDb } from './db/index.js'
import { createWorld, loadLatestWorld, saveWorld, stepWorld } from './world.js'

const { db, close: closeDb } = openDb(config.dbPath)
const world = loadLatestWorld(db) ?? createWorld()

const app = Fastify({ logger: true })

app.get('/api/health', async () => ({ ok: true, tick: world.tick, language: LANGUAGE_VERSION }))
app.get('/api/world', async () => world)

const wss = new WebSocketServer({ server: app.server, path: WS_PATH })

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

wss.on('connection', (socket) => send(socket, { type: 'welcome', world }))

const loop = setInterval(() => {
  stepWorld(world)
  const msg: ServerMessage = { type: 'tick', tick: world.tick, units: world.units }
  for (const client of wss.clients) send(client, msg)
  if (world.tick % config.snapshotEveryTicks === 0) saveWorld(db, world)
}, TICK_MS)

async function shutdown() {
  clearInterval(loop)
  saveWorld(db, world)
  for (const client of wss.clients) client.close()
  wss.close()
  await app.close()
  closeDb()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

await app.listen({ port: config.port, host: config.host })
app.log.info(`world at tick ${world.tick}, ticking every ${TICK_MS} ms`)
