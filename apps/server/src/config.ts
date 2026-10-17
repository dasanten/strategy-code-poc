import path from 'node:path'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH ?? path.resolve('data/world.db'),
  /** A world snapshot is written every this many ticks, and on shutdown. */
  snapshotEveryTicks: 10,
}
