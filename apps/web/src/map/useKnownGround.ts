import { useCallback, useState } from 'react'
import { roadTiles } from '../building/building.js'
import type { Building, BuildingKind, KnownNode, WallMaterial } from '@csp/shared-types'
import { UNEXPLORED } from '@csp/shared-types'
import { buildProblem, type KnownGround } from '../world/world-rules.js'
import { Terrain, tileIndex } from '../world/terrain.js'
import { isWallOrGate } from '../building/walls.js'
import { arrivalOf } from '../residents/doing-view.js'
import { kindProblemOn } from '../building/build-menu-view.js'
import { useWorld } from '../world/useWorld.js'

/**
 * The ground as the Player knows it (`CONTEXT.md`: Explored): the terrain and nodes the map
 * loaded, and the checks on them that cards, picks and who-lists share (where a building goes,
 * the way a resident walks, when they arrive).
 */
export function useKnownGround(
  world: ReturnType<typeof useWorld>['world'],
  knownBuildings: readonly Building[],
) {
  /**
   * Why a kind can't be laid out on a tile, as far as the Player knows (`buildHereProblem`); a
   * stone wall or gate may go on the wooden one of its kind (`CONTEXT.md`: Wood or stone).
   */
  const buildProblemAt =
    (w: NonNullable<typeof world>, x: number, y: number) =>
    (kind: BuildingKind, material?: WallMaterial) =>
      buildProblem(kind, x, y, knownGround(w), material)
  /** The terrain and nodes the Player explored, as the checks on where buildings go read them. */
  const knownGround = (w: NonNullable<typeof world>): KnownGround => ({
    size: w.map.size,
    // Terrain not loaded counts as unexplored: nothing is laid out there.
    at: (tx, ty) => terrainAt?.(tx, ty) ?? UNEXPLORED,
    nodeAt: (nx, ny) => nodeAt?.(nx, ny),
  })
  /**
   * Why a kind picked before its tile can't go on the tile (`CONTEXT.md`: Realm order), as the
   * Build menu there would say it: the placement rule, a node's workplace off its node.
   */
  const realmBuildProblem = (
    w: NonNullable<typeof world>,
    x: number,
    y: number,
    kind: BuildingKind,
    material?: WallMaterial,
  ) => kindProblemOn(kind, nodeAt?.(x, y), (k) => buildProblemAt(w, x, y)(k, material))
  const [nodeAt, setNodeAt] = useState<(x: number, y: number) => KnownNode | undefined>()
  const onNodesLoaded = useCallback(
    (lookup: (x: number, y: number) => KnownNode | undefined) => setNodeAt(() => lookup),
    [],
  )
  const [terrainAt, setTerrainAt] = useState<(x: number, y: number) => number | undefined>()
  const onTerrainLoaded = useCallback(
    (lookup: (x: number, y: number) => number | undefined) => setTerrainAt(() => lookup),
    [],
  )
  const arrivesIn =
    world && arrivalOf({ size: world.map.size, buildings: world.buildings }, terrainAt)
  /**
   * The ground a way is found on as the Player knows it, and the tiles it can't step onto: a way
   * doesn't cross a wall, nor a gate unless it is the realm's own or an ally's, or open
   * (`CONTEXT.md`: Wall, Gate); climbing onto the realm's own walls is left out.
   */
  const wayGround = (w: NonNullable<typeof world>) => {
    const size = w.map.size
    const roads = roadTiles(w, size)
    const allies = new Set(w.diplomacy.alliance?.members.map((m) => m.realmId))
    allies.add(w.home.realmId)
    const walls = new Set(
      knownBuildings
        .filter((b) => isWallOrGate(b))
        .filter((b) => {
          const realmId = w.cities.find((c) => c.id === b.cityId)?.realmId
          return b.kind === 'wall' || (b.closed && !(realmId && allies.has(realmId)))
        })
        .map((b) => tileIndex(size, b.x, b.y)),
    )
    return {
      blocked: (x: number, y: number) => walls.has(tileIndex(size, x, y)),
      ground: (x: number, y: number): Terrain | undefined => {
        if (roads.has(tileIndex(size, x, y))) return Terrain.Road
        const t = terrainAt?.(x, y)
        return t === undefined || t === UNEXPLORED ? undefined : (t as Terrain)
      },
    }
  }
  return {
    nodeAt,
    onNodesLoaded,
    terrainAt,
    onTerrainLoaded,
    arrivesIn,
    buildProblemAt,
    knownGround,
    realmBuildProblem,
    wayGround,
  }
}
