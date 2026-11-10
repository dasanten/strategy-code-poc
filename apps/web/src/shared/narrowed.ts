// The balance numbers (`@csp/balance`, written by Rust) that the TypeScript source declared with a
// narrower type than JSON gives them, cast to it (T88.2, ADR 0030).

import * as B from '@csp/balance'
import { NpcCitySize, Recipe } from './stats.js'
import type { BuildingKind, Good, HorseStats, SkillName, Stock, Weapon } from '@csp/shared-types'

/** An average horse's stats: the middle of the range, what horses from before stats got. */
export const AVERAGE_HORSE_STATS = B.AVERAGE_HORSE_STATS as unknown as Readonly<HorseStats>

/**
 * Batches one worker of average Strength and no skill gets through per game day: a smelter worker
 * smelts what two miners dig (4 iron ore into 2 iron), a mint worker strikes what two gold miners
 * dig (2 gold ore into 20 coins), a smithy worker makes two weapons or pieces of armour.
 */
export const BATCHES_PER_DAY = B.BATCHES_PER_DAY as unknown as Partial<Record<BuildingKind, number>>

/**
 * Materials each kind of building needs before its construction site can become the building
 * (`CONTEXT.md`: Construction site). A lumber camp needs none, so a realm can start from nothing:
 * the lumber camp's wood builds the quarry, wood and stone build the mine and the smelter, and
 * the smelter's iron goes into the mint and the smithy.
 */
export const BUILD_MATERIALS = B.BUILD_MATERIALS as unknown as Partial<Record<BuildingKind, Stock>>

/**
 * Work each kind of building needs, in ticks of one unskilled resident of average Strength: a
 * lumber camp takes one such resident 2 game days, a quarry 3, a mine 4, a stable 3, a smelter 4,
 * a mint 5, a smithy 5, a town hall 6, a training ground 3 (about a stable). A tile of wooden
 * wall takes a sixteenth of a game day, a gate an eighth, a tile of road a sixteenth (a quarter of
 * what a 40 m tile took), a house one game day, a storage two and a farm half of one; a carriage
 * two. More or stronger workers finish it sooner (`buildWork`).
 */
export const BUILD_WORK = B.BUILD_WORK as unknown as Partial<Record<BuildingKind, number>>

/** The goods a child may pick up, put down, Fetch and Store: their meals (`CONTEXT.md`: Child). */
export const CHILD_GOODS = B.CHILD_GOODS as unknown as readonly Good[]

/**
 * What an NPC city asks for each of its finished buildings when it is bought, in Coins, by kind;
 * a kind missing here adds nothing. A village (6 residents, a town hall, a storage, 2 houses, a
 * farm and its wall ring) comes to about 2 800 coins, which three residents can carry; a town to
 * about 7 000. A stretch of wall is a quarter of what it was on the old 40 m tiles.
 */
export const CITY_PRICE_BY_BUILDING = B.CITY_PRICE_BY_BUILDING as unknown as Partial<
  Record<BuildingKind, number>
>

/**
 * What one unit of each good weighs, in kg (`CONTEXT.md`: Good). Coins are light but not
 * weightless, so a fortune still has to be carried. Weapons and armour weigh what went into them
 * (`RECIPES`): an average resident (30 kg) in armour with a sword and a shield has half
 * their room left for food.
 */
export const GOOD_WEIGHT = B.GOOD_WEIGHT as unknown as Record<Good, number>

/**
 * Residents each kind of building houses (`CONTEXT.md`: House, Free housing). Only houses so far;
 * later housing buildings (a palace, a castle) add their room here.
 */
export const HOUSING_ROOM = B.HOUSING_ROOM as unknown as Partial<Record<BuildingKind, number>>

/** A village: a starting city's square, a few fewer residents, one farm. */
export const NPC_VILLAGE = B.NPC_VILLAGE as unknown as NpcCitySize

/**
 * The fixed recipes of the workplaces that process goods (`CONTEXT.md`: Smelter, Coins, Smithy).
 * A smelter turns 2 iron ore into 1 iron, a mint 1 gold ore into 10 coins (less weight than the
 * ore, but a fortune still weighs something). A smithy has one recipe for each weapon and piece
 * of armour, each from Iron and Wood weighing what the good weighs (`GOOD_WEIGHT`): a spear is
 * mostly wood, a sword mostly iron, a shield wood bound with iron, armour nearly all iron.
 */
export const RECIPES = B.RECIPES as unknown as Partial<Record<BuildingKind, readonly Recipe[]>>

/**
 * The most of each skill a resident can have (`CONTEXT.md`: Skill): where it stops making them
 * better. Training never takes a skill past it.
 */
export const SKILL_MAX = B.SKILL_MAX as unknown as Readonly<Record<SkillName, number>>

/**
 * Each skill learned by doing, in points per game day for a learner of average Intellect. Combat
 * is learned by blows rather than days; for training it counts as reaching its maximum in a game
 * year, as the work skills do.
 */
export const SKILL_PER_DAY = B.SKILL_PER_DAY as unknown as Readonly<Record<SkillName, number>>

/**
 * Damage a wall or gate takes from blows before it falls (`CONTEXT.md`: Walls in combat,
 * broken). An average unarmed resident (4 a blow, one blow every `STRIKE_TICKS`) breaks a stretch
 * of wall alone in about five minutes; ten soldiers with swords in well under one. A gate holds
 * out half as long again.
 */
export const WALL_STRENGTH = B.WALL_STRENGTH as unknown as Record<'wall' | 'gate', number>

/**
 * What a warehouse sells a unit of each good for, in coins, when it holds `PRICE_REFERENCE_FLOORS`
 * times its floor (`CONTEXT.md`: Warehouse prices, Price anchor). Roughly what goes into it: an
 * iron is two iron ore and the work, a sword two iron and a wood; gold ore stays below the 10
 * coins the mint strikes from it.
 */
export const WAREHOUSE_BASE_PRICE = B.WAREHOUSE_BASE_PRICE as unknown as Record<
  Exclude<Good, 'coins'>,
  number
>

/**
 * A trading post's stock floor (`CONTEXT.md`: Stock floor, ADR 0023), in units: what its spare
 * hands, caravan and wandering traders go for, and what its prices are reckoned from. It tops up
 * nothing at a post; the HQ's warehouses top up to `HQ_FLOOR_FACTOR` times this each game day. Half
 * of what a post starts with, so a fresh post is well above it.
 */
export const WAREHOUSE_FLOOR = B.WAREHOUSE_FLOOR as unknown as Record<Good, number>

/**
 * Attack each weapon adds to a resident's blow (`CONTEXT.md`: Weapons and armour, Combat). A
 * sword hits harder than a spear; combat (T10.2) adds it to Strength and Combat skill.
 */
export const WEAPON_ATTACK = B.WEAPON_ATTACK as unknown as Record<Weapon, number>

/**
 * Most residents who can work each kind of workplace at a time (`CONTEXT.md`: Workplace). A farm
 * has room for a whole starting city; the workplaces on nodes for a smaller crew; smelters,
 * mints and smithies for a few.
 */
export const WORKPLACE_MAX_WORKERS = B.WORKPLACE_MAX_WORKERS as unknown as Partial<
  Record<BuildingKind, number>
>

/**
 * The skill each kind of workplace uses and teaches (`CONTEXT.md`: Skill): Farming on a farm,
 * Woodcutting in a lumber camp, Mining in quarries and mines, Smelting in smelters and mints,
 * Smithing in a smithy.
 */
export const WORKPLACE_SKILL = B.WORKPLACE_SKILL as unknown as Partial<
  Record<BuildingKind, SkillName>
>

/**
 * Units of each good one worker of average Strength and no skill makes per game day. Food is four
 * times the `FOOD_PER_DAY` a resident eats, so about a quarter of a city farms; ore is slow, and
 * gold ore slowest.
 */
export const WORK_OUTPUT_PER_DAY = B.WORK_OUTPUT_PER_DAY as unknown as Partial<Record<Good, number>>
