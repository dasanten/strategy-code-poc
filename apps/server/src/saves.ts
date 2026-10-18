import { gunzipSync, gzipSync } from 'node:zlib'
import { desc, sql } from 'drizzle-orm'
import type { WorldState } from '@csp/shared'
import { schema, type Db } from './db/index.js'
import { WORLD_FORMAT_VERSION, migrateWorld } from './world-format.js'

/** How many of the newest saves are always kept. */
export const KEEP_LATEST = 20
/** Beyond those, one save per game day (one real hour) is kept for this long. */
export const KEEP_HOURLY_FOR_S = 7 * 24 * 60 * 60

export function saveWorld(db: Db, world: WorldState): void {
  const data = gzipSync(JSON.stringify(world))
  db.insert(schema.worldSaves)
    .values({ tick: world.tick, version: WORLD_FORMAT_VERSION, data })
    .run()
}

/** The newest save, migrated to the current world format; undefined for a new world. */
export function loadLatestWorld(db: Db): WorldState | undefined {
  const row = db.select().from(schema.worldSaves).orderBy(desc(schema.worldSaves.id)).limit(1).get()
  if (!row) return undefined
  const state: unknown = JSON.parse(gunzipSync(row.data).toString('utf8'))
  return migrateWorld(state, row.version)
}

/**
 * Deletes old saves (ADR 0006): keeps the newest KEEP_LATEST, plus the newest save of every
 * hour for the last week.
 */
export function pruneSaves(db: Db, nowS = Math.floor(Date.now() / 1000)): void {
  db.run(sql`
    DELETE FROM world_saves
    WHERE id NOT IN (SELECT id FROM world_saves ORDER BY id DESC LIMIT ${KEEP_LATEST})
      AND id NOT IN (
        SELECT max(id) FROM world_saves
        WHERE created_at > ${nowS - KEEP_HOURLY_FOR_S}
        GROUP BY created_at / 3600
      )
  `)
}
