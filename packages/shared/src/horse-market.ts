import {
  HORSE_PRICE_AGE_FLOOR,
  HORSE_PRICE_AGE_PER_YEAR,
  HORSE_PRICE_BASE,
  HORSE_PRICE_GLUT,
  HORSE_PRICE_PER_STAT,
  HORSE_PRICE_SCARCITY,
  HORSE_PRICE_STATS_FLOOR,
  HORSE_STAT_AVERAGE,
  NPC_HORSES_KEPT,
  canWork,
  horseAgeInYears,
} from './balance.js'
import { carriagePulledBy } from './carriages.js'
import { forSale, npcCityRefuses } from './city.js'
import { isAt } from './footprint.js'
import { horsesIn, ownsHorse, riderOf } from './horses.js'
import { npcHorsesWanted, npcStorages, standingSwing } from './npc-trade.js'
import {
  HORSE_STAT_NAMES,
  isDown,
  type Building,
  type City,
  type Horse,
  type HorseStats,
  type Resident,
  type WorldState,
} from './world.js'

/*
 * The Horse market (`CONTEXT.md`: Horse market): what an NPC city asks for a horse and whether it
 * sells it. Queries here are the game API that orders, scripts and the UI share (ADR 0002); nothing
 * moves.
 */

/** A horse of an NPC city's that a Player sees in its stable, as the Trade section lists it. */
export interface NpcHorseOffer {
  horseId: string
  stableId: string
  name: string
  stats: HorseStats
  bornAt: number
  /** What the city asks of this Player, in Coins (`npcHorsePrice`). */
  price: number
  /** Why the city won't sell it to this Player, whoever goes there (`npcHorseSaleProblem`). */
  problem?: string
}

/**
 * What a horse is worth for its stats and age (`CONTEXT.md`: Horse market), as a share of
 * `HORSE_PRICE_BASE`: `HORSE_PRICE_PER_STAT` either way for each point its mean stat is from
 * average, and `HORSE_PRICE_AGE_PER_YEAR` less for each game year of age, each with its floor.
 */
export function horseWorth(horse: Pick<Horse, 'stats' | 'bornAt'>, tick: number): number {
  const mean =
    HORSE_STAT_NAMES.reduce((sum, s) => sum + horse.stats[s], 0) / HORSE_STAT_NAMES.length
  const stats = Math.max(
    HORSE_PRICE_STATS_FLOOR,
    1 + HORSE_PRICE_PER_STAT * (mean - HORSE_STAT_AVERAGE),
  )
  const age = Math.max(
    HORSE_PRICE_AGE_FLOOR,
    1 - HORSE_PRICE_AGE_PER_YEAR * horseAgeInYears(horse, tick),
  )
  return stats * age
}

/**
 * How an NPC city's stock of horses moves its price (`CONTEXT.md`: Horse market), as a share: 1 with
 * as many as it wants, up to `HORSE_PRICE_SCARCITY` more as it nears the pair it keeps
 * (`NPC_HORSES_KEPT`), and down to `HORSE_PRICE_GLUT` less with more than it wants.
 */
export function horseStockFactor(has: number, wanted: number): number {
  const short = (wanted - has) / Math.max(1, wanted - NPC_HORSES_KEPT)
  return 1 + HORSE_PRICE_SCARCITY * Math.max(-HORSE_PRICE_GLUT, Math.min(1, short))
}

/** The horses an NPC city has, wherever they stand. */
export function npcHorsesOf<H extends Pick<Horse, 'realmId' | 'cityId'>>(
  world: { horses: readonly H[] },
  city: Pick<City, 'id'>,
): H[] {
  return world.horses.filter((h) => ownsHorse({ cityId: city.id }, h))
}

/**
 * What an NPC city asks for a horse (`CONTEXT.md`: Horse market): `HORSE_PRICE_BASE` by what the
 * horse is worth (`horseWorth`) and its stock (`horseStockFactor`), then moved by its standing toward
 * the trader like its trade prices (`standingSwing`). Whole Coins, at least one.
 */
export function npcHorsePrice(
  world: Pick<WorldState, 'horses' | 'residents' | 'standings' | 'cities' | 'tick'>,
  city: City,
  horse: Pick<Horse, 'stats' | 'bornAt'>,
  traderId: string | null | undefined,
): number {
  const stock = horseStockFactor(npcHorsesOf(world, city).length, npcHorsesWanted(world, city))
  const swing = standingSwing(world, city, traderId)
  const coins = HORSE_PRICE_BASE * horseWorth(horse, world.tick) * stock * (1 - swing)
  return Math.max(1, Math.round(coins))
}

/**
 * Why an NPC city won't sell its horse to a realm, whoever goes there, or undefined when it would
 * (`CONTEXT.md`: Horse market, NPC city reaction): it refuses the realm, the horse pulls a carriage,
 * is ridden or is Down, it has no horse beyond the pair it keeps, or no storage for the Coins.
 */
export function npcHorseSaleProblem(
  world: Pick<
    WorldState,
    'horses' | 'residents' | 'carriages' | 'buildings' | 'standings' | 'cities'
  >,
  city: City,
  horse: Horse,
  realmId: string,
): string | undefined {
  if (npcCityRefuses(world, city, realmId)) return `${city.name} won’t trade with you`
  if (carriagePulledBy(world, horse)) return `${horse.name} is hitched to a carriage`
  if (riderOf(world, horse)) return `someone rides ${horse.name}`
  if (isDown(horse)) return `${horse.name} is Down`
  if (npcHorsesOf(world, city).length <= NPC_HORSES_KEPT)
    return `${city.name} keeps its last ${NPC_HORSES_KEPT} horses to breed`
  if (npcStorages(world, city).length === 0) return `${city.name} has no storage for the Coins`
  return undefined
}

/**
 * Why a resident can't pay for a horse now, or undefined when they can (`CONTEXT.md`: Horse market):
 * they are grown up and hold the Coins in their hands.
 */
export function horseBuyerProblem(
  resident: Pick<Resident, 'bornAt' | 'carried'>,
  price: number,
  tick: number,
): string | undefined {
  if (!canWork(resident, tick)) return 'children can’t trade'
  const coins = Math.floor(resident.carried.coins ?? 0)
  if (coins < price) return `it costs ${price} coins and they hold ${coins}`
  return undefined
}

/**
 * Whom a horse is bought from where a resident stands (`CONTEXT.md`: Horse market): the NPC city
 * whose finished stable covers their tile and has the horse standing in it, the horse being the
 * city's. Undefined when it isn't so.
 */
export function npcHorseAt(
  world: Pick<WorldState, 'horses' | 'buildings' | 'cities'>,
  resident: Pick<Resident, 'x' | 'y'>,
  horse: Horse,
): { city: City; stable: Building } | undefined {
  const stable = world.buildings.find(
    (b) => b.kind === 'stable' && !b.site && isAt(resident, b) && isAt(horse, b),
  )
  const city = stable && world.cities.find((c) => c.id === stable.cityId)
  if (!city || !forSale(city) || !ownsHorse({ cityId: city.id }, horse)) return undefined
  return { city, stable: stable! }
}

/**
 * Why a resident can't buy a horse for the realm `realmId` now, or undefined when they can
 * (`CONTEXT.md`: Horse market): they stand at the finished stable of the NPC city it stands in, and
 * neither the city (`npcHorseSaleProblem`) nor the resident (`horseBuyerProblem`) stands in the way.
 */
export function buyHorseProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  horseId: unknown,
): string | undefined {
  const horse = world.horses.find((h) => h.id === horseId)
  if (!horse) return 'no such horse'
  const at = npcHorseAt(world, resident, horse)
  if (!at) return 'not at the NPC city’s stable with that horse'
  return (
    npcHorseSaleProblem(world, at.city, horse, realmId) ??
    horseBuyerProblem(resident, npcHorsePrice(world, at.city, horse, realmId), world.tick)
  )
}

/**
 * The horses an NPC city would list to a realm, of those standing in its finished stable `stable`
 * (`CONTEXT.md`: Trade section), each with its price and why it won't sell it, if so.
 */
export function npcHorseOffers(
  world: WorldState,
  city: City,
  stable: Building,
  realmId: string,
): NpcHorseOffer[] {
  return horsesIn(world.horses, stable)
    .filter((h) => ownsHorse({ cityId: city.id }, h))
    .map((h) => {
      const problem = npcHorseSaleProblem(world, city, h, realmId)
      return {
        horseId: h.id,
        stableId: stable.id,
        name: h.name,
        stats: h.stats,
        bornAt: h.bornAt,
        price: npcHorsePrice(world, city, h, realmId),
        ...(problem ? { problem } : {}),
      }
    })
}
