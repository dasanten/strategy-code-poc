import type { BuildingKind, KnownNode, WallMaterial } from '@csp/shared-types'
import { FOOTPRINT } from './shared/footprint.js'
import { wrap } from './shared/terrain.js'
import { worldMirror } from './world-mirror.js'

/**
 * The checks that read the world (T122.6, ADR 0045): whether something is allowed and why not,
 * answered by `csp-sim`'s own functions on the rules module's mirror of what the Player sees
 * (`crates/csp-lang-wasm/src/world_rules.rs`), asked by ids and coordinates. So the client's
 * refusal is the server's. Until the mirror has a world, nothing is refused: the server checks
 * the order when it arrives.
 */

/** A refusal, or undefined when it is allowed. */
type Problem = string | undefined

/** Asks the mirror the check `name`; undefined until there is a mirror. */
function ask<T>(name: string, ...args: unknown[]): T | undefined {
  const m = worldMirror()
  return m ? (m.rule<T | null>(name, ...args) ?? undefined) : undefined
}

/** Asks the mirror many checks in one call, each `[name, args]`. */
function askAll<T>(calls: readonly (readonly [string, readonly unknown[]])[]): (T | undefined)[] {
  const m = worldMirror()
  if (!m || calls.length === 0) return calls.map(() => undefined)
  return m.rules<T | null>(calls).map((a) => a ?? undefined)
}

/** The terrain the client knows, as the checks on where buildings go read it. */
export interface KnownGround {
  size: number
  /** The terrain at (x, y), `UNEXPLORED` where unknown. */
  at: (x: number, y: number) => number
  /** The resource node the Player explored at (x, y), if any. */
  nodeAt: (x: number, y: number) => KnownNode | undefined
}

/**
 * The terrain and nodes of the `side` × `side` tiles from (x, y) east and south, as the module
 * reads them: everything a check on a footprint there looks at.
 */
function patch(ground: KnownGround, x: number, y: number, side: number) {
  const tiles: number[] = []
  const nodes: [string, number, number][] = []
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) {
      const tx = wrap(x + dx, ground.size)
      const ty = wrap(y + dy, ground.size)
      tiles.push(ground.at(tx, ty))
      const n = ground.nodeAt(tx, ty)
      if (n) nodes.push([n.kind, n.x, n.y])
    }
  }
  return [{ size: ground.size, x, y, w: side, h: side, tiles }, nodes] as const
}

/** The arguments of `buildProblem` for one kind on (x, y): its footprint and the tiles around. */
function buildArgs(
  kind: BuildingKind,
  x: number,
  y: number,
  material: WallMaterial | undefined,
  ground: KnownGround,
): unknown[] {
  const [terrain, nodes] = patch(ground, x - 1, y - 1, FOOTPRINT[kind] + 2)
  return [kind, x, y, material, terrain, nodes]
}

/**
 * Why a building of `kind` (of `material`, for a wall or gate) can't be laid out with the
 * north-west tile of its footprint on (x, y), as far as the Player knows (`buildProblem`,
 * `CONTEXT.md`: Where buildings go, Wood or stone): the buildings in sight, the terrain and nodes
 * explored. The server checks again when the order arrives.
 */
export function buildProblem(
  kind: BuildingKind,
  x: number,
  y: number,
  ground: KnownGround,
  material?: WallMaterial,
): Problem {
  return ask('buildProblem', ...buildArgs(kind, x, y, material, ground))
}

/** `buildProblem` for each of `kinds` on (x, y), in one call: what a Build menu asks. */
export function buildProblems(
  kinds: readonly { kind: BuildingKind; material?: WallMaterial }[],
  x: number,
  y: number,
  ground: KnownGround,
): Problem[] {
  return askAll(
    kinds.map((k) => ['buildProblem', buildArgs(k.kind, x, y, k.material, ground)] as const),
  )
}

/**
 * Where a node's workplace can be laid out (`nodeCorner`, `CONTEXT.md`: Where buildings go): the
 * north-west tile of a footprint that covers the node and fits, the node's own tile first; none
 * when no footprint over it fits.
 */
export function nodeCorner(
  node: KnownNode,
  workplace: BuildingKind,
  ground: KnownGround,
): { x: number; y: number } | undefined {
  const side = FOOTPRINT[workplace]
  const [terrain, nodes] = patch(ground, node.x - side, node.y - side, 2 * side + 1)
  const corner = ask<[number, number]>('nodeCorner', [node.kind, node.x, node.y], terrain, nodes)
  return corner && { x: corner[0], y: corner[1] }
}

/**
 * Why `thief` can't drive off in another organization's carriage for the realm now
 * (`driveOffProblem`, `CONTEXT.md`: Stealing a carriage or horse), for each of `thieves`.
 */
export function driveOffProblems(
  thieves: readonly string[],
  carriageId: string,
  realmId: string,
): Problem[] {
  return askAll(thieves.map((id) => ['driveOffProblem', [id, carriageId, realmId]] as const))
}

/**
 * Why each of `drivers` can't drive the realm's carriage off with a horse they steal to pull it
 * (`hitchOffProblem`); `named` keeps to that horse.
 */
export function hitchOffProblems(
  drivers: readonly string[],
  carriageId: string,
  realmId: string,
  named?: string,
): Problem[] {
  return askAll(drivers.map((id) => ['hitchOffProblem', [id, carriageId, realmId, named]] as const))
}

/**
 * The horse of another organization `driverId` would steal by driving off in the carriage
 * (`horseToSteal`), if any.
 */
export function horseToSteal(
  driverId: string,
  carriageId: string,
  realmId: string,
  named?: string,
): string | undefined {
  return ask('horseToSteal', driverId, carriageId, realmId, named)
}

/** Why each of `thieves` can't mount another organization's horse and ride it off (`mountOffProblem`). */
export function mountOffProblems(
  thieves: readonly string[],
  horseId: string,
  realmId: string,
): Problem[] {
  return askAll(thieves.map((id) => ['mountOffProblem', [id, horseId, realmId]] as const))
}

/** Why `thiefId` can't row off in another organization's boat (`rowOffProblem`). */
export function rowOffProblem(thiefId: string, vesselId: string, realmId: string): Problem {
  return ask('rowOffProblem', thiefId, vesselId, realmId)
}

/**
 * Why each of `residents` can't board the vessel now, as crew with `asCrew`
 * (`boardVesselProblem`, `CONTEXT.md`: Beside a vessel, Crew).
 */
export function boardVesselProblems(
  residents: readonly string[],
  vesselId: string,
  asCrew = false,
): Problem[] {
  return askAll(residents.map((id) => ['boardVesselProblem', [id, vesselId, asCrew]] as const))
}

/**
 * Why the stable's horses `horseIds` can't be bred by `breederId` for `owner` (`breedProblem`,
 * `CONTEXT.md`: Breeding).
 */
export function breedProblem(
  stableId: string,
  owner: { realmId?: string; cityId?: string },
  breederId: string | undefined,
  horseIds: readonly string[] | undefined,
): Problem {
  return ask('breedProblem', stableId, owner.realmId, owner.cityId, breederId, horseIds)
}

/**
 * The pair the stable keeps breeding progress for that `breederId` carries on with first, the
 * furthest along they can breed (`keptPair`, `CONTEXT.md`: Breeding), if any.
 */
export function keptPair(
  stableId: string,
  owner: { realmId?: string; cityId?: string },
  breederId: string | undefined,
): [string, string] | undefined {
  return ask('keptPair', stableId, owner.realmId, owner.cityId, breederId, undefined)
}

/**
 * Who serves others, as far as the Player knows (`diplomacy`): those handed over to their
 * alliance's army, and the residents of each of their realm's contracts and whether it started.
 */
export interface Serving {
  army: readonly string[]
  contracts: readonly { residentIds: readonly string[]; started: boolean }[]
}

const servingArgs = (s: Serving) =>
  [s.army, s.contracts.map((c) => [c.residentIds, c.started])] as const

/** Why the realm's Leader can't hand the realm over to `targetId` now (`handOverProblem`). */
export function handOverProblem(
  realm: { id: string; leaderId: string },
  targetId: string,
  serving: Serving,
): Problem {
  return ask('handOverProblem', realm.id, realm.leaderId, targetId, ...servingArgs(serving))
}

/** Why `targetId` can't be named the realm's heir (`heirProblem`, `CONTEXT.md`: Heir). */
export function heirProblem(
  realm: { id: string; leaderId: string },
  targetId: string,
  serving: Serving,
): Problem {
  return ask('heirProblem', realm.id, realm.leaderId, targetId, ...servingArgs(serving))
}
