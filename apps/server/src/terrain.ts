import type { TerrainMap } from '@csp/shared'
import { schema, type Db } from './db/index.js'

/** The terrain stored for this world and the seed it came from; undefined before it is created. */
export function loadTerrain(db: Db): { seed: number; map: TerrainMap } | undefined {
  const row = db.select().from(schema.terrain).get()
  if (!row) return undefined
  return { seed: row.seed, map: { diameter: row.diameter, tiles: new Uint8Array(row.data) } }
}

/** Stores the world's terrain. Happens once, when the world is created (ADR 0006). */
export function saveTerrain(db: Db, seed: number, map: TerrainMap): void {
  db.insert(schema.terrain)
    .values({ id: 1, seed, diameter: map.diameter, data: Buffer.from(map.tiles) })
    .run()
}

/**
 * The world's terrain: loaded if stored, otherwise generated from `seed` and stored. A stored
 * terrain from another seed means the database and the saves don't belong together.
 */
export function terrainForWorld(
  db: Db,
  seed: number,
  generate: (seed: number) => TerrainMap,
): TerrainMap {
  const stored = loadTerrain(db)
  if (stored) {
    if (stored.seed !== seed) {
      throw new Error(`stored terrain is from seed ${stored.seed}, the world is seed ${seed}`)
    }
    return stored.map
  }
  const map = generate(seed)
  saveTerrain(db, seed, map)
  return map
}
