import { gunzipSync, gzipSync } from 'node:zlib'
import { desc, sql } from 'drizzle-orm'
import type { TerrainMap, WorldState } from '@csp/shared'
import { schema, type Db } from './db/index.js'
import { loadTerrain, terrainForWorld } from './terrain.js'
import { RESET_BEFORE, WORLD_FORMAT_VERSION, migrateWorld } from './world-format.js'
import { generateWorld } from './world.js'

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

/** The newest save as written, in whatever format it was written in. */
function latestSave(db: Db): { state: unknown; version: number } | undefined {
  const row = db.select().from(schema.worldSaves).orderBy(desc(schema.worldSaves.id)).limit(1).get()
  if (!row) return undefined
  return { state: JSON.parse(gunzipSync(row.data).toString('utf8')), version: row.version }
}

/**
 * The world and its terrain, as the server starts with them: the newest save migrated to the
 * current format, or a freshly generated world (`generateWorld`). Terrain is loaded, or generated from the world's seed and
 * stored the first time (ADR 0006).
 */
export function loadOrCreateWorld(
  db: Db,
  generate: (seed: number) => TerrainMap,
  newSeed = 1,
): { world: WorldState; terrain: TerrainMap } {
  let save = latestSave(db)
  if (save && save.version < RESET_BEFORE) {
    // The one reset (ADR 0006): a world from the disc-shaped map is thrown away with its
    // terrain and explored terrain. Accounts, sessions, invite codes and scripts stay.
    resetWorld(db)
    save = undefined
  }
  // Every save format so far carries the seed at the top level.
  const seed = save ? (save.state as { seed: number }).seed : (loadTerrain(db)?.seed ?? newSeed)
  const terrain = terrainForWorld(db, seed, generate)
  const world = save
    ? migrateWorld(save.state, save.version, { terrain })
    : generateWorld(terrain, seed)
  return { world, terrain }
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

/** Deletes the world, its terrain and every Player's explored terrain; nothing else. */
export function resetWorld(db: Db): void {
  db.transaction((tx) => {
    tx.delete(schema.worldSaves).run()
    tx.delete(schema.terrain).run()
    tx.delete(schema.explored).run()
  })
}
