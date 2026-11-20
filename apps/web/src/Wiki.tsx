import { useEffect, type ReactNode } from 'react'
import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_STEPS,
  QUEUE_MAX_DEPTH,
  QUEUE_MAX_REPEAT,
  ADULT_AGE,
  AGILITY_LIMIT,
  AGILITY_SPEED_EFFECT,
  AGILITY_TERRAIN_EFFECT,
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_RECALL_DELAY,
  BLOW_BASE,
  BLOW_PER_STRENGTH,
  BROKEN_MATERIALS_RETURNED,
  BUILD_MATERIALS,
  BUY_SHARE,
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_GUARD_RANGE,
  CARAVAN_ROBBERIES_PER_ESCORT,
  TRADERS,
  TRADER_ESCORTS,
  TRADER_FLOOR_SHARE,
  TRADER_STOP_REACH,
  TRADER_STOP_TICKS,
  CARRIAGE_CAPACITY,
  BOAT_CAPACITY,
  SHIP_CAPACITY,
  SHIP_MIN_CREW,
  SAIL_SPEED,
  DIRECT_OFFERS_TO_ONE_REALM,
  DIRECT_OFFER_DAYS,
  PASSENGER_WEIGHT,
  CARRIAGE_MAX_CAPACITY,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CARRYING_DAYS,
  PAIRING_WAIT_DAYS,
  DRIFTER_REALM_CAP,
  DRIFTER_WAIT_DAYS,
  DRIFTER_DISTANCE_MIN,
  DRIFTER_DISTANCE_MAX,
  DRIFTER_FOOD,
  CHILD_STAT_SPREAD,
  CHILD_YEAR_DAYS,
  CITY_AREA_MARGIN,
  CITY_BUILDING_REACH,
  CITY_GRID_BLOCK,
  CITY_RING_STEP,
  CITY_SIDE_LANE_GAP,
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  CITY_PRICE_STANDING_SWING,
  CITY_QUARTER_ROWS,
  CLIMB_TICKS,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_LIMIT,
  COMBAT_SKILL_PER_BLOW,
  CONSTRUCTION_SKILL_EFFECT,
  CONSTRUCTION_SKILL_MAX,
  CONSTRUCTION_SKILL_PER_DAY,
  CONTRACT_MAX_DAYS,
  CREW_FOOD,
  CRIME_MEMORY_DAYS,
  DECLINE_AGE,
  DECLINE_FLOOR,
  DECLINE_PER_YEAR,
  DELIVERY_FEE_BASE,
  DELIVERY_FEE_PER_KG_TILE,
  DELIVERY_LOAD,
  DODGE_LIMIT,
  DODGE_PER_AGILITY,
  DRIVING_SKILL_EFFECT,
  DRIVING_SKILL_LIMIT,
  ROW_SPEED,
  ROW_STRENGTH_AVERAGE,
  ROW_STRENGTH_EFFECT,
  ROW_STRENGTH_LIMIT,
  SEAFARING_SKILL_EFFECT,
  SEAFARING_SKILL_LIMIT,
  SEAFARING_SKILL_PER_DAY,
  DRIVING_SKILL_PER_DAY,
  STARVE_DAYS,
  DOWN_DAYS,
  FEED_UNITS,
  EQUIP_TICKS,
  NPC_PATROLS_MAX,
  NPC_PATROL_ROAD_STOPS,
  NPC_PATROL_WALL_STOPS,
  NPC_POST_AROUND_HALL,
  NPC_REVIVE_REACH,
  NPC_SOLDIERS_AT_GATE,
  NPC_SOLDIERS_ON_HALL,
  NPC_SOLDIERS_PER_PATROL,
  WAKE_HEALTH,
  FOOD_SPOIL_PER_DAY,
  FOOD_SURPLUS_DAYS,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  FORMER_PLAYER_STANDING,
  GAME_DAYS_PER_YEAR,
  GOOD_WEIGHT,
  HAUL_HORSE_FOOD,
  HAUL_KEEP_FOOD,
  HEAL_DAYS,
  HORSE_FOOD_PER_DAY,
  HQ_PEOPLE_FOOD_DAYS,
  WAITING_HORSE_FOOD,
  HORSE_WAKE_HEALTH,
  HORSE_GRANT_FOOD,
  HQ_FLOOR_FACTOR,
  HQ_FOOD_FLOOR_FACTOR,
  HORSE_GRANT_HORSES,
  HORSE_HUNGRY_SHARE,
  HORSE_NAME_MAX_LENGTH,
  WAYPOINTS_MAX,
  EXPLORE_FOOD_MARGIN,
  EXPLORE_SKIP_RANGE,
  CARRIAGE_STOLEN_WORTH,
  HORSE_STOLEN_WORTH,
  EXPLORED_EDGE_RANGE,
  WAYPOINT_NAME_MAX_LENGTH,
  HUNGRY_HORSE_PACE,
  HORSE_ENDURANCE_EFFECT,
  HORSE_ENDURANCE_LIMIT,
  HORSE_SPEED_EFFECT,
  HORSE_SPEED_LIMIT,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  HORSE_STAT_AVERAGE,
  HORSE_STAT_MAX,
  HORSE_STAT_MIN,
  HORSE_STRENGTH_EFFECT,
  HORSE_STRENGTH_LIMIT,
  HOUSING_ROOM,
  HUNGER_DAYS,
  HUNGER_ENDURANCE_EFFECT,
  HUNGER_ENDURANCE_LIMIT,
  DIAGONAL_STEP,
  ENDURANCE_TERRAIN_EFFECT,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAP_SIZE,
  MAINLAND_SHARE,
  ISLAND_COUNT,
  HEARTLAND_COUNT,
  FRONTIER_REGION_COUNT,
  FRONTIER_NODE_DENSITY,
  ISLAND_NODE_DENSITY,
  GOLD_NODE_DENSITY,
  START_COINS,
  REGION_BORDER_WIDTH,
  PASS_WIDTH,
  SECOND_WAY_SHARE,
  MAX_HEALTH,
  MIN_BLOW_DAMAGE,
  OCCUPATION_GAME_DAYS,
  NPC_ALLIANCE_JOIN_STANDING,
  NPC_ALLIANCE_LEAVE_STANDING,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  FOOD_PER_DAY,
  NPC_BUILDERS,
  NPC_INNER_WALL_REACH,
  NPC_STONE_WALL_RESIDENTS,
  NPC_WALL_STONE_SET_ASIDE_TILES,
  NPC_ROAD_CREW,
  NPC_ROAD_LONGEST,
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_FOOD_DAYS,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_PARTY_MOST,
  NPC_FOUND_ESCORT_SHARE,
  NPC_ESCORT_TOWN_RESIDENTS,
  NPC_TRADER_ESCORTS,
  NPC_FOUND_REACH,
  NPC_FOUND_RESIDENTS_PER_MEMBER,
  NPC_FOUND_STANDING,
  NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT,
  NPC_STANCE,
  NPC_ACTING_FIRST,
  NPC_RETALIATE,
  NPC_FOUND_VILLAGE_RESIDENTS,
  NPC_FULL_DAYS,
  NPC_FULL_DAYS_LEAST,
  NPC_STARTING_SITE_CLEARANCE,
  NPC_TOWNS_PER_FRONTIER,
  NPC_VILLAGES_PER_FRONTIER,
  NPC_VILLAGES_PER_HEARTLAND,
  NPC_WAY_CLEARANCE,
  TRADING_POST_REGION,
  NPC_FULL_DIP_DAYS,
  NPC_FOUND_FOOD_SURPLUS_SHARE,
  NPC_FULL_RESIDENTS_PER_DAY,
  NPC_GATE_WATCH_RANGE,
  NPC_VILLAGE,
  NPC_NODE_REACH,
  NPC_RESIDENTS_PER_NEEDS_STEP,
  NPC_TRAIN_TURN_TICKS,
  NPC_RESIDENTS_PER_SCOUT,
  NPC_SCOUT_LIMIT,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_OFFER_REACH,
  NPC_RESIDENTS_PER_TRADER,
  NPC_TRADER_REACH,
  NPC_PLAN_TICKS,
  NPC_SURPLUS_CAP,
  NPC_SURPLUS_PAST_CAP,
  NPC_ARCHER_ARROWS,
  NPC_ARCHER_SHARE,
  NPC_SOLDIER_SHARE,
  NPC_STEEL_KIT,
  NPC_WAR_CHEST_PER_RESIDENT,
  NPC_TOOLS_SPARE,
  NPC_TRADE,
  OWN_FOOD,
  OUTPOST_REFILL_REACH,
  PERSUADE_ASK_AGAIN_DAYS,
  PERSUADE_STANDING,
  PRICE_ELASTICITY,
  PRICE_RANGE,
  PRICE_REFERENCE_FLOORS,
  PROTECTION_DEFENCE,
  ROAD_LINE_MAX_TILES,
  MOUNTAIN_ROAD_WORK_FACTOR,
  DOING_MAX_LENGTH,
  SCRIPT_ACTION_COST,
  SCRIPT_LIBRARY_MAX_SCRIPTS,
  SCRIPT_LIST_QUERY_COST,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MAX_VERSIONS,
  SCRIPT_MAX_LIST_LENGTH,
  SET_OUT_WORK_DAYS,
  SCRIPT_MAX_OBJECT_KEYS,
  SCRIPT_MAX_STRING_LENGTH,
  SCRIPT_LOG_LINES,
  SCRIPT_ACTION_VALUE_MAX,
  SCRIPT_MEMORY_MAX,
  SCRIPT_STEP_BUDGET,
  SCRIPT_TILE_QUERY_COST,
  LAST_SEEN_EVERY_TICKS,
  SIGHT_RANGE,
  STABLE_BREED_DAYS,
  STABLE_CAPACITY,
  FOAL_STAT_SPREAD,
  BREED_FOOD,
  HORSE_PRICE_AGE_FLOOR,
  HORSE_PRICE_AGE_PER_YEAR,
  HORSE_PRICE_BASE,
  HORSE_PRICE_GLUT,
  HORSE_PRICE_PAID_SHARE,
  HORSE_PRICE_PER_STAT,
  HORSE_PRICE_SCARCITY,
  NPC_HORSES_BASE,
  NPC_HORSES_KEPT,
  NPC_RESIDENTS_PER_HORSE,
  NPC_STABLE_HUNGRY_DAYS,
  NPC_STABLE_REFILL_DAYS,
  NPC_START_HORSE_FOOD_DAYS,
  NPC_START_HORSES,
  STABLE_FEED_DAYS,
  STABLE_HAND_FEED_DAYS,
  STABLE_HAND_WORK_MINUTES,
  DEFEND_CALM_TICKS,
  STANDING_CONTRACT_BROKEN_LOSS,
  STANDING_DRIFT_PER_DAY,
  STANDING_PER_PAID_WEEK,
  DEMANDS_PER_GAME_DAY,
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_MAX_DAYS,
  TRADE_ORG_DEBT_DEMAND_DAYS,
  TRADE_ORG_DEBT_TRIPS,
  WORKPLACE_WRECK_WORTH,
  DEMAND_NOTE_MAX_LENGTH,
  DEMAND_TRADE_ORG_STANDING_LOSS,
  DEMAND_YIELD_RESPECT_MIN,
  DEMAND_YIELD_RESPECT_TIMES,
  RESPECT_PER_WALL,
  THREAT_SEEN_PER_DAY,
  THREAT_PER_KILLING,
  THREAT_PER_ROBBERY,
  THREAT_HALF_LIFE_DAYS,
  THREAT_FORGOTTEN,
  DANGER_PLACE_MERGE_RANGE,
  DANGER_PLACE_HALF_LIFE_DAYS,
  DANGER_PLACE_WAY_REACH,
  DANGER_ESCORTS_MAX,
  NPC_JOB_WEIGHTS,
  OUTWEIGH_HOLD_DAYS,
  STANDING_RANGE,
  STANDING_NPC_TRADE_COINS_PER_POINT,
  STANDING_TRADE_COINS_PER_POINT,
  START_HORSES,
  START_RESIDENTS,
  START_SPEARS,
  START_STONE,
  START_TOOLS,
  START_WOOD,
  STARTING_SITE_WALK,
  STARTING_SITE_NODE_REACH,
  STARTING_SITE_FOREST_REACH,
  HEARTLAND_GROVE_SPACING,
  STARTING_SITES_PER_HEARTLAND,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STRIKE_TICKS,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  TOOLS_WORK_BONUS,
  TOOLS_WORK_DAYS,
  DECAY_WORN,
  DECAY_NEARLY_RUIN,
  REPAIR_MATERIALS_SHARE,
  REPAIR_WORK_SHARE,
  REBUILD_MATERIALS_SHARE,
  REBUILD_WORK_SHARE,
  RUIN_COLLAPSE_DAYS,
  COLLAPSE_MATERIALS_LEFT,
  TERRAIN_FOOD,
  TERRAIN_SPEED,
  TERRITORY_CITY_BASE,
  TERRITORY_MAX_REACH,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TERRITORY_REACH_PER_ROOT,
  TERRITORY_WORKPLACE_BASE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG_ARMY,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  TRAINED_CAP_SHARE,
  TRAINING_GROUND_MAX_TRAINEES,
  TRAIN_SKILL_FACTOR,
  FOOTPRINT,
  trainedCap,
  TRANSFER_FEE_FACTOR,
  Terrain,
  WALL_DEFENCE,
  WALL_STRENGTH,
  RAM_CREW,
  RAM_STRENGTH,
  RAM_BLOW,
  RAM_STRIKE_TICKS,
  CATAPULT_CREW,
  CATAPULT_REACH,
  CATAPULT_SHOT_TICKS,
  CATAPULT_BLOW,
  CATAPULT_STRENGTH,
  STONE_WALL_STRENGTH,
  TOWER_ROOM,
  TOWER_SIGHT_RANGE,
  TOWER_SHOT_REACH_BONUS,
  WALL_WALK_TICKS,
  FALL_DAMAGE,
  WALK_TICKS_PER_TILE,
  aboutTime,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  WEAPON_ATTACK,
  WEAR_BLOWS,
  TRAINING_WEAR_BLOWS_PER_DAY,
  WORN_FROM,
  NEARLY_BROKEN_FROM,
  MEND_RECIPE_SHARE,
  MEND_WORK_SHARE,
  WORN_PRICE_SHARE,
  NEARLY_BROKEN_PRICE_SHARE,
  SHOT_REACH,
  SHOT_TICKS,
  SHOT_DAMAGE,
  SHOT_SKILL_LIMIT,
  SHOT_PIERCE,
  WALL_SHOT_REACH_BONUS,
  WORK_SKILL_EFFECT,
  WORK_SKILL_MAX,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_SKILL,
  RECIPES,
  BATCHES_PER_DAY,
  WORK_OUTPUT_PER_DAY,
  GATHER_PER_DAY,
  GATHER_REACH,
  PATCH_SIZE,
  PATCH_REGROW_DAYS,
  PATCH_REST_DAYS,
  NPC_FOOD_REFILL_DAYS,
  RICHNESS_FACTOR,
  FRONTIER_RICH_NODES,
  RICHER_NODE_REACH,
  VEIN_CREW_DAYS,
  VEIN_STOCK,
  VEIN_THINNING,
  VEIN_NEARLY_GONE,
  NEW_VEIN_SPOT_REACH,
  NPC_HUNT_REACH,
  NPC_HUNTERS_PER_THIEF,
  NPC_DEMAND_OUTWEIGH_TIMES,
  NPC_DEMAND_MIN_STRENGTH,
  NPC_DEMAND_COINS,
  NPC_DEMAND_DAYS,
  NPC_DEMAND_AGAIN_DAYS,
  NPC_DEMAND_REFUSED_STANDING,
  NEW_REALM_SHELTER_DAYS,
  NPC_NODE_GUARD_RANGE,
  NPC_TAKE_OUTWEIGH_TIMES,
  NPC_TAKE_PARTY_MIN,
  NPC_SITE_ESCORTS,
  carryCapacity,
  walkSpeed,
  workFactor,
  RALLY_PACE,
  ZEAL_CAP_HOURS,
} from '@csp/balance'
import { PARAM_DESCRIPTIONS, DEFAULT_SCRIPTS, SCRIPT_VIEWS } from '@csp/lang-wasm'
import { WORKPLACE_PARAM } from './shared/default-scripts.js'
import { SCRIPT_PARAM_TYPES } from './shared/script-api.js'
import { NPC_SMITHY_WEAPON } from './shared/npc-trade.js'
import {
  DECAY_DAYS,
  rebuildMaterials,
  rebuildWork,
  repairMaterials,
  repairWork,
} from './shared/decay.js'
import { fighterStrength } from './shared/persuasion.js'
import { WHO_PAGE, WHO_SUGGESTS } from './who-list-view.js'
import type {
  BuildingKind,
  CrimeKind,
  Good,
  Stock,
  ScriptType,
  ScriptViewName,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './map/palette.js'
import { GOOD_LABELS } from './Residents.js'
import { GoodIcon } from './GoodsGrid.js'
import {
  AVERAGE,
  AVERAGE_CARRY,
  AVERAGE_STATS,
  COMBAT_SKILL_MAX,
  TERRAIN_NAMES,
  batchesPerDay,
  blow,
  breakTicks,
  buildCosts,
  stoneWallCosts,
  carriageCost,
  boatCost,
  shipCost,
  ramCost,
  ramPushTicks,
  ramBreakTicks,
  catapultBreak,
  cityControl,
  coinsPerMintWorkerDay,
  crimeForgotten,
  days,
  trainingDays,
  daysToWorkSkillMax,
  duration,
  feeExamples,
  foodEatenPerDay,
  foodHalfLifeDays,
  goldMinersPerMintWorker,
  jobDays,
  minersPerSmelterWorker,
  num,
  outputPerDay,
  pct,
  priceAt,
  realSeconds,
  realTimeOf,
  signed,
  residentsPerFarmer,
  transport,
  horseRow,
  wikiResident,
  zealFillRealHours,
  zealFullRealMinutes,
  type PricedGood,
} from './wiki-view.js'
import { GROUP_SLOTS } from './saved-groups.js'
import { realMinutes } from './queue-view.js'
import { DEFAULT_REPEAT } from './plan-blocks.js'
import {
  PARAM_CHOICE_EXAMPLE,
  PARAM_COMMENT_EXAMPLE,
  PARAM_DEFAULT_EXAMPLE,
  SCRIPT_LANGUAGE,
} from './wiki-scripting.js'
import { apiNames, type ApiName } from './script-editor.js'

/** A smelter's Steel recipe (`CONTEXT.md`: Coal): its second, after Iron. */
const STEEL = RECIPES.smelter!.find((r) => 'steel' in r.output)!

/** The smithy's recipe for `good` (`CONTEXT.md`: Smithy). */
const forged = (good: Good) => RECIPES.smithy!.find((r) => good in r.output)!

/** How many blows a piece of gear lasts (`CONTEXT.md`: Wear), or a dash for gear that never wears. */
function lasts(good: Good): string {
  const blows = (WEAR_BLOWS as Record<string, number | undefined>)[good]
  return blows === undefined ? '—' : num(blows)
}

/** Each steel weapon or piece of armour beside the iron one it beats (`CONTEXT.md`: Coal). */
const STEEL_GEAR: [Good, Good][] = [
  ['sword', 'steelSword'],
  ['shield', 'steelShield'],
  ['armour', 'steelArmour'],
]

/** What a weapon or piece of protection adds in a fight: its attack, or what it takes off a blow. */
const gearValue = (good: Good) =>
  (({ ...WEAPON_ATTACK, ...PROTECTION_DEFENCE }) as Record<string, number>)[good]!

/** An untrained fighter with a spear and a fully trained, armoured one, as respect weighs them. */
const UNTRAINED_SPEAR = { carried: { spear: 1 }, skills: {} }
const TRAINED_AND_ARMOURED = {
  carried: { sword: 1, shield: 1, armour: 1 },
  skills: { combat: COMBAT_SKILL_MAX },
}

/** The Wiki's topics, in order, each a section with its own anchor (`/wiki#food`). */
export const WIKI_TOPICS = [
  { id: 'controls', title: 'Controls' },
  { id: 'queues', title: 'Queues' },
  { id: 'time', title: 'Time & map' },
  { id: 'land', title: 'The land' },
  { id: 'waypoints', title: 'Waypoints' },
  { id: 'exploring', title: 'Exploring' },
  { id: 'terrain', title: 'Terrain & walking' },
  { id: 'residents', title: 'Residents & stats' },
  { id: 'training', title: 'Training' },
  { id: 'food', title: 'Food & hunger' },
  { id: 'work', title: 'Workplaces & output' },
  { id: 'zeal', title: 'Zeal & rallying the crew' },
  { id: 'gathering', title: 'Gathering by hand' },
  { id: 'building', title: 'Building & tearing down' },
  { id: 'transport', title: 'Carrying & transport' },
  { id: 'water', title: 'Water & havens' },
  { id: 'how-to-trade', title: 'How to trade' },
  { id: 'trade', title: 'Trade & prices' },
  { id: 'standing', title: 'Standing & reactions' },
  { id: 'demands', title: 'Demands' },
  { id: 'combat', title: 'Combat & walls' },
  { id: 'siege', title: 'Siege machines' },
  { id: 'territory', title: 'Territory' },
  { id: 'language', title: 'Script language' },
  { id: 'api', title: 'Game API' },
  { id: 'params', title: 'Script parameters' },
  { id: 'scripts', title: 'Scripting budgets' },
  { id: 'examples', title: 'Example scripts' },
] as const

type TopicId = (typeof WIKI_TOPICS)[number]['id']

function Section({ id, children }: { id: TopicId; children: ReactNode }) {
  const title = WIKI_TOPICS.find((t) => t.id === id)!.title
  return (
    <section id={id} className="wiki-section">
      <h2>
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  )
}

/** Goods as a list: "40 wood, 20 stone"; "nothing" for none. */
function goods(stock: Stock): string {
  const entries = (Object.entries(stock) as [Good, number][]).filter(([, n]) => n > 0)
  if (!entries.length) return 'nothing'
  return entries.map(([g, n]) => `${num(n)} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')
}

/** Plain words with `backticks` around code, as the scripting topics write them. */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}

/** A script value's kind, a script view linking to where the Game API lists its fields. */
function typeNode(type: ScriptType): ReactNode {
  if (typeof type === 'string') return type
  if ('list' in type) return <>list of {typeNode(type.list)}</>
  return <a href={`#view-${type.view}`}>{type.view}</a>
}

/** How an API name is written: `me`, `walkTo(x, y)`. */
const callOf = (n: ApiName) => {
  const b = (n.resident ?? n.army)!
  return b.is === 'value' ? b.name : `${b.name}(${b.params.join(', ')})`
}

/** An API name's description, both where a resident's and an army's differ, and its mark. */
function apiDescription(n: ApiName): ReactNode {
  const r = n.resident
  const a = n.army
  const text =
    r && a && r.description !== a.description ? (
      <>
        Resident: {withCode(r.description)} Army: {withCode(a.description)}
      </>
    ) : (
      withCode((r ?? a)!.description)
    )
  return n.mark ? (
    <>
      <em>{n.mark}.</em> {text}
    </>
  ) : (
    text
  )
}

/** A table of the Game API's names of one kind: values, queries or actions. */
function ApiTable({ is }: { is: ApiName['is'] }) {
  const names = apiNames(false).filter((n) => n.is === is)
  return (
    <table>
      <thead>
        <tr>
          <th>{is === 'value' ? 'Name' : 'Call'}</th>
          {is !== 'value' && <th>Cost</th>}
          <th>{is === 'value' ? 'Holds' : 'Answers'}</th>
          <th>What it does</th>
        </tr>
      </thead>
      <tbody>
        {names.map((n) => {
          const b = (n.resident ?? n.army)!
          // `me` holds a resident in a resident's script, an army in an army's.
          const holds =
            n.resident && n.army && n.is === 'value' && n.name === 'me' ? (
              <>
                {typeNode(n.resident.returns)} or {typeNode(n.army.returns)}
              </>
            ) : is === 'action' ? (
              'null, or why not'
            ) : (
              typeNode(b.returns)
            )
          return (
            <tr key={n.name}>
              <td>
                <code>{callOf(n)}</code>
              </td>
              {is !== 'value' && <td>+{num(b.cost)}</td>}
              <td>{holds}</td>
              <td>{apiDescription(n)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const kindName = (kind: BuildingKind) => BUILDING_NAMES[kind]
/** Each kind that decays, with the game days it takes to lose all its condition. */
const decayRows = () =>
  (Object.entries(DECAY_DAYS) as [BuildingKind, number][]).map(([kind, days]) => ({ kind, days }))
const goodName = (good: Good) => GOOD_LABELS[good]
const skillName = (kind: BuildingKind) => {
  const skill = WORKPLACE_SKILL[kind] ?? ''
  return skill.charAt(0).toUpperCase() + skill.slice(1)
}

const CRIME_NAMES: Record<CrimeKind, string> = {
  theft: 'Theft',
  attack: 'Attack',
  tearDown: 'Tearing down a building',
  killing: 'Killing',
  capture: 'Capturing a trading post',
}

const NODE_WORK: { kind: BuildingKind; good: Good }[] = [
  { kind: 'farm', good: 'food' },
  { kind: 'lumberCamp', good: 'wood' },
  { kind: 'quarry', good: 'stone' },
  { kind: 'mine', good: 'ironOre' },
  { kind: 'mine', good: 'goldOre' },
  { kind: 'mine', good: 'coal' },
]

/** The Wiki (`CONTEXT.md`: Wiki): the rules in plain words, with the game's current numbers. */
export function Wiki() {
  // The page renders after the browser looked for the anchor, so go to it once it is there.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])
  const avg = AVERAGE_STATS.strength
  const groundCost = buildCosts().find((b) => b.kind === 'trainingGround')!
  const havenCost = buildCosts().find((b) => b.kind === 'haven')!
  const strong = wikiResident({ strength: avg * 1.5 }, { mining: WORK_SKILL_MAX / 10 })
  const strongAgile = wikiResident({ agility: avg * 1.5 })
  const plainsTicksPerTile = 1 / walkSpeed(AVERAGE, Terrain.Plains, 0)
  const unarmed = blow()
  const sword = blow({ sword: 1 })
  const steelSword = blow({ steelSword: 1 })
  const swordSkilled = blow({ sword: 1 }, COMBAT_SKILL_MAX)
  const dodge = Math.min(DODGE_LIMIT, avg * DODGE_PER_AGILITY)
  const loads: [number, number][] = [
    [100, 100],
    [100, 400],
    [DELIVERY_LOAD, 1000],
  ]
  return (
    <main className="wiki">
      <header className="wiki-head">
        <h1>Code Strategy Wiki</h1>
        <p>
          The game's rules in plain words, with its current numbers and what follows from them.
          Figures are for an average resident (every stat at {num(avg)}, no skills) unless they say
          otherwise. Times are game time first, real time after.
        </p>
        <nav className="wiki-toc" aria-label="Contents">
          <ol>
            {WIKI_TOPICS.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <Section id="controls">
        <p>
          Click one of your residents on the map to pick them and open their card. Each action on
          the card shows its letter key; press it to run the action. The card opens with the orders
          they can take. While it stays open, each row stays where it is: an order that stops being
          possible (they walk off the farm they worked) stays in its place, greyed out, saying why,
          and one that becomes possible is added at the end of its group. The rows are sorted afresh
          once you pick something else. A group’s card has the same rows and keys.
        </p>
        <p>
          Escape leaves the top-most thing first: picking a target on the map, then a panel open on
          the card (Build, Goods, Run script, …), then a tile’s card, then the resident’s or group’s
          card, then the open drawer.
        </p>
        <p>
          In unit control mode, what a click picks on a tile goes in this order, at every zoom: one
          of your residents there, then a building, then the bare tile, each showing its card. A
          carriage of yours, or a horse of yours nobody rides, counts like a building. A click on a
          stack of your residents (a token with a count, or the +N badge up close) picks them all as
          a group; its card’s Members tab picks one of them. A stack with someone else’s residents
          in it opens the tile card instead, which lists them all. With a mouse, what a click would
          pick is outlined while you hover over it, in its owner’s colour; on a touch screen a tap
          picks by the same order.
        </p>
        <h3>Control modes</h3>
        <p>
          The Unit | Realm switch at the start of the top bar, or the Tab key, picks how you give
          orders. This browser remembers it; you start in unit control mode.
        </p>
        <p>
          In <b>unit control mode</b> you pick residents, a group or an army, then say what they do,
          as the rest of this section tells. In <b>realm control mode</b> you say what is to be done
          and where, then who does it. There a click or tap on the map picks a building (a carriage,
          or a horse nobody rides, counts as one), else the bare tile: your residents are drawn but
          never picked, so a crowded tile is still easy to click, and a drag or the Select button
          picks no group. The realm bar along the bottom of the map (above the map buttons on a
          phone) is where those orders start.
        </p>
        <p>
          <b>Build</b> on the realm bar opens the Build menu. Pick a kind (and Customise, if you
          like), then tap where it goes: the footprint shows under the pointer, marked where it
          doesn’t fit, and a tile it can’t go on says why and sends nobody. Then the <b>who-list</b>{' '}
          opens: your residents nearest the place first, each with what they are doing and how long
          their way there is. The nearest {num(WHO_SUGGESTS.build)} idle ones are already ticked;
          change the ticks or just Confirm. With nobody idle, nobody is ticked and the list says so.
          Those who can’t build (children, a partner carrying a child, or with no way there) come
          last, greyed out, saying why. Those ticked walk there and build as a group sent with Build
          would; hold Shift while confirming to pick the next place for another of the same kind.
          <b>Road</b> and <b>Wall</b> beside it lay out a line the same way (see{' '}
          <a href="#building">Building</a>).
        </p>
        <p>
          A busy resident you tick gets a <b>Now / After</b> switch on their row. <b>Now</b> drops
          what they are doing and sends them at once. <b>After</b> adds the order to the end of
          their queue, as Shift does on their card: they finish the steps they have first. Someone
          walking with no queue yet gets one, the walk first. After is offered only to those two:
          someone running a script or a task (Work, a haul route, …) or another order without a
          queue has nothing to add to, as a new queue would end what they do, so their row offers
          Now only and says “no queue to add to”. The switch starts on After for someone running a
          queue and on Now for anyone else busy; an idle resident has no switch. The line at the top
          sums it up: “3 ticked: 2 now, 1 after”.
        </p>
        <p>
          A long who-list can be searched by name and filtered as the Residents list can (idle, by
          city, has weapons, …); this browser remembers the filters. Ticks stay on those a search or
          filter hides, and the list says how many are ticked but not shown. Only the nearest{' '}
          {num(WHO_PAGE)} are drawn at first; Show more draws more.
        </p>
        <p>
          A building’s card starts the orders about it, each ending in the same who-list:{' '}
          <b>Work here</b> at a workplace (or a site of one), <b>Build this site</b> at a site of
          yours, <b>Feed the stable</b> and <b>Breed horses</b> (pick the two first) at a stable,{' '}
          <b>Teach</b> (pick the subject) and <b>Train</b> at a training ground, and{' '}
          <b>Tear down</b> at any building of yours or a workplace. Only those that fit the building
          show, greyed with why while they can’t be given. Customise, or a workplace’s Work
          settings, come before the who-list, as on a resident’s card. The who-list ticks the
          nearest {num(WHO_SUGGESTS.work)} idle resident for Work, Feed the stable, Breed, Teach and
          Train, and {num(WHO_SUGGESTS.tearDown)} for Tear down. A resident you tick who stands
          elsewhere walks there first and then does it, with no second order from you; one already
          there just starts.
        </p>
        <p>
          The realm bar also has <b>Walk to</b> (tap where; those ticked spread over the free tiles
          around it, as a group does; Shift picks the next place), <b>Explore</b> (its form first:
          what to look for, which way, a waypoint, how much food), <b>Run script</b> (pick the
          script, with Customise for its params; a building, storage or waypoint for a param is
          picked on the map) and <b>Relocate</b> (pick the city). Each ends in the who-list, the
          nearest {num(WHO_SUGGESTS.walkTo)} idle one ticked. Explore and a script with no place
          picked have no target tile, so the list sorts by the distance to your town hall and says
          so; Relocate sorts by the town hall of the city they move to, and lists those living there
          already last.
        </p>
        <p>
          A tile’s card in realm control mode offers <b>Walk here</b>, and on a tile with no
          building <b>Build here</b>: the Build menu for that tile, then the who-list. The card of a
          storage, stable, haven, or a carriage or boat of yours offers <b>Store here</b> (those
          carrying something listed first, the nearest {num(WHO_SUGGESTS.store)} idle ones ticked)
          and <b>Fetch from here</b>, the good picked from what it holds (those with room for it
          listed first).
        </p>
        <p>
          The card of a carriage of yours starts <b>Haul with this carriage</b> (pick the goods each
          way and the Food kept on board, then tap the route’s other stop), <b>Drive this to</b>{' '}
          (tap where) and <b>Board</b>; a boat’s card <b>Row this to</b> and <b>Board</b>; a ship
          docked at a haven <b>Board</b> as a passenger and <b>Board as crew</b>. Driving, hauling
          and rowing take one resident: the who-list ticks the nearest idle one, and Confirm is off
          while more than one is ticked. Board ticks as many as there are seats left, the list
          counting them (“2 of 3 seats”), and Confirm is off past the seats; crew take no seat. A
          resident you tick who is elsewhere walks to the carriage, beside the boat or onto the
          ship’s haven first, then takes the order. A carriage someone already drives says so on its
          Haul and Drive rows: one you send Now takes it over, its driver stopping; one you send
          After waits in their queue, and their step fails if it is still driven when its turn
          comes.
        </p>
        <p>
          Switching to realm control mode lets go of the resident, group or army you had picked.
          Picking one some other way (a row or Pick these in the Residents list, a saved group’s
          number key, the Armies drawer, a notice that opens a resident) switches back to unit
          control mode.
        </p>
        <p>
          The tool rail on the left opens drawers over the map, one at a time, in three groups:
          People (Residents, Horses, Armies), Diplomacy, and Realm (Cities, Waypoints, Scripts,
          Realm log). The Diplomacy drawer has a tab each for Contracts, Demands, Direct offers,
          Alliance and Standing; it reopens on the tab you left it on, and a notice’s Open takes you
          to its tab. A small dot on a rail button or tab says it holds something you haven’t seen
          yet: a demand, Direct offer or contract offer sent to you, or Realm log lines newer than
          the last time you had the log open. Opening it there clears the dot. On a phone the menu
          button shows the dot too.
        </p>
        <p>
          The Residents drawer’s Open full list button opens the list across the screen, with
          everyone’s age, city, stats, skills, gear, what they carry, hunger, health and what they
          are doing. On a phone each resident is a small card. Tap one to open that resident’s card,
          which closes the full list. Stats there are what they count for now, old age included.
        </p>
        <p>
          Search the full list by name, filter it by weapons (has any, has none, or fights with a
          certain one), by whether they are idle, by children or the grown up, by city and by a
          skill they have learned, and sort it by any column: tap a heading, and tap it again to
          turn the order round; on a phone the sort has its own menu. Whoever has nothing in the
          column comes last either way. This browser remembers your choice.
        </p>
        <p>
          Pick these makes a group on the map of everyone the full list shows, or of those you
          ticked among them, ready for one order, and closes the full list so the group card shows.
          Someone ticked whom the search or a filter hides isn’t picked. Ticks last only while the
          full list is open.
        </p>
        <p>
          The card and the residents list say what each resident is doing. Walking, riding or
          driving somewhere, they also say about when they arrive, and the card’s meters and
          countdowns (building, tearing down, breeding, carrying, pairing, growing up) say about how
          long is left, real time first and game time in brackets: “Walking to 12, 40 ·{' '}
          {aboutTime(24 * WALK_TICKS_PER_TILE)}”. Each is an estimate from the current pace, so it
          changes as that does: a way from the ground still to go (terrain, roads, Agility, the
          horse’s Speed and hunger, Driving skill; unexplored ground counts as Plains), a
          construction site from who works on it now, so it says nobody is building while nobody
          does.
        </p>
        <p>
          To pick several at once, drag a box around them with Shift held (or after the Select
          button on the map), or Shift-click residents to add them or take them out.
        </p>
        <p>
          While residents are picked, the map draws the way each of them is going, as a line ending
          in a dot: walking, driving or hauling somewhere, storing or fetching, walking to the next
          tile of a road or wall line, or going after someone. So a script that fetches food shows
          its way to the storage too. A passenger’s way is the carriage’s. Ways show at every zoom;
          far out as a thin line with a ringed dot at its end.
        </p>
        <p>
          In the same colour the map outlines the places they are set on: the buildings and
          carriages their script’s params name, and where their order heads for (the workplace they
          work, the site they build, the storage or carriage they store at or fetch from, both stops
          of a haul). Only places you can see or remember are outlined.
        </p>
        <p>
          An order that needs a place (walk to, drive to, a road or wall line, where to build, the
          storage to store at) shrinks the card to its header and a banner says what to pick. Where
          the card was stays dead until you pick, so a click there gives no order by accident.
          Before you click, the map shows under the pointer what the pick would do: the way there,
          with about when they arrive; the line of a road or wall and how many tiles it has, red
          when it is too long; a workplace’s footprint on a resource node, red where it doesn’t fit,
          or the site they would join; or the building a Store, Fetch or Work would use. The banner
          names what is under the pointer. Escape or Cancel gives no order.
        </p>
        <p>
          On a touch screen one finger pans the map, two fingers pinch to zoom, and a tap picks. A
          long-press does what right-click does. Turn on Select to make a one-finger drag box a
          group instead of panning. While picking a place, the first tap shows the preview there and
          the banner gains Confirm: press it, or tap the same tile again, to give the order; a tap
          elsewhere moves the preview.
        </p>
        <p>
          The map has three zoom tiers: far shows terrain, territory, the finished roads you see or
          last saw as thin lines, and one emblem per city; middle adds buildings, nodes and
          residents; close shows each figure. Far out territory is filled in its owner’s colour,
          nearer in only its borders are drawn; the Region map button fills it at every zoom. The
          readout bottom right names the terrain, the tile and the tier under the pointer. Above it
          the minimap shows the terrain you explored, your cities, your residents and carriages away
          from them, and the cities you know, with the part on screen as a rectangle; click it to
          look there. The minimap and the legend fold to buttons, and your browser remembers how you
          left them.
        </p>
        <p>
          The top bar shows the Food, Wood, Stone and Coins held in your storages, for what you pick
          beside them: Entire realm, outpost storages included, or one of your cities by name.
          Stables, carriages and piles don’t count. A storage in sight counts as it is now, one out
          of sight with what you last saw in it; then ≈ beside the goods says that part of the total
          is that old, and how old. Your browser remembers the pick; a city no longer yours goes
          back to Entire realm.
        </p>
        <p>
          On a phone the card sits at the bottom of the screen. Drag its handle to show just its
          header, half the screen or all of it; a tap on the handle goes one step up. While an order
          waits for a target the card drops to its header. The menu button at the top left opens the
          drawers, your goods, the wiki and Log out. The map’s buttons (Centre, Select, Region map)
          sit in one row at the bottom left, just above the card; zoom by pinching. The Residents
          and Horses drawers show each one in two lines: name and age, then what they are doing (or
          where the horse is) with their meters.
        </p>
        <p>
          Terrain you have explored loads as you look at it. Until it is here it shows grey, and the
          line at the bottom right says “Loading the map…”; dark is terrain you haven’t explored.
        </p>
        <table>
          <thead>
            <tr>
              <th>Keys</th>
              <th>What they do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <kbd>Ctrl</kbd>+<kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd>
              </td>
              <td>
                Save the picked residents as that number's group (with nobody picked, forget it)
              </td>
            </tr>
            <tr>
              <td>
                <kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd>
              </td>
              <td>Pick that group again; dead residents and ones no longer yours drop out of it</td>
            </tr>
            <tr>
              <td>
                <kbd>{GROUP_SLOTS[0]}</kbd>–<kbd>{GROUP_SLOTS.at(-1)}</kbd> twice
              </td>
              <td>Pick the group and centre the map on it</td>
            </tr>
          </tbody>
        </table>
        <p>Groups are kept in this browser, for each realm; another browser starts without them.</p>
        <p>
          With several picked, the group card gives each of them the same order, just as their own
          cards would. Every order a resident's card has is on it, but pairing, making Leader and
          renaming, which are about one resident. Nothing ties them together afterwards; each goes
          on alone. The card shows the orders some of them can take where they stand, as rows with
          the same keys as on a resident's card; while it stays open, an order none of them can take
          any more stays greyed out, saying why (“nobody stands on a carriage or beside a boat of
          your realm”).
        </p>
        <ul>
          <li>
            <strong>Walk to</strong> (or right-click the map): they spread over free tiles around
            the one picked, the nearest of them to the nearest tile.
          </li>
          <li>
            <strong>Work</strong>: pick a workplace; those standing at it work it. Walk them there
            first.
          </li>
          <li>
            <strong>Build</strong>: pick a tile and what to build there, or a construction site.
            Each walks there; the first to arrive lays out the site and the others join it.
          </li>
          <li>
            <strong>Store</strong> puts what each carries in the nearest storage (their own food
            stays with them), <strong>Store at</strong> in the storage, stable or carriage picked;{' '}
            <strong>Fetch</strong> takes a good from the nearest storage or carriage holding it, or
            from the one picked. <strong>Drop all</strong> puts down everything each carries.
          </li>
          <li>
            <strong>Mount horses</strong>: each takes a different free horse of yours on their tile.{' '}
            <strong>Drive carriages</strong> and <strong>Haul route</strong> go to each standing on
            a carriage, one driver for each carriage.
          </li>
          <li>
            <strong>Feed the stable</strong>: each standing in a stable feeds it.{' '}
            <strong>Breed horses</strong>: pick two horses in a stable where some of them stand; one
            of them there who isn't breeding yet tends the pair. Pick two more for the next.
          </li>
          <li>
            <strong>Build line: road</strong> and <strong>Build line: wall</strong>: pick where the
            line starts and ends; each gets Build line with that line, and they share it (see
            Building). <strong>Tear down</strong>: pick a building; those standing at it tear it
            down.
          </li>
          <li>
            <strong>Attack</strong>: pick a resident of another realm, or a wall or gate, for them
            all to attack. <strong>Climb a wall</strong>: those next to the one picked climb over.
          </li>
          <li>
            <strong>Board carriage</strong> (with several carriages of your realm where some of them
            stand, pick one) puts those on its tile aboard, in the group's order, until it is full;{' '}
            <strong>Get off</strong> gets every passenger among them off. See Passengers. A boat of
            your realm beside some of them is boarded the same way (Board boat), and{' '}
            <strong>Row boats to</strong> has one of them row each boat there; see Water.
          </li>
        </ul>
        <p>
          Those who can't take an order are skipped, and a notice under the top bar says who and
          why: children don't work, build or drive, and store, fetch or put down only Food; a
          partner carrying a child doesn't work, build, tear down, breed or haul; orders bound to a
          place go only to those standing there; Board skips those not on the carriage's tile, the
          driver, riders and, once it is full, the rest.
        </p>
        <p>
          Hold <kbd>Shift</kbd> while giving a group order to add it to the end of each one's queue
          instead (see Queues). Work, Tear down and Breed horses then also go to those away from the
          place, who walk there first, and Store to those who carry nothing yet. Stop still stops
          them all and ends their queues.
        </p>
        <p>
          The group card's Queue tab has the same planner as a resident's card.{' '}
          <strong>Add step</strong> adds the step to the end of each one's own queue.{' '}
          <strong>Plan a queue for all</strong> opens a plan kept in this browser: add steps,
          reorder them, give them durations and loop it, as on a resident's card, then{' '}
          <strong>Give to all</strong> makes each one's queue a copy of it, ending what they do.
          Everyone gets every step, even one they can't do; they skip it when its turn comes.
          Afterwards each one's queue is their own, edited on their card.
        </p>
      </Section>

      <Section id="queues">
        <p>
          A queue gives a resident a list of steps to do one after another, some of them wrapped in
          repeat blocks, up to {num(QUEUE_MAX_STEPS)} steps and blocks in all. A step is any order
          you could give them on its own: walk to, pick up, drop, store, fetch, drive, hitch or
          unhitch a horse, mount or dismount, board or get off a carriage, work, build, haul, feed
          the stable, breed horses, tear down, Build line (road or wall), relocate to another of
          your cities, or run one of your scripts with its params.
        </p>
        <p>
          To plan ahead, use <strong>Add step</strong> right under the queue's steps on the
          resident's card: a palette of every kind of step, each with its icon, grouped as the
          Orders tab is (Move, Work &amp; build, Goods, Scripts), plus Flow with{' '}
          <strong>Repeat</strong> and <strong>If</strong> for the picked steps, and{' '}
          <strong>Wait until</strong>. Customise is the small ⚙ beside a step. New steps go at the
          end; tap the <strong>+</strong> between two steps to add the next ones there instead, and
          tap it again to go back to the end. One that acts on a place (work a workplace, build,
          store at or fetch from a storage, pick up, feed the stable, breed, …) has you pick that
          place on the map, anywhere, not only where the resident stands now; one that needs more
          (which goods, what to build, what a smithy makes, which script) asks for it on the card
          after. What to build is the same Build menu as on the card; a kind dimmed because the tile
          lacks something today, such as a city's area, can still be added, for a step before it may
          bring that. A step that has to be done on its tile goes after a walk there, unless the
          step before already walks there; one that acts on no place (Explore, Dismount, Get off,
          Run script) gets no walk. Adding a step only checks that it could make sense (the place is
          there as you last knew it, and a carriage or horse is yours). A workplace or construction
          site can be anyone's, in sight or as last seen, since a workplace has no owner: queue Work
          at a far mine and they walk there and work it. Whether a step can start is checked when
          its turn comes.
        </p>
        <p>
          For a resident with no queue, the steps you add, paste or load collect as a{' '}
          <strong>draft</strong>, marked “Draft, not started”: nothing runs until you press{' '}
          <strong>Start queue</strong>, which gives it. <strong>Discard draft</strong> throws it
          away. A running queue is edited live; <strong>Edit as draft</strong> copies it into a
          draft while the queue runs on untouched, and Start queue replaces it (the step they are on
          keeps going if it is still in it). A draft is kept in this browser and lost on reloading
          the page. <strong>Clear</strong> empties a draft or a group's plan. On a running queue it
          asks first, then removes every step but the one the resident is on and turns loop off, so
          they finish that step and the queue ends; <strong>Stop</strong> still halts them at once.
        </p>
        <p>
          Hold <kbd>Shift</kbd> while you give an order (a button, its key, or a tile picked on the
          map, right-click included) to add it to the end of the resident's queue instead of
          replacing what they do; on a resident without a queue it starts one, after the walk they
          are on, if any. An order done on the resident's tile (work, build, pick up, drop, drive,
          board, haul, tear down) is queued after a walk back to that tile, so it still finds them
          there when its turn comes, every round of a loop. Work or haul followed by another step
          gets a duration of {num(QUEUE_DEFAULT_STEP_MINUTES)} game minutes (
          {realMinutes(QUEUE_DEFAULT_STEP_MINUTES)}), which you can change.
        </p>
        <p>
          The resident's card lists the queue with the current step marked and what they are doing
          in it, each step on one line with an icon for its kind of order and its place by name: a
          building with its city (“Walk to Farm, Quarrytown IV”), a waypoint or a city, or the
          tile's coordinates when nothing is there. A step's duration shows as a chip when it has
          one, or when it needs one; tap it to type the duration in game minutes (the real time
          shows beside it), empty it to clear it. The steps sit in a bracket, <strong>Loop</strong>,
          with its switch in its head: on, the first step follows the last. Drag a step to reorder
          it, also into or out of a repeat block's bracket, or focus it and press <kbd>Alt</kbd>+
          <kbd>↑</kbd> or <kbd>Alt</kbd>+<kbd>↓</kbd>. On a phone, tap the steps to move to pick
          them, then tap <strong>Move here</strong> where they go. A step kind dragged from Add step
          and dropped between two steps is planned there. Remove a step with ✕. The planner's{' '}
          <strong>?</strong> shows how it works.
        </p>
        <p>
          To reuse steps, tap one in the planner to pick it (<kbd>Shift</kbd>+tap picks a range;
          tapping the picked one again unpicks it), then <strong>Copy</strong>.{' '}
          <strong>Paste</strong> puts copies after the picked step, or at the end with none picked,
          in the same planner, another resident's or a group's; the pasted steps are picked, so a
          second Paste goes after them. <kbd>Ctrl</kbd>+<kbd>C</kbd> and <kbd>Ctrl</kbd>+
          <kbd>V</kbd> do the same while the planner has focus. The clipboard is this browser's: it
          survives switching cards, not reloading the page, and the server never sees it. A pasted
          step keeps its places and the walk before it, and is checked again when its turn comes.
        </p>
        <p>
          To keep a plan, open the planner's <strong>Saved…</strong> and save it under a name, such
          as “Mine run”; saving under a name already taken asks before it overwrites. Saved… also
          lists the saved queues with their step count and date, to load one or delete it (a
          resident with nothing queued has <strong>Load…</strong> for the same list); loading adds
          its steps after the planned ones, in any resident's planner or a group's. Saved queues are
          kept in this browser, as saved groups are: the server never sees them, and another browser
          has its own. A saved step keeps its places, so one whose building is gone from the map
          (torn down, say) is flagged in the planner; it is still given, and skipped when its turn
          comes.
        </p>
        <p>
          To do some steps several times in a row, pick them (in a row) and press{' '}
          <strong>Repeat</strong>: they are wrapped in a repeat block, done {num(DEFAULT_REPEAT)}{' '}
          times until you type another count (up to {num(QUEUE_MAX_REPEAT)}), or pick{' '}
          <strong>forever</strong> or <strong>until…</strong> in its head. The block is a bracket
          inside Loop's, its count in its head and its steps inside; it is picked, moved (into
          another block too), copied, pasted, saved and removed as one,
          <strong> Unwrap</strong> puts its steps back as they were, and a block can hold another,
          up to {num(QUEUE_MAX_DEPTH)} deep. The block is part of the queue itself: wrapping steps
          of a running queue edits it live, and the resident does the block's steps round after
          round. The running queue shows the round the block is on (“round 2 of 3”), and an edit
          keeps it. A round in which none of its steps could start ends the block, so a block whose
          steps all fail never spins: the queue goes on after it. A queue holds at most{' '}
          {num(QUEUE_MAX_STEPS)} steps and blocks as written: “repeat 100 times” of two steps is
          three. The planner counts them and won't give a plan over that, saying by how much. Loop
          still loops the whole queue; a looping queue that got through all its steps without
          starting one ends. Your scripts see a queue as before: the step the resident is on and its
          number among the steps counted top to bottom, not the blocks or their rounds.
        </p>
        <p>
          <strong>Repeat until</strong> repeats the block until a condition holds (the same
          conditions as Wait until, below), set on the card when you pick <strong>until…</strong>;{' '}
          <strong>Change</strong> in the head sets another. The condition is checked before each
          round: when the block's turn comes, and again after each round. Once it holds, the block
          runs no more rounds and the queue goes on after it; a round already begun runs to its end.
          If it holds when the block's turn comes, the block runs no round at all. It has no count,
          so the running queue shows just the round it is on (“round 4”), and a round in which none
          of its steps could start still ends it. For example, “repeat until the storage holds 100
          Wood: fetch, haul” keeps hauling until the storage is full enough. A condition on a place
          gone, or no longer your realm's, counts as false and is noted in your realm log.
        </p>
        <p>
          To do some steps only sometimes, pick them (in a row) and press <strong>If</strong> in Add
          step's Flow, then set its condition (the same conditions as Wait until, below): they are
          wrapped in an If block, a bracket with the condition in its head. When its turn comes the
          condition is checked once: if it holds, the block's steps run; if not, they are passed
          over. To do something else instead, pick other steps and press the block's{' '}
          <strong>Else</strong>: they move into its Else part, a second part of the bracket, run
          when the condition doesn't hold. The condition is not checked again while the block's
          steps run, whatever changes meanwhile. <strong>Change</strong> sets another condition,{' '}
          <strong>Unwrap</strong> puts its steps (then its Else steps) back where it was. An If
          block nests with repeat blocks and counts as a block towards the queue's size and depth;
          inside a repeat block it is checked again each round. A running queue marks the part it is
          running. A condition on a place gone, or no longer your realm's, counts as false (so the
          Else part runs) and is noted in your realm log. Your scripts see the steps counted top to
          bottom, the Else part's after the block's own.
        </p>
        <p>
          <strong>Wait until</strong>, in Add step's Flow, is a step that ends once its condition
          holds; meanwhile the resident stands idle where they are. With a duration it also ends
          when that is up, whether the condition holds or not. Its condition is set on the card:
          pick the kind, then its fields. A condition is about the resident themself or one place of
          your own realm, never anything you couldn't know:
        </p>
        <ul>
          <li>
            <strong>Carrying</strong>: they, or the carriage or boat they drive, carry at least or
            less than so many of a good. The carriage or boat is the one they drive or are aboard,
            else a carriage of yours on their tile; with none, the condition is false.
          </li>
          <li>
            <strong>Full or empty</strong>: they, or that carriage or boat, are full (not room left
            for one more unit of what they hold) or empty.
          </li>
          <li>
            <strong>Stock at a place</strong>: a storage, workplace pile or construction site of
            your realm, picked on the map, holds at least or less than so many of a good.
          </li>
          <li>
            <strong>Hunger or health</strong>: their hunger meter or health is above or below a
            share of full.
          </li>
          <li>
            <strong>Mounted</strong> or <strong>Aboard</strong>: they are, or are not.
          </li>
          <li>
            <strong>Game hour</strong>: it is before an hour, or that hour or later.
          </li>
        </ul>
        <p>
          The condition is checked from the tick after the wait started, so a wait whose condition
          already holds lasts a tick. A condition on a place that is gone, or no longer your
          realm's, counts as false and is noted once in your realm log. In a group's plan each
          member checks the condition for themself.
        </p>
        <p>
          A step ends when it is done (the walk arrives, the goods are stored, the script calls{' '}
          <code>end()</code>), or once its duration in game minutes is up, if you gave it one.
          Working a workplace, hauling and feeding a stable never end on their own, so such a step
          needs a duration unless it is the last. With loop on, the first step follows the last;
          without, the queue ends after it.
        </p>
        <p>
          You can add, remove and reorder steps while the queue runs; the current step keeps going
          unless you remove it, and then the step in its place starts. A step that can't start, or
          ends in a failure (a store whose storage is gone), is skipped and noted in your realm log.
          Any other order you give the resident ends the queue.
        </p>
        <p>
          Your scripts see a resident's queue as <code>queue</code>: which step they are on and what
          it is. Their <code>order</code> and <code>script</code> stay the current step's own.
          Scripts can't start or change queues.
        </p>
      </Section>

      <Section id="time">
        <p>
          The world keeps running while nobody is online. One tick is one real second and one game
          minute, so a game day lasts {realTimeOf(TICKS_PER_GAME_DAY)}, and a game year of{' '}
          {num(GAME_DAYS_PER_YEAR)} game days lasts{' '}
          {realTimeOf(GAME_DAYS_PER_YEAR * TICKS_PER_GAME_DAY)}.
        </p>
        <p>
          The map is {num(MAP_SIZE)} × {num(MAP_SIZE)} tiles, and its opposite sides join: walk off
          the east side and you come back in from the west. Walking once around it on plains takes
          an average resident {duration(MAP_SIZE * plainsTicksPerTile)}. A resident sees{' '}
          {num(SIGHT_RANGE)} tiles around them.
        </p>
        <p>
          The world fills in by itself: an NPC city that has grown full sends some of its people to
          found a new village on free land up to {num(NPC_FOUND_REACH)} tiles away (see NPC cities
          under Trade &amp; prices), which then grows like any other. Land within a realm's
          territory is never founded on.
        </p>
        <p>
          Buildings and cities you have had in sight stay on your map once they leave it, as you
          last saw them and marked apart from what you see now (last seen). Your map of them is
          brought up to date once every {duration(LAST_SEEN_EVERY_TICKS)}, so a building that leaves
          your sight in between is remembered as it was up to that long before. What is in sight now
          is always shown as it is.
        </p>
      </Section>

      <Section id="land">
        <p>
          The land is one <strong>mainland</strong> and, off its coasts, <strong>islands</strong>,
          with Sea all around. The mainland covers about {pct(MAINLAND_SHARE)} of the map, and up to{' '}
          {num(ISLAND_COUNT)} islands lie off it. Any tile of the mainland can be reached on foot,
          and by carriage, from any other. An island is reached only by vessel: a boat or a ship
          from a haven (see Water &amp; havens).
        </p>
        <p>
          All land lies in a <strong>region</strong> of one of three kinds. The mainland has{' '}
          {num(HEARTLAND_COUNT)} <strong>heartlands</strong>, good farmland in its middle where
          Players start, and {num(FRONTIER_REGION_COUNT)} <strong>frontier</strong> regions beyond
          them, where nobody starts. Each island is a region of its own. No rule keeps a heartland
          safe: it is safe only in that it holds little worth taking.
        </p>
        <p>
          <strong>Coal</strong> lies only out there: its nodes are in Hills and, more of them,
          Mountain of the frontier regions and the islands, never in a heartland. A mine built on a
          coal node yields Coal, {num(WORK_OUTPUT_PER_DAY.coal ?? 0)} a game day for an average
          worker, and teaches Mining. Coal is carried, stored, hauled and traded like any other
          good; it weighs {num(GOOD_WEIGHT.coal ?? 0)} kg a unit, and trading posts and the HQ buy
          and sell it. Your realm’s Coal shows in the top bar beside its Food, Wood and Stone.
        </p>
        <p>
          A smelter turns Iron and Coal into <strong>Steel</strong>: {num(STEEL.input.iron ?? 0)}{' '}
          Iron and {num(STEEL.input.coal ?? 0)} Coal make {num(STEEL.output.steel ?? 0)} Steel, so
          an average smelter worker makes{' '}
          {num(batchesPerDay('smelter') * (STEEL.output.steel ?? 0))} Steel a game day. Whether a
          smelter’s worker makes Iron or Steel is said when they are given Work there, as a smith
          says what to forge; told nothing, they make Iron. Set to Steel without Coal, they stand
          idle and their Doing line says what is missing. Steel weighs {num(GOOD_WEIGHT.steel ?? 0)}{' '}
          kg a unit, is stored and traded like any good, and shows in the top bar beside Coal.
        </p>
        <p>
          A smithy forges a <strong>steel</strong> Sword, Shield and Armour from Steel and Wood,
          each better than the iron one and as heavy; the Spear is iron only. The smith says which
          when given Work there, as for the iron ones.
        </p>
        <table>
          <thead>
            <tr>
              <th>Gear</th>
              <th>Made from</th>
              <th>Iron one</th>
              <th>Steel one</th>
            </tr>
          </thead>
          <tbody>
            {STEEL_GEAR.map(([iron, steel]) => (
              <tr key={steel}>
                <td>{goodName(steel)}</td>
                <td>
                  {num(forged(steel).input.steel ?? 0)} Steel, {num(forged(steel).input.wood ?? 0)}{' '}
                  Wood
                </td>
                <td>{signed(gearValue(iron) * (iron === 'sword' ? 1 : -1))}</td>
                <td>{signed(gearValue(steel) * (iron === 'sword' ? 1 : -1))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>NPC cities and Steel.</strong> An NPC city that knows of a coal node wants a{' '}
          {NPC_STEEL_KIT.map((g) => goodName(g as Good).toLowerCase()).join(', ')} for each of its
          soldiers, in that order, instead of a spear. So it keeps them, their Steel and Wood, and
          the Iron and Coal for that Steel and the Iron ore for that Iron in its reserve, mines
          Coal, sets every second smelter it builds to Steel, forges the steel gear and arms its
          soldiers with it: a soldier fetches each piece from its storage once it holds one and puts
          back the spear it outdoes. A city with no coal node in reach, as in a heartland, stays on
          the iron spear. NPC cities price Coal, Steel and the steel gear like any good and sell
          what they hold above their reserve, and lent residents take the best gear of the surplus,
          steel first. The Trade Organization’s warehouses trade the steel gear too (a floor of{' '}
          {num(WAREHOUSE_FLOOR.steelSword ?? 0)} each at a post), and its HQ and posts arm their
          soldiers with steel as far as their warehouse holds it, iron otherwise.
        </p>
        <p>
          Each heartland has {num(STARTING_SITES_PER_HEARTLAND)} <strong>starting sites</strong>, a
          walk of {num(STARTING_SITE_WALK.minMinutes)} to {num(STARTING_SITE_WALK.maxMinutes)} real
          minutes from the next one. A new Leader (your first, or one after your Leader died with no
          heir) gets a free site in the <strong>open</strong> heartland where Players have the most
          cities, the one opened first on a tie, and in it the free site nearest another Player’s
          city: you start as someone’s neighbour. The world’s first Player opens the first
          heartland; the next one opens, the one nearest an open heartland, only once no open
          heartland has a free site left. A site is free while nothing of anyone’s stands on it or
          on the farmland round it, so one whose city is gone is free again. Should every site be
          taken, your city goes on the free place nearest an open heartland’s middle. Your realm log
          names the heartland your city stands in.
        </p>
        <p>
          Every starting site has a poor stone and iron node within{' '}
          {num(STARTING_SITE_NODE_REACH)} tiles of its middle, and a poor forest node within{' '}
          {num(STARTING_SITE_FOREST_REACH)} tiles, about{' '}
          {duration(STARTING_SITE_FOREST_REACH * WALK_TICKS_PER_TILE)} on foot over Plains, so Wood
          is close from the start. A heartland’s Forest lies in wide patches; where none lies near,
          a small grove of Forest grows on its Plains, at most one every{' '}
          {num(HEARTLAND_GROVE_SPACING)} tiles.
        </p>
        <p>
          Resource nodes lie thicker away from home: a frontier region holds{' '}
          {num(FRONTIER_NODE_DENSITY)} times as many as a heartland, an island{' '}
          {num(ISLAND_NODE_DENSITY)} times. <strong>Gold ore</strong> is a rare good like Coal: no
          gold node lies in a heartland, only in the frontier and on islands, where it is{' '}
          {num(GOLD_NODE_DENSITY)} times as common again. Every frontier region has a gold node and
          a coal node in it or in a region next to it. So a heartland realm gets its Coins by trade,
          selling Food, Wood, Stone or Iron at its heartland’s trading post, or by holding a gold
          node out there. Your starting city’s storage holds {num(START_COINS)} Coins for a first
          trade.
        </p>
        <p>
          <strong>Starting city.</strong> A new Leader’s city starts with {num(START_RESIDENTS)}{' '}
          residents, your Leader among them, working the farm. Every grown one, your Leader too,
          carries {num(START_SPEARS)} iron Spear, so they are armed from the first tick and an alarm
          sends them to defend the city. Children get none, and no spare weapons lie in the storage.
          Beside its Food and Coins, the storage holds {num(START_WOOD)} Wood and{' '}
          {num(START_STONE)} Stone for a first building, and {num(START_TOOLS)} sets of Tools for
          residents to fetch. NPC villages keep their own start.
        </p>
        <p>
          <strong>First steps.</strong> Before any camp or quarry stands, your residents can{' '}
          <a href="#gathering">gather by hand</a>: give a few of them Gather (Wood) on their card
          and they bring load after load of Wood from the forest beside the city to its storage,
          enough for your first houses while you look for nodes.
        </p>
        <p>
          One resident of your starting city, never your Leader, is its <strong>stable hand</strong>
          . They start on a looped queue, <strong>Farm and feed</strong>: if the stable holds less
          than {days(STABLE_HAND_FEED_DAYS)} of Food for its {num(START_HORSES)} horses, Feed the
          stable once; then work the farm for {num(STABLE_HAND_WORK_MINUTES)} game minutes; again.
          So your horses don’t starve while you are away, as long as the storage has Food. Their
          card shows the queue under its name like any queue, which you can change or clear, and the
          planner’s Saved… lists it among your saved queues in this browser.
        </p>
        <p>
          The regions of the mainland are parted by Mountain ranges and by arms of the Sea, about{' '}
          {num(REGION_BORDER_WIDTH)} tiles across, and joined only by a few ways through: a{' '}
          <strong>pass</strong> is a gap of Hills in a range that a carriage can cross, a{' '}
          <strong>land bridge</strong> a narrow neck of land between two arms of the Sea. Each is
          about {num(PASS_WIDTH)} tiles wide, and about {pct(SECOND_WAY_SHARE)} of the borders have
          two of them instead of one. Whoever holds a pass or a land bridge holds the way between
          two regions.
        </p>
        <p>
          You know the region of every tile you have explored. A tile’s card names it: “Heartland of
          …”, “Frontier: …” or “Island: …”, with “pass” or “land bridge” on a tile of one. Zoomed
          out to the middle and far zoom, the map writes the names of the regions you have explored
          part of over them and marks the passes (a white diamond) and land bridges (a blue one) you
          have explored. Nothing shows for land you haven’t explored. This is not the Region map,
          which shows territory (see Territory).
        </p>
        <p>
          Scripts read a tile’s region in its view: <code>region</code> is its name and{' '}
          <code>regionKind</code> is <code>"heartland"</code>, <code>"frontier"</code> or{' '}
          <code>"island"</code>, both <code>null</code> on water and on tiles you haven’t explored.
        </p>
        <p>
          Every resource node is <strong>poor</strong>, <strong>normal</strong> or{' '}
          <strong>rich</strong>, from the day it comes into being. A mine, quarry or lumber camp on
          it makes {num(RICHNESS_FACTOR.poor)}, {num(RICHNESS_FACTOR.normal)} or{' '}
          {num(RICHNESS_FACTOR.rich)} times as much per worker; workers, skill and Strength count as
          ever. Heartland nodes are poor. Frontier nodes are normal, but for the{' '}
          {num(FRONTIER_RICH_NODES)} of each frontier region nearest its passes, land bridges and
          borders with another frontier region, which are rich. Island nodes are rich. Farms stand
          on no node and make the same everywhere.
        </p>
        <p>
          A node’s card says its richness once you have explored its tile, with what a worker of
          average Strength makes there a game day; so does the card of the workplace on it, and its
          Made a game day list counts it in. Scripts read it as the node’s <code>richness</code>:{' '}
          <code>"poor"</code>, <code>"normal"</code> or <code>"rich"</code>. NPC cities and the
          Trade Organization pick the richer of two nodes about as far away: each step of richness
          counts as {pct(RICHER_NODE_REACH)} less of the way.
        </p>
        <p>
          A normal or rich ore node (iron ore, gold ore or coal) holds a <strong>vein</strong> that
          working it uses up: each unit its mine makes takes one from it. A normal iron ore or coal
          vein holds {num(VEIN_STOCK.ironOre.normal)} units, a rich one{' '}
          {num(VEIN_STOCK.ironOre.rich)}; a gold ore vein {num(VEIN_STOCK.goldOre.normal)} or{' '}
          {num(VEIN_STOCK.goldOre.rich)}. That is {num(VEIN_CREW_DAYS.normal)} or{' '}
          {num(VEIN_CREW_DAYS.rich)} game days of a full crew of average workers. Poor nodes, forest
          and stone never run dry, so a heartland realm always keeps what its land gives.
        </p>
        <p>
          Whoever works a mine, your realm and your allies, sees how its vein stands on the mine’s
          card, in words and never as a number: <em>plenty</em> while more than {pct(VEIN_THINNING)}{' '}
          of what it first held is left, <em>thinning</em> from there, <em>nearly gone</em> at{' '}
          {pct(VEIN_NEARLY_GONE)} or less. A workplace on a node that never runs dry says so. Your
          realm log says once when a mine you work turns to thinning and once when it is nearly
          gone. Others, who work nothing there, see the node and its richness only. Your scripts
          read the word as a building’s <code>vein</code>.
        </p>
        <p>
          Once a vein runs dry its node is gone for good. The mine stays standing and makes nothing:
          its workers stop, each one’s log saying “the vein ran dry”, and your realm log says so
          once. You can tear the mine down like any building, but no mine can be built there again.
          Others who explored the tile still see the node on their map until they see the tile
          again.
        </p>
        <p>
          The land does not run out, though. The moment a vein runs dry a new node of the same kind
          and richness comes into being somewhere else: a normal one in a frontier region, a rich
          one on an island or within {num(NEW_VEIN_SPOT_REACH)} tiles of a pass, land bridge or
          frontier border, gold and coal never in a heartland, and in another region than the old
          one wherever one fits. It appears out of everyone’s sight and, where the map allows, on
          land nobody has explored. Nobody is told: you have to find it. If you had explored its
          tile before, your map shows no node there until one of your residents sees the tile again.
        </p>
        <p>
          NPC cities and the Trade Organization move on too. When the mine an NPC city or a trading
          post works runs dry, its workers are free at the city’s next planning pass and the city,
          still short of the ore, opens a mine on the next fitting node it knows of within its
          reach. Its builders tear the dead mine down for its materials once they have nothing
          better to do. With no other node known it buys the ore, or the goods made from it, from a
          trader or goes without, and a node its scouts find later counts from then on. The Trade
          Organization’s HQ takes the next nearest node of the kind, however far away it lies.
        </p>
      </Section>

      <Section id="waypoints">
        <p>
          A waypoint is a named marker you put on a tile: a mountain pass, a node you mean to come
          back to, where your residents meet. Right-click a tile on the map, or long-press it on a
          touch screen, while no resident is picked and choose Add waypoint here; the card of any
          tile you click has Add waypoint too. Only you see your waypoints: on the map at every
          zoom, on the minimap, and in the Waypoints drawer on the tool rail, where you can rename
          one, centre the map on it or remove it. All of that is free and at once.
        </p>
        <p>
          You hold at most {num(WAYPOINTS_MAX)} waypoints, each with a name of up to{' '}
          {num(WAYPOINT_NAME_MAX_LENGTH)} characters that need not be unique. They are kept with
          you, not your realm, so they are still there if your Leader dies and you found a new
          realm.
        </p>
        <p>
          A waypoint is a place like a tile. While an order waits for where to go or act (Walk to on
          a resident or group card, a place for a step in the queue planner), click a waypoint’s pin
          on the map, or open the Waypoints drawer from the banner and press Pick beside it: the
          order gets the waypoint’s tile. A queue step keeps that tile, so it still goes there if
          you remove the waypoint later, and the queue names the waypoint while it is there.
        </p>
        <p>
          Scripts see your waypoints with <code>waypoints()</code> and can put one down with{' '}
          <code>addWaypoint(x, y, name)</code> or take one away with{' '}
          <code>removeWaypoint(waypoint)</code>, free and at once, without stopping the script. The
          same cap counts there too.
        </p>
      </Section>

      <Section id="exploring">
        <p>
          Give a grown resident <strong>Explore</strong> on their card, on foot or riding, and they
          go into the unknown on their own. Before they start, pick <code>find</code>, a kind of
          resource node to look for (forest, stone, iron ore, gold ore or coal), or none to just
          explore until you stop them; <code>toward</code>, a compass direction, or a{' '}
          <code>waypoint</code> to head for instead; with neither they take the nearest unexplored
          land first. <code>food</code> is where they refill; with none picked, the nearest storage
          of your realm with Food.
        </p>
        <p>
          They set out with as much Food as they can carry and walk to the edge of what you have
          explored, that way: the nearest tile you have explored that they can go onto, beside one
          you haven't, within 45° of the direction. Standing there they see {num(SIGHT_RANGE)} tiles
          past it, and walk on to the next edge. A rider looks only where their horse can go.
        </p>
        <p>
          Before each way out they check that the Food on them covers it and the way back to where
          they refill, plus {num(EXPLORE_FOOD_MARGIN)} units to spare (their own food and one more).
          A walker eats {num(FOOD_PER_DAY)} Food a game day, more on hills and mountains; riding,
          their horse eats {num(HORSE_FOOD_PER_DAY)} a day too, from the Food they carry. Once it no
          longer covers it they turn back, refill, and go back out to where they turned if a full
          load still covers that way and back; otherwise they head for the nearest edge from there.
        </p>
        <p>
          Land they can see but find no way to, across a lake, say, they leave out from then on,
          with the edge within {num(EXPLORE_SKIP_RANGE)} tiles of it. With no edge within{' '}
          {num(EXPLORED_EDGE_RANGE)} tiles, or none their Food takes them to and back even with a
          full load, they walk back to where they refill and end, and your realm log says why.
          Scripts find the edge with <code>exploredEdge(from, toward, skip)</code> and the Food a
          way takes with <code>wayFood(a, b)</code>.
        </p>
        <p>
          With <code>find</code> picked they look about every tick on their way out. Once you see a
          node of that kind that none of your waypoints marks, they put a waypoint on it named after
          it (“Gold ore node”), walk back to where they refill and end; your realm log notes the
          waypoint, and the find as they end. Holding {num(WAYPOINTS_MAX)} waypoints already, they
          still walk back and end, saying no waypoint was added. Scripts see the nodes you have in
          sight with <code>nodesInSight(kind)</code>.
        </p>
      </Section>

      <Section id="terrain">
        <p>
          An unloaded average resident walks a plains tile in {duration(WALK_TICKS_PER_TILE)}.
          Terrain changes how fast they walk and how much food they burn; lakes and sea can't be
          entered. A road is as fast whatever lies beneath it.
        </p>
        <p>
          Residents and carriages step onto any of the eight tiles around, diagonals too. A diagonal
          step is {num(DIAGONAL_STEP, 2)} times as far, so it takes that much longer on the same
          ground. It can't squeeze between two corners: both straight tiles beside it must be ones
          they could step onto, with no wall, gate in the way, lake, sea, or (for a carriage or
          rider) mountain without a finished road. Two walls touching at a corner close the way like
          a straight stretch.
        </p>
        <table>
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Speed</th>
              <th>Food burnt</th>
              <th>Road work</th>
            </tr>
          </thead>
          <tbody>
            {TERRAIN_NAMES.map((t) => (
              <tr key={t}>
                <td>{t}</td>
                <td>{pct(TERRAIN_SPEED[Terrain[t]]!)}</td>
                <td>{pct(TERRAIN_FOOD[Terrain[t]]!)}</td>
                <td>{t === 'Road' ? '—' : `× ${num(workFactor('road', Terrain[t]))}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Each point of Agility above average walks {pct(AGILITY_SPEED_EFFECT)} faster and takes{' '}
          {pct(AGILITY_TERRAIN_EFFECT)} off a terrain's slowdown (slower below average), each by at
          most {pct(AGILITY_LIMIT)}. Each point of Endurance takes {pct(ENDURANCE_TERRAIN_EFFECT)}{' '}
          off a terrain's extra food, at most {pct(HUNGER_ENDURANCE_LIMIT)}.
        </p>
        <p>
          Example: with Agility {num(strongAgile.stats.agility.base)} a resident crosses a plains
          tile in {duration(1 / walkSpeed(strongAgile, Terrain.Plains, 0))} and a hills tile in{' '}
          {duration(1 / walkSpeed(strongAgile, Terrain.Hills, 0))}, against{' '}
          {duration(1 / walkSpeed(AVERAGE, Terrain.Hills, 0))} at average.
        </p>
      </Section>

      <Section id="residents">
        <p>
          Every resident has four stats: Strength (carrying, work output, building, blows),
          Endurance (food needed, hard terrain), Agility (walking, dodging) and Intellect (how fast
          they learn). A stat is its base value, from {num(STAT_BASE_MIN)} to {num(STAT_BASE_MAX)}{' '}
          for residents nobody passed theirs on to, plus a trained bonus of at most{' '}
          {pct(TRAINED_CAP_SHARE)} of the base. A child's base stats are the parents' average, give
          or take up to {num(CHILD_STAT_SPREAD)}.
        </p>
        <p>
          Skills are learned by doing and never inherited. Work skills and Construction run up to{' '}
          {num(WORK_SKILL_MAX)} points; each point adds {pct(WORK_SKILL_EFFECT)} to output, so a
          master does twice what a beginner does. An average learner gets there after{' '}
          {days(daysToWorkSkillMax)} of work; Intellect speeds learning in proportion (twice the
          Intellect, twice as fast).
        </p>
        <p>
          A pair has one child: once {days(PAIRING_WAIT_DAYS)} have passed since they paired, and
          their city has free housing and a food surplus, one partner carries the child for{' '}
          {days(CARRYING_DAYS)} and doesn't work meanwhile; for another child, pair them again.
          Children age faster: each year up to {num(ADULT_AGE)} takes {days(CHILD_YEAR_DAYS)}, so a
          child is grown after {days(ADULT_AGE * CHILD_YEAR_DAYS)}. From then on a year of age is a
          game year. Until grown, a child walks but doesn't work, build, tear down, drive or pair,
          and of all goods handles only Food: they pick it up, put it down, fetch and store it like
          anyone, so they can carry their meals. At home a child tops up to their own{' '}
          {num(OWN_FOOD)} Food from the storage, so they leave the city with food on them. Stats
          decline from age {num(DECLINE_AGE)} by {pct(DECLINE_PER_YEAR)} a year, never below{' '}
          {pct(DECLINE_FLOOR)}; residents die of old age between {num(LIFESPAN_MIN)} and{' '}
          {num(LIFESPAN_MAX)}. A house holds {num(HOUSING_ROOM.house ?? 0)} residents (a site holds
          nobody yet), and a city's free housing is the room of its houses minus its residents.
          Health runs up to {num(MAX_HEALTH)}.
        </p>
        <p>
          <b>Drifters.</b> A small realm draws newcomers on its own. While your realm has fewer than{' '}
          {num(DRIFTER_REALM_CAP)} residents, your Leader lives, and the city your Leader lives in
          has free housing and a food surplus, a grown drifter sets out for that city every{' '}
          {days(DRIFTER_WAIT_DAYS)}, one at a time; the wait counts only while all of that holds.
          Founding more cities brings no more drifters, and NPC cities, trading posts and the HQ
          draw none. A drifter comes into being out of every Player’s sight,{' '}
          {num(DRIFTER_DISTANCE_MIN)} to {num(DRIFTER_DISTANCE_MAX)} tiles from the town hall, with
          stats and an age like a starting city’s residents and {num(DRIFTER_FOOD)} Food for the
          walk, and walks in. On the way they belong to nobody: they take no orders, and whatever is
          done to them is no crime. Stepping into the city’s area they join it and your realm,
          standing idle, and your realm log names them. If by then the city has no free housing, is
          no longer yours, or your realm has reached the cap, they turn round and are gone once
          nobody sees them. Residents on their way (a drifter, those relocating, children being
          carried) count toward the free housing and the cap. The town hall of your Leader’s city
          says when the next drifter comes, or why none does.
        </p>
        <p>
          <b>Names.</b> A name the game gives a resident, in a starting city, at birth or when they
          join your realm, is one no living resident of that realm has (an NPC city counts as a
          realm of its own); a name it gives a city is one no city in the world has. Once its list
          of names runs dry it adds a numeral, as in “Edda II”. Renaming is free: you can rename any
          resident or city of your realm, and your names may repeat. Names from before this rule
          stay as they were, so where a list holds two residents of one name it adds their age, and
          their city when they live in different ones.
        </p>
        <p>
          A resident lives in one city, wherever they stand. One who lives in none is{' '}
          <b>homeless</b>: their town hall was torn down, or they were away when their city changed
          hands. A homeless resident has no home to refill at and can't pair.
        </p>
        <p>
          Your <b>heir</b> is the one resident you name to carry your realm on. Name them from their
          card (<strong>Leader and heir…</strong>, then <strong>Name heir</strong>) or from a script
          with <code>nameHeir(residentId)</code>; it is free, at once and from anywhere. Who
          qualifies: an adult of your realm who lives in one of its cities, isn't your Leader and
          serves no one else (no mercenary contract or offer naming them, not in the alliance army),
          the same residents a Leader handover allows, but they need not stand by your Leader. You
          have one heir: naming another replaces the first, and <strong>Clear heir</strong> or{' '}
          <code>clearHeir()</code> leaves you with none. The top bar shows your heir, or “No heir”
          to pick one; their card and the Residents list mark them. Only you and your allies see who
          it is. The heir lapses, with a line in your realm log, when they die, leave your realm
          (their city changes hands, or they are handed over), become homeless, are lent out or
          handed to the alliance army, or become your Leader by a handover; then name another.
        </p>
        <p>
          <b>When your Leader dies</b> and you have a living heir (one who is Down counts), the heir
          is your Leader at once and you play on: your realm keeps its name, standing, contracts,
          alliance, scripts and realm log. But it keeps only the city your heir lives in, with its
          residents wherever they stand (those away keep their orders) and everything in it, and the
          horses, carriages and boats nearer it than any other of your cities; outpost storages stay
          yours. Every other city becomes a <b>self-managed city</b> with its residents and the
          horses and carriages nearest it, holding you in good standing at{' '}
          {signed(FORMER_PLAYER_STANDING)}; its soldiers lent out or in the alliance army walk home.
          Your realm then has no heir until you name one. Your realm log and a notice say who took
          over and what became of each city.
        </p>
        <p>
          Without a living heir, or when your heir dies in the same tick as your Leader, your realm
          ends: every city becomes self-managed, your contracts end, you leave your alliance, and
          you start afresh with a new Leader and starting city on your next login. So naming an
          heir, and keeping them safe in a city other than your Leader's, is what keeps a lost
          Leader from costing you everything.
        </p>
        <p>
          <b>Relocate</b> moves any resident of your realm, your Leader, children and homeless ones
          too, to another of your cities: pick it on their card. They walk there and become its
          resident on stepping into its area, at once if they are already in it. You can give the
          order only while the city has free housing for them, counting residents already relocating
          there, so the picker shows each city's free housing and greys out a full one. When they
          arrive the city must still have free housing and still be yours; if not, they stop, keep
          their old city and your realm log says why. Moving ends a pair, as a pair needs one city.
          A partner carrying a child can't relocate until it is born; the other partner can, and the
          child is still born. NPC cities don't relocate anyone. A group relocates from the group
          card, all of them or none: the city needs free housing for the whole group, and on arrival
          each moves in while room lasts, anyone left over keeping their old city.
        </p>
        <p>
          Relocate is a queue step too: <strong>Add step</strong> offers it, and you tap one of your
          cities on the map or pick it from the list. Adding it only checks that the city is yours;
          free housing is checked when its turn comes, and a step that can't start then is skipped
          and noted in your realm log. Once they move in, the next step starts. A script relocates
          with <code>relocate(cityId)</code>, refused for the same reasons as the order; it can{' '}
          <code>wait()</code> on it and then read <code>me.orderEnded</code>: its{' '}
          <code>reason</code> is null once they moved in, else why not. While on their way, their{' '}
          <code>order</code> is <code>"relocate"</code> with the <code>cityId</code> they go to.
        </p>
      </Section>

      <Section id="training">
        <p>
          Residents train their stats and skills at a <b>training ground</b>, a{' '}
          {num(FOOTPRINT.trainingGround)} × {num(FOOTPRINT.trainingGround)} building that goes
          anywhere off Mountain and off resource nodes and belongs to nobody. It is built from{' '}
          {goods(groundCost.materials)} and {duration(groundCost.buildTicks)} of one average
          resident's work. A ground teaches one subject at a time: a stat (Strength, Endurance,
          Agility, Intellect) or a skill (Combat, Mining, …), the one its teacher set.
        </p>
        <p>
          <b>Teach:</b> a grown resident standing on a finished ground teaches there, naming the
          subject: <i>Teach…</i> on their card, a Teach step in a queue, or a script's{' '}
          <code>teach("strength")</code>. A ground has one teacher at a time; walking off or taking
          another order ends the teaching. The teacher gains nothing.
        </p>
        <p>
          <b>Train:</b> a grown resident standing on the ground trains there with the Train task:{' '}
          <i>Train</i> on their card, a Train step in a queue, or a script's <code>train()</code>.
          Up to {num(TRAINING_GROUND_MAX_TRAINEES)} train at a ground at once. They learn only while
          a teacher is there, and only up to a <b>ceiling</b>: never past the teacher's own value,
          and never past their own cap, a stat's trained bonus at most {pct(TRAINED_CAP_SHARE)} of
          its base, a work skill at most {num(WORK_SKILL_MAX)} points. At their ceiling they wait.
          The ground's card lists the teacher and subject, then each trainee with their value and
          their ceiling.
        </p>
        <p>
          The trainee's Intellect sets the pace (twice the Intellect, twice as fast); the teacher's
          level is only the ceiling. An average learner under a better teacher takes a stat's
          trained bonus from nothing to its cap (+{num(trainedCap(AVERAGE_STATS.strength))} on an
          average base of {num(AVERAGE_STATS.strength)}) in {days(trainingDays('strength'))}, a work
          skill to {num(WORK_SKILL_MAX)} in {days(trainingDays('mining'))},{' '}
          {num(TRAIN_SKILL_FACTOR)} times as fast as by working (Construction and Driving train that
          much faster too), and Combat to its most in {days(trainingDays('combat'))}. Training costs
          time and the food trainees eat; nothing trained decays, though old age shrinks a trained
          stat with its base.
        </p>
        <p>
          Players' residents train, by order, queue step or script, and so do the soldiers of a big
          NPC city with a training ground of its own: the one of them with the most Combat teaches,
          or among equals the strongest, and up to {num(TRAINING_GROUND_MAX_TRAINEES)} others train
          in turns of {days(NPC_TRAIN_TURN_TICKS / TICKS_PER_GAME_DAY)}, by the same rules: Combat
          while any of them is below the teacher in it, else Strength. The soldiers its hall and
          gates need stay on their posts, so with too few left the ground stands empty. So it does
          once nobody can learn anything more from the teacher. An alarm takes them from it and they
          come back after. The Trade Organization trains nobody.
        </p>
      </Section>

      <Section id="food">
        <p>
          Residents eat only food they carry. An average resident eats {num(foodEatenPerDay())} Food
          a game day on plains; each point of Endurance above average needs{' '}
          {pct(HUNGER_ENDURANCE_EFFECT)} less (more below), at most {pct(HUNGER_ENDURANCE_LIMIT)}.
          They keep {num(OWN_FOOD)} Food of their own on them, and at home take a meal from the
          storage when they run low. A child at home doesn't wait to run low: whenever they have
          less than their own food, they take meals until they have it again, so a child leaving the
          city has {days(OWN_FOOD / foodEatenPerDay())} of food on them. Within{' '}
          {num(OUTPOST_REFILL_REACH)} tiles of an outpost storage of their realm they take it from
          there the same way, so a stocked outpost storage next to a far workplace keeps its workers
          fed.
        </p>
        <p>
          Far from home, a resident working, building or tearing down goes and gets food on their
          own. Below <code>foodAt</code> units of Food on them ({num(GET_FOOD_AT)} unless you set it
          on their card), they walk to their <code>food</code> storage, else their main storage (
          <code>storage</code> for Work, <code>source</code> for Build, Build line and Tear down),
          else the nearest one of your realm with Food, take Food up to <code>foodTake</code> (
          {num(GET_FOOD_TAKE)} unless set) and go back. Whenever they are at a storage anyway, their
          own food is topped up to <code>foodTake</code> instead of {num(OWN_FOOD)}. With{' '}
          <code>foodAt</code> set to 0 they don't go on their own and rely on refilling.
        </p>
        <p>
          A crew at a far workplace is fed by its carrier: the worker who carries a load to the
          storage brings back the Food the workplace's pile lacks of <code>crewFood</code> (
          {num(CREW_FOOD)} unless set), from their <code>food</code> storage, else their{' '}
          <code>storage</code>, else the nearest one with Food, and puts it on the pile, where the
          crew takes its meals, so nobody else leaves for Food while the pile holds some. A farm's
          pile keeps its own Food instead. <code>crewFood</code> 0 brings none. A resident an NPC
          city sends to a workplace sets out with Food for the walk there and back plus{' '}
          {days(SET_OUT_WORK_DAYS)} of work, not a fixed amount, so they last until the carrier's
          first round trip. Its builders of a site more than {num(NPC_NODE_REACH)} tiles from its
          storage take the same, and go back for more while they still have what the walk home eats;
          so do its workers at a workplace that far out.
        </p>
        <p>
          A full hunger meter lasts {days(HUNGER_DAYS)} without eating; an empty one costs all
          health in {days(STARVE_DAYS)}, so a resident without food goes <b>Down</b>{' '}
          {days(HUNGER_DAYS + STARVE_DAYS)} after their last meal. Fed again before that, they heal
          from nothing to full in {days(HEAL_DAYS)}.
        </p>
        <p>
          Down, a resident lies unconscious on their tile for {days(DOWN_DAYS)}: their order, script
          and queue end, they get off any horse or carriage and leave their army, take no orders,
          don't eat and lose no more health. Anyone in sight sees that they are Down: their token
          lies on its side, and their own Player's card says how long is left. Down is not safe:
          anyone on their tile can pick up what they carry, as from a pile (from another realm's
          resident that is theft), and a blow kills them, as they can't dodge. When the time is up
          they die of hunger. Only hunger puts a resident Down: wounds kill as before, and a Leader
          who is Down still leads. The realm log says when one goes Down, wakes or dies.
        </p>
        <p>
          <b>Reviving:</b> any grown resident of any realm on or next to a Down resident's tile can{' '}
          <b>Feed</b> them: the Feed row on their card (or on the Down resident's tile card), a
          queue step, or <code>feed(targetId, units)</code> in a script. It puts up to that many
          units of the Food in their own hands into the Down resident's ({num(FEED_UNITS)} unless
          set). One unit is eaten at once, and they wake idle with {num(WAKE_HEALTH)} of{' '}
          {num(MAX_HEALTH)} health, which comes back while their hunger meter isn't empty; the rest
          stays in their hands to eat later.
        </p>
        <p>
          NPC cities and the Trade Organization's cities revive their own: while one of their
          residents lies Down in their area or within {num(NPC_REVIVE_REACH)} tiles of it and their
          storage holds Food, one grown resident, never a soldier and a spare hand first, takes Food
          there and Feeds them, one for each resident Down. It comes ahead of building, road crews,
          scouts, work for surplus and what is short, but their farmers stay while Food is short.
        </p>
        <p>
          Food spoils: {pct(FOOD_SPOIL_PER_DAY)} of every stock goes bad each game day, half of it
          in {days(foodHalfLifeDays)}. A city has a food surplus when its storages hold more Food
          than its residents eat in {days(FOOD_SURPLUS_DAYS)}.
        </p>
        <p>
          <b>One average farmer feeds {num(residentsPerFarmer())} residents</b>, themselves
          included: a farmer makes {num(outputPerDay('food', 'farming'))} Food a game day. A horse
          eats {num(HORSE_FOOD_PER_DAY)} Food a game day.
        </p>
      </Section>

      <Section id="work">
        <p>
          Workers make goods in proportion to their Strength, plus {pct(WORK_SKILL_EFFECT)} for each
          point of the workplace's skill. Output lands in the workplace's pile; one worker at a time
          carries a full load to their <code>output</code> storage, else their <code>storage</code>,
          else the nearest storage of their realm.
        </p>
        <p>
          A workplace's card says how much is being made there: what each of your workers there
          makes and how much a game day at their Strength and skill, and the total of each good. It
          is the pace while they have what they need, not a count of what has been made. Other
          realms' workers aren't counted, as their stats aren't known.
        </p>
        <p>
          A smelter, mint or smithy has no storage: it works what its workers carry and what lies in
          its pile. Once they lack the input for a batch (Iron ore, the Iron and Coal of Steel, Gold
          ore, or the Iron and Wood of what a smith makes), one worker at a time, picked at random,
          fetches a load of what is missing from their <code>input</code> storage, else their{' '}
          <code>storage</code>, else the nearest storage of their realm holding it, puts it on the
          pile and goes back to work; not while someone carries the output. With none anywhere they
          stand idle, and their Doing line says what is missing ("Idle: no coal").
        </p>
        <p>
          A smith can also <strong>mend</strong> (Mend on their card, or <code>workAt("mend")</code>
          in a script): they put the most worn weapon, piece of armour or set of Tools at the smithy
          back to good, from what its workers carry, its pile and what anyone of their realm
          standing on it carries. Mending a piece takes {pct(MEND_RECIPE_SHARE)} of its recipe,
          rounded, and at least one unit, and {pct(MEND_WORK_SHARE)} of the work of forging it. Only
          a worn or nearly broken piece is mended; with none there, or without the input, the smith
          stands idle. A worn piece sells and buys for {pct(WORN_PRICE_SHARE)} of a new one's price,
          a nearly broken one for {pct(NEARLY_BROKEN_PRICE_SHARE)}; a trade gives up new pieces
          first, then the least worn. An NPC city counts only gear in good condition towards its
          reserve: its soldiers take worn gear to its smithy, with what mending it takes, and wait
          there while one of its smiths, or a hand from elsewhere, mends it.
        </p>
        <p>
          Work's params on the card: <code>storage</code> is the main storage, used for the output,
          the inputs and Food alike. <code>output</code> (where the output goes), <code>input</code>{' '}
          (where inputs come from) and <code>food</code> (where Food comes from) each take its place
          for that one use when picked; unset, they use <code>storage</code>, and with that unset
          too, the nearest storage of your realm.
        </p>
        <p>
          A worker who carries less Food than <code>foodAt</code> ({num(GET_FOOD_AT)} unless set)
          leaves work for their <code>food</code> storage, else their <code>storage</code>, else the
          nearest storage of your realm with Food, takes Food up to <code>foodTake</code> (
          {num(GET_FOOD_TAKE)} unless set) and comes back. With no Food anywhere they work on.
          Carrying a load tops their food up to <code>foodTake</code> too, and the carrier brings
          back what the workplace's pile lacks of <code>crewFood</code> ({num(CREW_FOOD)} unless
          set) for the crew's meals, so a worker with Food on the pile stays. <code>foodAt</code> 0
          turns getting food off, <code>crewFood</code> 0 the crew's Food.
        </p>
        <p>
          Work can be run directly too, with Run script or as a queue step: they work the workplace
          in its <code>workplace</code> param, or with none picked the one they stand on when it
          starts. Giving Work on a workplace fills it. It is never kept: each start works what it is
          given or where they stand, so a queue can walk them to a workplace and then run Work
          there. The workplace can be anyone's you know, out of sight too: they walk to where you
          last saw it. With no workplace there, once theirs is gone, or when they find it held by
          another realm's workers with no room left, Work ends and your realm log says why.
        </p>
        <p>
          Work on a workplace that is still a construction site builds it first, as Build would,
          with materials from the nearest storage of your realm that holds them, and once it is
          finished they work it without another order. Pick the site for Work on the card or as a
          queue step.
        </p>
        <table>
          <thead>
            <tr>
              <th>Workplace</th>
              <th>Makes a game day</th>
              <th>Skill</th>
              <th>Workers</th>
            </tr>
          </thead>
          <tbody>
            {NODE_WORK.map(({ kind, good }) => (
              <tr key={good}>
                <td>{kindName(kind)}</td>
                <td>
                  {num(WORK_OUTPUT_PER_DAY[good] ?? 0)} {goodName(good)}
                </td>
                <td>{skillName(kind)}</td>
                <td>{num(WORKPLACE_MAX_WORKERS[kind] ?? 0)}</td>
              </tr>
            ))}
            {(Object.keys(RECIPES) as BuildingKind[]).flatMap((kind) =>
              RECIPES[kind]!.map((r, i) => (
                <tr key={`${kind}${i}`}>
                  <td>{kindName(kind)}</td>
                  <td>
                    {goods(r.output)} from {goods(r.input)}, {num(BATCHES_PER_DAY[kind] ?? 0)} times
                  </td>
                  <td>{skillName(kind)}</td>
                  <td>{num(WORKPLACE_MAX_WORKERS[kind] ?? 0)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <h3>Tools</h3>
        <p>
          <strong>Tools</strong> are a good a smithy makes: {num(forged('tools').input.iron ?? 0)}{' '}
          Iron and {num(forged('tools').input.wood ?? 0)} Wood make a set, which weighs{' '}
          {num(GOOD_WEIGHT.tools ?? 0)} kg. Iron only. A resident carrying a set works{' '}
          {pct(TOOLS_WORK_BONUS)} faster: at a workplace they make that much more, and at a
          construction site they build, tear down and repair that much faster. Without Tools they
          work at the plain pace, so nothing stops for want of them. They aren't equipped: carrying
          one set is enough, a second adds nothing, and nobody else sees them. A workplace's card
          counts them in what each of your workers makes.
        </p>
        <p>
          Tools wear with each day's work and break after about {days(TOOLS_WORK_DAYS)} of it; their
          condition reads like a weapon's (Wear). Warehouses buy and sell them like any good (a
          floor of {num(WAREHOUSE_FLOOR.tools ?? 0)}).
        </p>
        <h3>Production chains</h3>
        <ul>
          <li>One farmer feeds {num(residentsPerFarmer())} residents.</li>
          <li>
            {num(minersPerSmelterWorker())} iron miners keep one smelter worker busy, who makes{' '}
            {num(batchesPerDay('smelter') * (RECIPES.smelter![0]!.output.iron ?? 0))} Iron a game
            day.
          </li>
          <li>
            {num(goldMinersPerMintWorker())} gold miners keep one mint worker busy, who strikes{' '}
            {num(coinsPerMintWorkerDay())} Coins a game day.
          </li>
        </ul>
        <h3>Coins per worker-day</h3>
        <p>
          What a day's work fetches at a warehouse's base price, and at the {pct(BUY_SHARE)} of it a
          warehouse pays when it buys. For smelters, mints and smithies, the value added is the
          output less what went into it, both at the base price.
        </p>
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Makes a game day</th>
              <th>Base price</th>
              <th>Warehouse pays</th>
              <th>Value added</th>
            </tr>
          </thead>
          <tbody>
            {jobDays().map((j, i) => (
              <tr key={i}>
                <td>{j.job}</td>
                <td>
                  {goods(j.makes)}
                  {Object.keys(j.uses).length > 0 && ` from ${goods(j.uses)}`}
                </td>
                <td>{num(j.sell)}</td>
                <td>{num(j.buy)}</td>
                <td>{num(j.added)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Example: a miner with Strength {num(strong.stats.strength.base)} and Mining{' '}
          {num(strong.skills.mining ?? 0)} digs {num(outputPerDay('ironOre', 'mining', strong))}{' '}
          iron ore a game day, against {num(outputPerDay('ironOre', 'mining'))} at average.
        </p>
      </Section>

      <Section id="zeal">
        <p>
          <strong>Zeal</strong> is yours, not your realm's: a pool that fills in real time, whether
          you are online or not, from empty to full in about {num(zealFillRealHours())} real hours.
          A full pool holds {num(ZEAL_CAP_HOURS)} game hours of rallying, about{' '}
          {num(zealFullRealMinutes())} real minutes. A new Player starts with it full, and a Leader
          handover or your Leader's death keeps it. The meter in the top bar shows how full it is,
          and while it drains.
        </p>
        <p>
          <strong>Rally the crew</strong> is an order for your Leader alone. Stand them at a
          workplace or a construction site and pick Rally the crew on their card or the building's:
          everyone of your realm working there, or building, tearing down or repairing there, works
          at {num(RALLY_PACE)} times their pace, on top of their skill, Strength and Tools. Your
          Leader does no work of their own meanwhile. Zeal drains a game hour of rallying for every
          game hour, only while somebody is being rallied, and goes on filling meanwhile; the
          building's card says about how long it lasts. Only work is faster: not walking, carrying,
          fetching, training or fighting.
        </p>
        <p>
          It ends when you stop it or give your Leader another order, when they leave the building,
          are struck or go Down, or when the Zeal is used up. Whatever Zeal is left stays. A blow
          ends it for good: it doesn't come back after the defence script.
        </p>
        <p>
          It is given by hand only. No script can rally the crew and it can't be a queue step: the
          game API has no call for it, as a script would spend the pool the moment it filled.
        </p>
      </Section>

      <Section id="gathering">
        <p>
          A grown resident takes <strong>Wood</strong> or <strong>Food</strong> from a Forest tile
          they stand on, or <strong>Stone</strong> from a Hills tile, straight into their hands: no
          node, no workplace. Not on a tile with a building, a road, a construction site or a
          resource node on it. Iron ore, Gold ore and Coal are never gathered. An average resident
          gathers {num(GATHER_PER_DAY.wood ?? 0)} Wood, {num(GATHER_PER_DAY.food ?? 0)} Food or{' '}
          {num(GATHER_PER_DAY.stone ?? 0)} Stone a game day: more than working a poor node (
          {num((WORK_OUTPUT_PER_DAY.wood ?? 0) * RICHNESS_FACTOR.poor)} Wood), less than a normal
          one ({num(WORK_OUTPUT_PER_DAY.wood ?? 0)} Wood). Strength, the good’s skill (Woodcutting,
          Farming, Mining) and Tools count as they do at a workplace, and gathering teaches that
          skill.
        </p>
        <p>
          <strong>Patches.</strong> Each Forest and Hills tile holds {num(PATCH_SIZE)} units for
          gathering, about one load, shared by everyone and by Wood and Food alike. Once it is gone
          the tile is <strong>picked over</strong> and gives nothing. Once nobody has gathered there
          for {days(PATCH_REST_DAYS)}, it grows back steadily, from empty to full in{' '}
          {days(PATCH_REGROW_DAYS)}. So the land beside a city empties under a few gatherers, while
          a workplace on a node never runs out. The tile card says what a tile gives and, while it
          is in sight, how much is left or when it is full again; up close the map shows picked-over
          tiles in sight thinned out.
        </p>
        <p>
          <strong>The Gather task.</strong> Gather on a resident’s card, on the group card, as a
          queue step or from the realm bar asks what to gather first. The resident walks to the
          nearest tile within {num(GATHER_REACH)} tiles of where they started that gives it and
          isn’t picked over as far as they can see, gathers until their hands are full or the patch
          is gone, and goes on to the next tile; with a full load they store it at their{' '}
          <code>storage</code>, else the nearest storage of your realm, and come back. Several
          gatherers take different tiles. With no such tile left in reach they store what they carry
          and end, saying why. The usual food params work as in Work. In a script,{' '}
          <code>gather(good)</code> gathers on the tile you stand on, and a tile’s{' '}
          <code>pickedOver</code> says whether its patch is gone.
        </p>
      </Section>

      <Section id="building">
        <p>
          A construction site becomes its building once its materials are there and builders have
          put in its work. Until then the site belongs to the realm whose resident laid it out, so
          that realm's scripts and params can pick it; finished, the building belongs where its kind
          does (a city's, or an outpost storage). Building goes in proportion to Strength, plus{' '}
          {pct(CONSTRUCTION_SKILL_EFFECT)} for each point of Construction (at most{' '}
          {num(CONSTRUCTION_SKILL_MAX)}, learned at {num(CONSTRUCTION_SKILL_PER_DAY)} a game day);
          more builders finish sooner. A crew sent to work, build or breed at a building stands
          spread over its footprint: each goes to the tile with the fewest of the crew on it, the
          nearest on ties, and which tile they stand on changes nothing else. Tearing down takes{' '}
          {pct(TEARDOWN_WORK_SHARE)} of the work and leaves {pct(TEARDOWN_MATERIALS_RETURNED)} of a
          building's materials on the tile (all of an unfinished site's). A road over a mountain
          can't be torn down while a carriage or a ridden horse stands on it: the work waits until
          they leave. A horse left there unridden can't be ridden off a road.
        </p>
        <p>
          Building is given from a resident’s card or a group card (where to build, then what), or
          in realm control mode from Build on the realm bar: what, then where, then who builds it,
          picked from the who-list (see Controls, Control modes).
        </p>
        <p>
          Tear down can be run directly too, with Run script or as a queue step: they tear down the
          building or site in its <code>building</code> param, walking there first, or with none
          picked the one they stand on when it starts. Giving Tear down on a building fills it; it
          is never kept between starts. With no building there, Tear down ends and your realm log
          says why.
        </p>
        <table>
          <thead>
            <tr>
              <th>Building</th>
              <th>Size</th>
              <th>Materials</th>
              <th>One builder</th>
              <th>Tearing down</th>
              <th>Left when torn down</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...buildCosts().map((b) => ({ ...b, name: kindName(b.kind) })),
              ...stoneWallCosts(),
            ].map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td>
                  {num(b.footprint)}×{num(b.footprint)}
                </td>
                <td>{goods(b.materials)}</td>
                <td>{duration(b.buildTicks)}</td>
                <td>{duration(b.teardownTicks)}</td>
                <td>{goods(b.returned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Decay and repairing</h3>
        <p>
          Every finished building, wall, gate and road slowly loses its <strong>condition</strong>,
          used or not: an even share at the turn of each game day, faster for roads and the wooden
          walls and gates, slowest for those mostly of stone. Blows from attackers are apart from
          this (see <a href="#combat">Combat</a>). Its tile card says how it stands: good, then{' '}
          <strong>worn</strong> once it has lost {pct(DECAY_WORN)}, then{' '}
          <strong>nearly a ruin</strong> once it has lost {pct(DECAY_NEARLY_RUIN)}. Everyone who
          sees a building sees its condition; scripts read it as <code>building.condition</code>. A
          city left alone for a real month is still there: its buildings may be worn, but none has
          fallen to ruin from decay alone. That is all the game does for an absent Player: Food and
          defence while you are away are your own setup, with work scripts that give every resident
          access to Food and your defence scripts.
        </p>
        <p>
          A worn building can be <strong>repaired</strong>: pick a resident, then the building's
          tile, and <em>Repair</em> on its tile card. They run your Repair default: it walks them
          there, and while the repair lacks materials they carry none of, they fetch what it lacks
          from its <code>source</code> param, or the nearest storage of your realm holding some. A
          repair takes {pct(REPAIR_MATERIALS_SHARE)} of the building's materials (rounded up) and{' '}
          {pct(REPAIR_WORK_SHARE)} of its work, and puts it back to good. With none of the materials
          in any storage, Repair ends and your realm log says why. Anyone's building can be
          repaired. Scripts repair with <code>repair(buildingId)</code> on the building's tile and
          ask what it lacks with <code>repairNeeded(building)</code>.
        </p>
        <p>
          Some repair <strong>on their own</strong>. A resident running your Build default with no
          construction site to join (none picked, none on their tile) repairs the worn buildings in
          their city's area instead, worst first, then nearest, one after another, fetching the
          materials as above; with none left the script ends. Buildings further off take a Repair
          order. Scripts find what needs repairing with <code>wornBuildings(cityId)</code>. An NPC
          city's builders repair its buildings and its road crew its roads, worst first, from what
          its storage holds above its reserve. The Trade Organization repairs its own from its stock
          at the turn of each day, so the HQ and its trading posts never fall to ruin while it
          stands.
        </p>
        <table>
          <thead>
            <tr>
              <th>Building</th>
              <th>Worn after</th>
              <th>All gone after</th>
              <th>Repair materials</th>
              <th>Repair, one builder</th>
              <th>Rebuild materials</th>
              <th>Rebuild, one builder</th>
            </tr>
          </thead>
          <tbody>
            {decayRows().map((b) => (
              <tr key={b.kind}>
                <td>{kindName(b.kind)}</td>
                <td>
                  {num(Math.ceil(b.days * DECAY_WORN))} game days (
                  {realTimeOf(Math.ceil(b.days * DECAY_WORN) * TICKS_PER_GAME_DAY)})
                </td>
                <td>
                  {num(b.days)} game days ({realTimeOf(b.days * TICKS_PER_GAME_DAY)})
                </td>
                <td>{goods(repairMaterials(b.kind))}</td>
                <td>{duration(repairWork(b.kind))}</td>
                <td>{goods(rebuildMaterials(b.kind))}</td>
                <td>{duration(rebuildWork(b.kind))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Ruins and collapse</h3>
        <p>
          A building nobody repaired, once it has lost all its condition, becomes a{' '}
          <strong>ruin</strong>. It still stands where it stood and takes up its tiles, but does
          nothing: a ruined wall or gate tile is a gap anyone walks through, a house houses nobody,
          a workplace makes nothing, a stable or training ground is no use, a ruined road is no
          road, and a storage takes nothing in. Goods in a ruined storage stay in it, but anyone at
          it can take them out, guarded or not: taking another organization's is theft. On the map a
          ruin shows faded and grey, and its tile card says it is one.
        </p>
        <p>
          A ruin is <strong>rebuilt</strong> like a repair, with <em>Rebuild</em> on its tile card
          or <code>repair(buildingId)</code>, for {pct(REBUILD_MATERIALS_SHARE)} of its materials
          and {pct(REBUILD_WORK_SHARE)} of its work: less than a new one. Left{' '}
          {num(RUIN_COLLAPSE_DAYS)} game days ({realTimeOf(RUIN_COLLAPSE_DAYS * TICKS_PER_GAME_DAY)}
          ) more it <strong>collapses</strong>: it is gone, and {pct(COLLAPSE_MATERIALS_LEFT)} of
          its materials (rounded down), with any goods still in it, lie on its tiles as a pile. A
          town hall that collapses ends its city, as when it is torn down. Scripts read a ruin's{' '}
          <code>building.condition</code> as <code>"ruin"</code>.
        </p>
        <p>
          A city building (town hall, house, storage, wall, gate) belongs to a city when it stands
          within {num(CITY_BUILDING_REACH)} tiles of its town hall or of another of its buildings;
          the city's area reaches {num(CITY_AREA_MARGIN)} tiles around them. A house goes only in a
          city's area; a town hall, storage, wall or gate goes anywhere off Mountain and off
          resource nodes, and a new town hall founds a city. A training ground goes anywhere off
          Mountain and off resource nodes too, and like a workplace it belongs to nobody; what
          happens there is under <a href="#training">Training</a>.
        </p>
        <p>
          A resident building or tearing down who carries less Food than <code>foodAt</code> (
          {num(GET_FOOD_AT)} unless set) goes to their <code>food</code> storage, else their{' '}
          <code>source</code>, else the nearest storage of your realm with Food, takes Food up to{' '}
          <code>foodTake</code> ({num(GET_FOOD_TAKE)} unless set) and comes back to the site. With
          no Food anywhere they work on. Fetching materials tops their food up to{' '}
          <code>foodTake</code> too, before the materials. <code>foodAt</code> 0 turns this off.
        </p>
        <p>
          Build can be run directly too, with Run script or as a queue step: they join the
          construction site in its <code>site</code> param, or with none picked the one they stand
          on when it starts. Laying out a new site (what and where) is only the Build order's.
          Giving Build on a site your residents laid out fills <code>site</code>; it is never kept,
          so a queue can walk them to a site and then run Build there. With no construction site
          there, Build ends and your realm log says why.
        </p>
        <p>
          <strong>Build line</strong> builds road or wall along a line: on a resident's card pick{' '}
          <em>Build line: road</em> or <em>Build line: wall</em>, then the tile where the line
          starts and the one where it ends, straight or diagonal, at most {num(ROAD_LINE_MAX_TILES)}{' '}
          tiles. The resident walks to the line themselves and builds its tiles one at a time, the
          nearest still to build first; tiles that have one already, or can't take one, are skipped.
          What they carry goes in first. Lacking materials for their tile, they fetch them from
          their <code>source</code>, or the nearest storage of your realm holding them, as much as
          they can carry for this tile and the next ones, topping up their own food there too. With
          none in any storage they lay out each tile's site and go on to the next; once the whole
          line is laid out or built they stop, and your realm log says why (“no stone in any
          storage”), so the line shows and can be finished later. In the queue planner,{' '}
          <strong>Add step</strong> offers Build line too: pick both ends on the map. No walk goes
          before it, since the builder walks to the line, and it ends on its own, so it needs no
          duration; a saved queue or a copied step keeps both tiles. Build line has Build's params;
          its line comes only from the order, so run directly or with Run script it ends at once
          (“no line given”). The plain <code>roadLine</code> and <code>wallLine</code> actions,
          which build only with what the resident carries, stay for your scripts.
        </p>
        <p>
          <strong>A crew on one line:</strong> residents on the same line, from the group card or
          given it one by one, each take the nearest tile still to build that no other of them has
          taken, so several tiles go up at once; each fetches their own materials. With every tile
          left taken by the others, a builder waits, and they all stop once the line is finished.
        </p>
        <p>
          In <a href="#controls">realm control mode</a> a line starts from the realm bar instead:{' '}
          <strong>Road</strong> or <strong>Wall</strong> (wood or stone, on the banner), then where
          the line starts and where it ends, with the same preview. A line too long, or with no tile
          left to build, says why and you pick its end again. Then the who-list shows your residents
          with their way to the line’s tile nearest them, the nearest {num(WHO_SUGGESTS.line)} idle
          ones ticked; those you confirm get Build line as a crew.
        </p>
        <p>
          A storage in a city's area is that city's storage. One outside any city is an{' '}
          <strong>outpost storage</strong>: it belongs to the realm whose residents finished it and
          counts as a storage of your realm everywhere (Store, Fetch, carrying the output, fetching
          materials, haul route stops, <code>storages()</code> and <code>storage</code> params). It
          founds no city and has no area. A city that grows over it takes it in; a storage cut off
          from its city, or left when its town hall is torn down, stays an outpost storage of that
          city's realm. What it holds is seen only by its realm and its allies, and by anyone
          standing at it. Residents of your realm within {num(OUTPOST_REFILL_REACH)} tiles of it
          take a meal from it when they run low, as at home.
        </p>
        <p>
          An outpost storage is guarded like a workplace: while an armed resident of its realm
          stands on or next to it and nobody else's armed resident does, only its realm can take
          from it. Unguarded, anyone at it can pick up from it; for another organization that is
          theft, and tearing it down is a crime too (see Standing).
        </p>
      </Section>

      <Section id="transport">
        <p>
          A resident carries {num(CARRY_BASE)} kg plus {num(CARRY_PER_STRENGTH)} kg for each point
          of Strength: {num(AVERAGE_CARRY)} kg at average, {num(carryCapacity(strong, 0))} kg with
          Strength {num(strong.stats.strength.base)}. A carriage behind an average horse carries{' '}
          {num(CARRIAGE_CAPACITY)} kg; each point of its driver's Driving skill makes it{' '}
          {pct(DRIVING_SKILL_EFFECT)} faster, at most {pct(DRIVING_SKILL_LIMIT)}, learned at{' '}
          {num(DRIVING_SKILL_PER_DAY)} a game day of driving. Carriages enter mountains only along a
          finished road, so a road over a ridge opens a pass for them.
        </p>
        <p>
          A carriage is built at a finished stable: a resident there lays out a carriage site on a
          tile of the stable, or right next to it, that has no carriage site yet. It takes{' '}
          {goods(carriageCost().materials)} and {duration(carriageCost().buildTicks)} of one
          builder's work, fetched and built like any construction site, and whoever finishes it gets
          an empty carriage of their realm, with no horse hitched until it is first driven. Torn
          down before it is finished, it leaves all the materials delivered to it.
        </p>
        <p>
          The first time a carriage is driven, a free horse of its realm standing with it is
          hitched, and it stays hitched until <strong>Unhitch horse</strong>: any grown resident of
          the carriage's realm standing on its tile can unhitch it, from their card, the carriage's
          tile card, the group card, as a queue step or with a script's{' '}
          <code>unhitch(carriage)</code>. The horse then stands free on the tile, to be ridden or
          led into a stable, and a carriage being driven stops where it is. The carriage stands
          there until it is next driven, when a free horse of the realm standing with it is hitched
          again. A carriage whose horse dies waits the same way.
        </p>
        <p>
          To choose the horse, use <strong>Hitch horse</strong>: any grown resident of the
          carriage's realm standing on its tile can hitch a horse of the realm there that pulls no
          carriage, nobody rides and isn't Down. Their card lists those horses with name, stats and
          age, also when only one stands there; it is a queue step too, and a script's{' '}
          <code>hitch(carriage, horse)</code>. It happens at once, and a horse already hitched
          stands free on the tile. A carriage being driven goes on with the new horse. Hitching only
          takes your realm's own horses; stealing one stays with driving and mounting.
        </p>
        <p>
          A grown resident on the tile of another realm's or city's carriage can steal it: its card,
          or the resident's, offers <strong>Drive off (theft)</strong>, and a script's{' '}
          <code>drive</code> naming that carriage does the same. The carriage joins your realm at
          once, with its load and hitched horse; with no horse hitched, a free horse of yours on the
          tile pulls it, or else a free horse of someone else's there, stolen with it. It can't be
          taken while someone drives it or anyone is aboard, nor while an armed resident of its
          owner stands on the tile and none of your realm does. A caravan's carriage also can't be
          driven off while its crew hold it (see Deliveries and transfers). Nothing that picks a
          carriage by itself ever does this, and a queue step keeps to your own carriages, as do
          hauling and group orders. Its owner's realm log says at once that it is gone and where it
          was last; who took it they learn only from a witness (see Standing). One that belongs to
          nobody is simply yours. A carriage handed over to an alliance army is its commander's to
          drive, which is no theft. A boat is stolen the same way, by rowing it off from beside it
          (see Water &amp; havens).
        </p>
        <p>
          A carriage's card shows its load as a bar against what it holds (its passengers counted
          in) over its goods, its driver and passengers by name, the haul route it drives as “first
          stop → second stop” with the leg it is on and about when it arrives, and its horse with
          its health and hunger and how long the Food on board feeds it. Another realm's carriage
          shows only how heavily it is loaded, and its horse without how it fares.
        </p>
        <table>
          <thead>
            <tr>
              <th>Goods</th>
              {(Object.keys(GOOD_WEIGHT) as Good[]).map((g) => (
                <th key={g}>
                  <span className="good-label">
                    <GoodIcon good={g} />
                    {goodName(g)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>kg a unit</td>
              {(Object.keys(GOOD_WEIGHT) as Good[]).map((g) => (
                <td key={g}>{num(GOOD_WEIGHT[g])}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p>
          Cards show goods as these icons, each with its amount; hover over one, or press and hold
          it on a phone, for its name. That goes for every inventory: what a resident carries, a
          carriage's load, a storage's or stable's goods and a pile; a trade's prices name each good
          beside its icon. On a resident's card their own food (up to {num(OWN_FOOD)} Food) shows
          apart at the end, marked <em>own</em>. A construction site's card shows its work done as a
          bar with about how long is left at the pace of those building it, then a row per material:
          what was delivered against what it needs, with a small bar. A workplace's card shows its
          pile and its crew, one row each with what they are doing: working, carrying a load,
          fetching, or on the way.
        </p>
        <h3>Moving goods, per game hour</h3>
        <table>
          <thead>
            <tr>
              <th>Terrain</th>
              <th>On foot, tiles</th>
              <th>On foot, kg × tiles</th>
              <th>Carriage, tiles</th>
              <th>Carriage, kg × tiles</th>
            </tr>
          </thead>
          <tbody>
            {transport().map((t) => (
              <tr key={t.terrain}>
                <td>{t.terrain}</td>
                <td>{num(t.footTiles, 1)}</td>
                <td>{num(t.footKgTiles, 0)}</td>
                <td>
                  {t.carriageTiles
                    ? num(t.carriageTiles, 1)
                    : t.terrain === 'Mountain'
                      ? 'only on a road'
                      : 'can’t enter'}
                </td>
                <td>{t.carriageTiles ? num(t.carriageKgTiles, 0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          A road tile takes {goods(BUILD_MATERIALS.road ?? {})} and{' '}
          {duration(buildCosts().find((b) => b.kind === 'road')!.buildTicks)} of one builder's work.
          It goes on any land a resident can walk, mountains too: there it takes the same materials
          but {num(MOUNTAIN_ROAD_WORK_FACTOR)} times the work, to build and to tear down (the road
          work column above). Roads are built along a line with <strong>Build line</strong> (see{' '}
          <a href="#building">Building</a>): at most {num(ROAD_LINE_MAX_TILES)} tiles, straight or
          diagonal. A wall is built along a line the same way, past tiles with a wall or gate
          already; a diagonal wall line closes the way like a straight one.
        </p>
        <p>
          A wall or gate is of <strong>wood</strong> or <strong>stone</strong>: pick which in the
          Build menu, or on the banner while picking a wall line's ends (wood unless you pick
          stone). Stone takes Stone instead of Wood and more work (the stone rows above), and it
          holds out several times longer against blows (see <a href="#combat">Combat</a>); it is no
          higher, with the same wall walk and cover. On the map a stone tile shows a grey block in
          its colour, and its card says what it is of. Scripts pass <code>"stone"</code> to{' '}
          <code>build</code> and <code>wallLine</code>.
        </p>
        <p>
          <strong>Upgrading to stone.</strong> A stone wall or gate can be laid out on a wooden one
          of its kind: stand on it, pick Stone in the Build menu and Build. The wooden one stands,
          with its wall walk, and can be defended until the stone one is finished and takes its
          place; whoever is up on it stays up, and its Wood goes into the new one. A stone wall line
          upgrades the wooden walls and gates on its way, a gate to a stone gate, and passes only
          those already of stone; a wooden line passes both. Breaking the wooden one while the stone
          site stands leaves the site.
        </p>
        <p>
          {' '}
          The tiles your residents' road and wall lines still have to build, running or waiting in
          their queues, show faintly on your map, the picked residents' stronger; only you see them.
        </p>
        <p>
          An average horse eats {num(HORSE_FOOD_PER_DAY)} Food a game day, from a stable, the
          carriage's load or food on the ground next to them, and a ridden horse after that from the
          Food its rider carries beyond their own {num(OWN_FOOD)}. A stable holds up to{' '}
          {num(STABLE_CAPACITY)} horses. A haul route keeps {num(HAUL_KEEP_FOOD)} Food on board for
          its horse and its driver, {num(HAUL_HORSE_FOOD)} of it the horse's share.
        </p>
        <p>
          The route (where to, which goods) comes only from the Haul order, which also fills the
          Haul default's <code>carriage</code> param. Run directly, with Run script or as a queue
          step, Haul has no route: it ends at once and your realm log says “no route given”.
        </p>
        <h3>A horse going Down</h3>
        <p>
          A horse goes hungry like a resident: with nothing in reach it goes <b>Down</b>{' '}
          {days(HUNGER_DAYS + STARVE_DAYS)} after its last meal and lies there for {days(DOWN_DAYS)}
          . Down, it doesn't move: its rider is on foot again, and the carriage it pulls stands
          where it is, its drive or haul route ending; nobody can mount or drive it. It still eats
          Food in reach, so put Food down on its tile or right next to it, or Feed it (below). Once
          it has eaten, it gets up with {num(HORSE_WAKE_HEALTH)} health of {num(MAX_HEALTH)} and
          heals from there. When the time is up first, it dies. Its token lies on its side, the
          Horses drawer, the stable and the tile card say it is Down and how long is left, and your
          realm log says when one of your horses goes Down and when one dies.
        </p>
        <h3>Feeding a horse</h3>
        <p>
          Any grown resident of any realm on or next to a horse's tile can <b>Feed</b> it, whoever's
          it is and Down or not, as long as it isn't full: the Feed row on their card (or on the
          horse's tile card), a queue step, or <code>feed(targetId, units)</code> in a script.
          Horses have no inventory, so it eats from their hands at once, a whole unit at a time,
          until its hunger meter has no room for another whole unit, which is what full means here,
          so no Food is wasted. It eats up to the units asked for ({num(FEED_UNITS)} unless set);
          the rest stays with them. A full meter holds {num(HUNGER_DAYS * HORSE_FOOD_PER_DAY)}{' '}
          units. Feeding another realm's horse is no crime. Another realm's horse doesn't show how
          it fares, so the card offers it unless it is known to be full, and the order says so if it
          is. With more than one to choose from, those Down come first and say so, then those known
          to be hungry.
        </p>
        <h3>Breeding</h3>
        <p>
          Horses don't breed on their own. A grown resident standing at a finished stable is given
          Breed horses and picks two fed horses of their realm in it, each shown with its name and
          stats; they tend them for {days(STABLE_BREED_DAYS)}, and then a foal of their realm is
          born in the stable. Each of its stats is its parents' average, give or take{' '}
          {num(FOAL_STAT_SPREAD)}. The progress belongs to the two horses, and the stable keeps it:
          breeding pauses when the resident leaves or is given another order, or while the stable
          has no room left for the foal, and any grown resident who breeds there later carries on
          with that pair first, where it stopped, if both are still fed. The stable's card shows a
          paused breeding and how far along it is, and the resident's Doing line names the two they
          tend. The progress is lost only when one of the two leaves the stable or dies. The Breed
          horses default first takes {num(BREED_FOOD)} Food from the stable for the resident's
          meals, if they carry less. NPC cities have one of their residents breed their horses the
          same way.
        </p>
        <p>
          Breed horses can be run directly too, with Run script or as a queue step: they breed in
          the stable in its <code>stable</code> param, walking there first, or with none picked the
          one they stand in when it starts. They pick the pair themselves, a paused pair in that
          stable first, else two fed horses of your realm in it. Giving Breed horses in a stable
          fills the param; it is never kept between starts. With no stable there, or no two fed
          horses in it, Breed horses ends and your realm log says why.
        </p>
        <h3>Horse names</h3>
        <p>
          Every horse has a name, given by the game when it comes into being: in a starting city, at
          the Trade Organization, as a foal, or from the Horse grant or offer. You can rename any
          horse of your realm, free and at once, from anywhere: with <strong>Rename</strong> on the
          card of the tile it stands on, or a script's <code>renameHorse(horse, name)</code>. A name
          takes up to {num(HORSE_NAME_MAX_LENGTH)} characters and need not be unique. The name shows
          on the tile card, the stable, the carriage it pulls, its rider's card and the realm log,
          and scripts see it as <code>horse.name</code>.
        </p>
        <h3>Horses drawer</h3>
        <p>
          The <strong>Horses</strong> button on the tool rail (in the menu on a phone) opens a list
          of your realm's horses, like the Residents drawer does for residents. They are grouped by
          where they stand: under each stable they are in (by its city), then Hitched to a carriage,
          Ridden and Loose. Each row shows the horse's name and where it is (“Pulling the carriage
          Ann drives”), its Speed, Strength and Endurance, its age, and its health and hunger. Click
          a row to centre the map on the horse and open the card of its tile, or of its rider.
        </p>
        <h3>Horse stats</h3>
        <p>
          Every horse has Speed, Strength and Endurance, and an age. A new horse's stats are whole
          numbers from {num(HORSE_STAT_MIN)} to {num(HORSE_STAT_MAX)}, and it is{' '}
          {num(HORSE_START_AGE_MIN)} to {num(HORSE_START_AGE_MAX)} game years old; a horse's stats
          never change. Away from the average of {num(HORSE_STAT_AVERAGE)}, each point of Speed
          makes its carriage {pct(HORSE_SPEED_EFFECT)} faster (slower below), at most{' '}
          {pct(HORSE_SPEED_LIMIT)}; each point of Strength lets its carriage hold{' '}
          {pct(HORSE_STRENGTH_EFFECT)} more (less below), at most {pct(HORSE_STRENGTH_LIMIT)}, so up
          to {num(CARRIAGE_MAX_CAPACITY)} kg; each point of Endurance means{' '}
          {pct(HORSE_ENDURANCE_EFFECT)} less Food (more below), at most {pct(HORSE_ENDURANCE_LIMIT)}
          .
        </p>
        <table>
          <thead>
            <tr>
              <th>Stat</th>
              <th>Carriage on plains, tiles a game hour</th>
              <th>Carriage holds, kg</th>
              <th>Food a game day</th>
            </tr>
          </thead>
          <tbody>
            {[HORSE_STAT_MIN, HORSE_STAT_AVERAGE, HORSE_STAT_MAX].map((v) => (
              <tr key={v}>
                <td>{num(v)}</td>
                <td>{num(horseRow(v).plainsTiles, 1)}</td>
                <td>{num(horseRow(v).capacity, 0)}</td>
                <td>{num(horseRow(v).food, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Riding</h3>
        <p>
          A resident on a tile with a free horse can mount it, and dismount anywhere; the horse
          stays where they get off. Another realm's or city's is stolen by that (below). A rider
          goes wherever they walk at the speed the horse would pull a carriage there (the carriage
          column above), never up onto walls, and into mountains only along a finished road, like a
          carriage. A horse with less than {pct(HORSE_HUNGRY_SHARE)} of its hunger meter left goes
          at {pct(HUNGRY_HORSE_PACE)} of its pace. Riding trains Driving like driving does, and
          Driving makes riding faster. A rider carries no more than on foot, and can't drive a
          carriage; a ridden horse is never hitched. A hungry ridden horse eats Food on the ground
          in reach first, then what its rider carries beyond their own {num(OWN_FOOD)} Food: the
          rider never goes without for the horse, so give a rider extra Food for a long ride. When a
          ridden horse goes hungry with nothing to spare, your realm log says so. On the map a rider
          sits on a horse token, and up close their activity icon is a horseshoe while they ride
          somewhere.
        </p>
        <p>
          A rider’s Doing line says <em>Riding to …</em> where it would say <em>Walking to …</em>,
          and their card shows the horse they ride: its stats, age, health and hunger, and that it
          eats from their spare Food, with <strong>Dismount</strong> under Orders.
        </p>
        <p>
          A grown resident on the tile of another realm's or city's free horse can steal it: its
          card, or the resident's, offers <strong>Mount their horse (theft)</strong>, and a script's{' '}
          <code>mount</code> naming that horse does the same. A carriage of yours with no horse of
          yours there can take it too: <strong>Drive with their horse (theft)</strong> hitches it,
          and a script's <code>drive</code> does so if it names the horse. A horse of yours on the
          tile always goes first and nothing is stolen. Either way the horse joins your realm at
          once. It can't be taken while someone rides it or it pulls a carriage, nor while an armed
          resident of its owner stands on the tile and none of your realm does; a stable doesn't
          protect it. A Down horse can't be ridden or hitched, so Feed it first. Nothing that picks
          a horse by itself ever does this: default scripts, Breed horses, group orders and queue
          steps keep to your own. Its owner's realm log says at once that it is gone and where it
          was last; who took it they learn only from a witness (see Standing). One that belongs to
          nobody is simply yours. Someone on loan to your realm steals none to ride.
        </p>
        <h3>Passengers</h3>
        <p>
          A resident standing on a carriage of their realm can <strong>Board</strong> it from their
          card, children too; a rider dismounts first, and the driver can't board. Each passenger
          counts as {num(PASSENGER_WEIGHT)} kg against what the carriage holds, so it carries goods,
          people or a mix: a full carriage takes nobody more, and no goods while people fill it.
          Aboard, they stop what they were doing, ride along wherever the carriage is driven, and
          don't walk on their own. <strong>Get off</strong> puts them on the carriage's tile, or a
          script's <code>getOff(x, y)</code> on a tile right next to it. Giving a passenger a walk,
          or an order that acts on a tile (work, build, goods, fight and so on), gets them off first
          and then goes on. On the map passengers ride inside the carriage, which shows how many it
          carries; clicking it opens its card, which lists them under its load with how much of its
          weight is people and picks one when you click their name (a box drag takes them in too). A
          passenger's Doing line says "Aboard a carriage" and where it is heading while it is
          driven, and picking them shows the carriage's way ahead. Struck, an unarmed passenger
          stays aboard while it is driven (see Under attack). Scripts see a resident's{' '}
          <code>aboard</code> and a carriage's <code>passengerIds</code> and{' '}
          <code>standsStill</code>.
        </p>
        <p>
          In realm control mode a carriage’s or vessel’s own card gives these orders the other way
          round: Haul with this carriage, Drive this to, Row this to or Board first, then who, from
          the who-list, with anyone far off walking there first (see Controls, Control modes).
        </p>
        <p>
          <strong>Refilling from a carriage:</strong> any of your residents on or next to a carriage
          of your realm, the driver, passengers, or someone waiting or working beside it after the
          drive, eats the food they carry, and when they run low takes a meal from the carriage's
          Food, as at home, so a carriage with Food on board keeps them fed on a long drive and
          wherever it is parked. The Food a haul route keeps on board is left for the horse and the
          driver: others don't touch it, and the driver leaves the horse's share of{' '}
          {num(HAUL_HORSE_FOOD)}. Beside a carriage without Food they go hungry like anyone away
          from home.
        </p>
        <p>
          The group card boards everyone of the group standing on the carriage at once, until it is
          full, and a notice says who was skipped and why; its Get off gets them all off. Board and
          Get off are queue steps too: Board ends once they are aboard and Get off once they are
          off, so put a step that waits for the stop between them (a script that calls{' '}
          <code>end()</code> once they are there), e.g. board, wait, get off, work. A Board step
          whose carriage has left their tile by its turn is skipped.
        </p>
        <p>
          A resident given <strong>Feed the stable</strong> in a stable keeps Food there for{' '}
          {days(STABLE_FEED_DAYS)} for the horses in it ({num(HORSE_FOOD_PER_DAY)} a horse a day):
          below that they fetch what is missing from the nearest storage of your realm with Food, or
          from the one picked as <code>source</code> on their card, and store it in the stable;
          otherwise they wait there. Feed the stable can be run directly too, with Run script or as
          a queue step: they feed the stable in its <code>stable</code> param, or with none picked
          the one they stand in when it starts. Giving Feed the stable in a stable fills it; it is
          never kept between starts. With no stable there, or once theirs is gone, Feed the stable
          ends and your realm log says why.
        </p>
        <p>
          It can also run <strong>once</strong>: the queue step{' '}
          <strong>Feed the stable once</strong> (or its <code>once</code> param set to 1) fetches
          what the stable is missing, stores it, and ends once the stable is full, so the queue goes
          on to its next step. With no Food to fetch it ends too, and your realm log says why. A
          start without it keeps the stable fed as before.
        </p>
        <h3>Horse offer</h3>
        <p>
          Every Player may claim {num(HORSE_GRANT_HORSES)} new horses once, whenever they choose and
          whether or not they have horses: a notice at the top of the screen has a Claim button
          until they do. The horses get new stats and ages and go in your finished stable nearest
          your Leader's city; with no stable, they stand next to that city's storage (or next to
          your Leader), each with {num(HORSE_GRANT_FOOD)} Food on the ground by it. The realm log
          says where they are. Once claimed the offer is gone, also after your Leader dies and you
          found a new realm; while you have no living Leader you can't claim it. An admin can offer
          horses again, to every Player or to one: if you had claimed, the notice comes back and you
          may claim once more, whether or not you still have horses. If you hadn't, you still have
          just the one claim.
        </p>
        <h3>Deliveries and transfers</h3>
        <p>
          A Trade Org caravan brings what you buy to your city's storage, at most{' '}
          {num(DELIVERY_LOAD)} kg at a time, for {num(DELIVERY_FEE_BASE)} coins plus{' '}
          {num(DELIVERY_FEE_PER_KG_TILE, 5)} coins for each kg and tile. A transfer to another realm
          costs {num(TRANSFER_FEE_FACTOR)} times a delivery's fee over the caravan's whole way.
        </p>
        <table>
          <thead>
            <tr>
              <th>Load</th>
              <th>Distance</th>
              <th>Delivery fee</th>
              <th>Transfer fee</th>
            </tr>
          </thead>
          <tbody>
            {feeExamples(loads).map((f) => (
              <tr key={`${f.kg}-${f.tiles}`}>
                <td>{num(f.kg)} kg</td>
                <td>{num(f.tiles)} tiles</td>
                <td>{num(f.delivery)} coins</td>
                <td>{num(f.transfer)} coins</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Caravans walk with {num(CARAVAN_ESCORTS)} escorts, one more for every{' '}
          {num(CARAVAN_ROBBERIES_PER_ESCORT)} robberies of their route, at most{' '}
          {num(CARAVAN_ESCORTS_MAX)}.
        </p>
        <p>
          A caravan outlives its crew. When its driver dies a surviving escort takes over driving.
          With no crew left its carriage stands where it is, and the HQ sends a new driver on foot
          once it has an adult free. Stealing a caravan's carriage takes beating its crew first: it
          can't be driven off while its driver or an armed escort is up and within{' '}
          {num(CARAVAN_GUARD_RANGE)} tiles of it, so one still walking out doesn't stop you. It is
          one theft from the Trade Organization, worth the carriage, horse and load, and robs the
          caravan: its route counts the robbery and the delivery or transfer goes again. The same
          caravan gets a new carriage and horse at the HQ, and any surviving crew walk back to it.
        </p>
        <p>
          The HQ also sends out up to {num(TRADERS)} wandering traders, each a carriage with a
          driver and {num(TRADER_ESCORTS)} escorts, round a fixed loop of the trading posts and the
          HQ. At each stop a trader evens out its load with the warehouse, every good including Food
          and Coins: it leaves what that place has less of and takes what it has more of, as far as
          the carriage holds, every good cut alike when it can't hold it all. That is how a post
          comes to hold goods it doesn't produce, and caravans carry no Food or Coins, so a post
          gets those only from traders. The HQ is a stop like a post, its Coins going through its
          coin warehouse and its other goods through its goods warehouse, so new Food and Coins
          reach the posts, and a trader's lost escorts are made up there each time round. Its crew
          and a lost carriage go as for a caravan, and robbing one is a theft from the Trade
          Organization, but it owes nobody a delivery, so nothing is sent again.
        </p>
        <p>
          A caravan or trader leaves the HQ only with enough Food for its crew and horse to reach
          its next stop, so when the HQ is short, as in a new world, its carriages stand and wait.
          They leave the storage what the HQ's own people eat in {num(HQ_PEOPLE_FOOD_DAYS)} days,
          but may always take {num(WAITING_HORSE_FOOD)} Food for the horse. Short of Food, they top
          up from the goods warehouse, which the stock floor fills each day, so buying Food there
          can keep them waiting a little longer. A caravan with a delivery or transfer waiting wants
          all it keeps on board, as there is no Food on that way. A caravan away from the HQ takes
          what a post's storage has and drives on. A wandering trader waits at a post as at the HQ:
          it leaves only with enough Food to reach its next stop, topping up from the post's goods
          warehouse, and stands there until that has some.
        </p>
        <p>
          On its way a wandering trader stops at each NPC or Player city whose town hall lies within{' '}
          {num(TRADER_STOP_REACH)} tiles of its route, for{' '}
          {days(TRADER_STOP_TICKS / TICKS_PER_GAME_DAY)}. It stands on a free tile as near the town
          hall as it gets outside the walls, so closed gates don't stop it. You get a notice with
          the place while one stands at one of your cities; see{' '}
          <a href="#how-to-trade">How to trade</a>.
        </p>
        <p>
          A captured post leaves the Trade Organization at once, but it learns who took it only by
          news. A trader that reaches the post drops it from its loop and carries the news on, and
          anyone of the Trade Organization who saw the capture and gets away carries it too. Once
          one of them stands at another post or the HQ, the capture is a crime it knows of (see
          Standing), and it demands the city back with a debt for its worth. If they are killed on
          the way and no trader ever gets there, it never reacts.
        </p>
      </Section>

      <Section id="water">
        <p>
          Lake and Sea are <b>water</b>. Nobody walks on them, and a walk always goes round on land.
          Boats and ships are what cross them, and they start at a haven.
        </p>
        <p>
          A <b>haven</b> is a {num(FOOTPRINT.haven)} × {num(FOOTPRINT.haven)} building on the shore:
          every tile of it on passable land, off Mountain and off resource nodes, and at least one
          of its tiles touching Lake or Sea, straight or diagonally. The Build menu offers it only
          where it fits. It is built from {goods(havenCost.materials)} and{' '}
          {duration(havenCost.buildTicks)} of one average resident's work.
        </p>
        <p>
          A haven has a <b>storage</b>: anyone standing at it puts goods in or takes them out, by
          hand, with Store and Fetch, or with a script, as at any storage. Like a stable it has no
          owner of its own: it is the city's whose resident laid it out, and taking goods from it is
          judged as taking from any storage of that city. NPC cities don't build havens.
        </p>
        <p>
          <b>Building a boat.</b> A resident standing on a tile of a finished haven that touches the
          water lays out a <b>boat site</b> there with Build (in the Build menu under Transport). It
          is a construction site like any other: it takes {goods(boatCost().materials)} and{' '}
          {duration(boatCost().buildTicks)} of one average resident's work, anyone may bring
          materials or work on it, and torn down it leaves all its materials. Once finished the site
          is gone, and an empty boat of the realm of whoever finished it floats on the nearest free
          water tile next to it.
        </p>
        <p>
          A boat always floats on a water tile, one boat to a tile. It carries a few residents and a
          little cargo: {num(BOAT_CAPACITY)} kg in all, each passenger counting as{' '}
          {num(PASSENGER_WEIGHT)} kg. It shows on the map to whoever sees its tile, like a carriage;
          its card tells whose it is and how heavily it is loaded, and what it holds only to its own
          realm and allies. Scripts see the boats in sight with <code>vessels()</code>. A boat of a
          realm that ends belongs to nobody, as NPC cities don't use the water.
        </p>
        <p>
          <b>Building a ship.</b> A <b>ship</b> is the big vessel of the Sea: it carries far more
          than a carriage, {num(SHIP_CAPACITY)} kg in all, sails with a crew and goes only on Sea,
          never onto a Lake. A resident standing on a tile of a finished haven that touches the Sea
          lays out a <b>ship site</b> there with Build (under Transport); a haven on a Lake alone
          builds boats only. The site takes {goods(shipCost().materials)} and{' '}
          {duration(shipCost().buildTicks)} of one average resident's work, so it is a job for many
          hands, and like a boat site anyone may bring materials or work on it. Once finished the
          site is gone, and an empty ship of the realm of whoever finished it floats on the nearest
          free Sea tile next to it. It shows on the map on a token of its own, to whoever sees its
          tile; its card tells whose it is, its load, and who is aboard.
        </p>
        <p>
          <b>Docked.</b> A ship on a water tile touching a haven, straight or diagonally, is docked
          there; one launched at a haven is docked at it. Only docked, and only from that haven, do
          residents board it, get off it or load it: for a ship, beside it means standing anywhere
          on the haven it is docked at, and getting off lands on a free tile of that haven. A ship
          out at sea takes nobody on and lets nobody off. Store and Fetch with a docked ship as the
          place walk onto its haven.
        </p>
        <p>
          <b>Crew.</b> Residents of the ship's realm board it as its <b>crew</b> rather than as
          passengers: Board ship… on their card opens the choice (As crew or As passenger), the
          group card offers Crew the ship and Board the ship, a queue step Board a ship as crew, and
          a script <code>board(ship.id, true)</code>. Only grown residents crew a ship, and crew
          don't count against what it holds, while each passenger counts as {num(PASSENGER_WEIGHT)}{' '}
          kg as on a boat. A ship sails only with at least {num(SHIP_MIN_CREW)} crew aboard; its
          card names its crew and says whether it can sail. Getting off, one of the crew is its crew
          no more.
        </p>
        <p>
          <b>Loading a ship.</b> Those standing on the haven a ship is docked at move goods straight
          between the haven's storage and the ship, as many as there are and fit, at once: Load ship
          and Unload in the Goods panel, or a script's <code>loadShip(ship, goods)</code> and{' '}
          <code>unloadShip(ship, goods)</code>. Taking goods from another city's haven this way is
          judged as taking from its storage. Goods can also go aboard by hand, as onto a boat, from
          the haven.
        </p>
        <p>
          <b>Sailing.</b> One of the crew aboard, its <b>captain</b>, sails the ship: Sail ship to
          on their card, then a tile, a queue step Sail the ship, or a script's{' '}
          <code>sail(ship, x, y)</code>. Given a Sea tile it sails there; given a tile of a haven,
          it docks on the free Sea tile beside that haven nearest it. It goes a Step at a time over
          Sea only, never onto a Lake, so a lake haven builds boats, not ships. It sails only with
          at least {num(SHIP_MIN_CREW)} crew aboard, and stops where it is if fewer are left. An
          unskilled crew sails it {num(SAIL_SPEED)} times as fast as walking on Plains; their
          average <b>Seafaring</b> makes it faster as a rower's does a boat, and every tick of
          sailing teaches Seafaring to the whole crew. Everyone aboard goes along and sees from the
          ship's tile. Crew and passengers eat their own food and, running low, take a meal from the
          ship's Food, as on a boat.
        </p>
        <p>
          <b>Stealing a ship.</b> Residents of your realm on the haven another realm's ship is
          docked at board it as crew, if nobody of another realm is aboard and no armed resident of
          its owner stands on the haven while none of yours does; with at least {num(SHIP_MIN_CREW)}{' '}
          of them aboard, sailing it off steals it with its load, known through a witness like a
          boat's theft.
        </p>
        <p>
          <b>Fighting at a ship.</b> Those aboard a docked ship can be attacked from anywhere on its
          haven, and fight back at those on it; out at sea, as with a boat, nobody reaches them.
        </p>
        <p>
          <b>Beside a boat</b> means on a land tile touching its water tile, straight or diagonally.
          A resident beside a boat of their realm <b>boards</b> it, children too (Board boat on
          their card, or on the boat's card, or a script's <code>board(id)</code>), and steps onto
          its water tile: on the map they ride inside it, which shows how many are aboard, and their
          Doing line says "Aboard a boat". Each passenger counts as {num(PASSENGER_WEIGHT)} kg of
          the {num(BOAT_CAPACITY)} kg it holds, so{' '}
          {num(Math.floor(BOAT_CAPACITY / PASSENGER_WEIGHT))} residents fill an empty one. No horse
          goes aboard: a rider dismounts first, and the driver of a carriage can't board.
        </p>
        <p>
          A passenger <b>gets off</b> onto a free land tile beside the boat: one they pick (a
          script's <code>getOff(x, y)</code>), or the first one there. Giving a passenger a walk or
          an order that acts on a tile gets them off first, onto the shore nearest where they are
          going. A boat away from every shore keeps its passengers aboard: they can't get off, and a
          walk given to them ends. Walking never uses a boat. Down or dead, a passenger stays in the
          boat, and what they carried stays in it.
        </p>
        <p>
          <b>Loading.</b> Residents beside a boat put goods in it and take goods out, up to what it
          holds with its passengers counted in: Store and Fetch with the boat as the place (they
          walk to the shore beside it), or a pick-up or drop at <code>{'{kind: "vessel"}'}</code>{' '}
          from a script. Residents and goods only: a boat takes no horse or carriage.
        </p>
        <p>
          <b>Rowing.</b> A grown resident aboard a boat of their realm, or beside it (they board
          first), rows it to a water tile: Row boat to on their card, then a tile on the map, or a
          script's <code>row(boat, x, y)</code>. Given a land tile, the boat goes to the nearest
          free water tile beside it. It goes a Step at a time over water only, Lake and Sea alike,
          and a diagonal Step only where both straight tiles beside it are water too, so it never
          squeezes between two pieces of land. The rower takes its oars and is no passenger: they
          don't count against what it holds, and whoever was at the oars before becomes a passenger.
          Everyone aboard goes along and sees from the boat's tile, so rowing along a coast explores
          it. On the map the boat glides from tile to tile, and the rower's Doing line says where it
          is heading. A boat nobody rows stays where it is; it never drifts. Walking never uses a
          boat: a walk across water still goes round on land.
        </p>
        <p>
          An average rower moves a boat {num(ROW_SPEED)} times as fast as walking on Plains. Each
          point of Strength above {num(ROW_STRENGTH_AVERAGE)} makes it {pct(ROW_STRENGTH_EFFECT)}{' '}
          faster (and each below, slower), at most {pct(ROW_STRENGTH_LIMIT)} either way. Rowing
          teaches <b>Seafaring</b>, {num(SEAFARING_SKILL_PER_DAY)} a game day of rowing at average
          Intellect, and each point of it makes the boat {pct(SEAFARING_SKILL_EFFECT)} faster, at
          most {pct(SEAFARING_SKILL_LIMIT)}. Rowing costs food as walking on Plains does. The rower
          and passengers eat their own food and, running low, take a meal from the boat's Food.
        </p>
        <p>
          <b>Boats in queues and groups.</b> Boarding, rowing, getting off and loading are queue
          steps like any other, so a queue can take a resident across a lake and back, and a saved
          queue keeps them. With Add step, <b>Board a boat</b> picks the boat, then the shore tile
          to board it from (a walk there goes first): beside the boat now, or beside where an
          earlier step rows it. <b>Row the boat</b> picks the boat, then where to row it; it needs
          them aboard or beside it already, so it usually follows Board a boat. <b>Get off</b> lands
          them on the shore beside the boat, and Store and Fetch take the boat as their place. A
          step that can't be done when its turn comes (the boat isn't beside them) is skipped and
          noted in the realm log. On the group card, <b>Board boat</b> boards those beside a boat of
          your realm until it is full, <b>Get off</b> gets everyone aboard off together, and{' '}
          <b>Row boats to</b> has one of them row each boat (the first already aboard it, else the
          first beside it) while the others aboard go along: board, row, get off, and the whole crew
          is across.
        </p>
        <p>
          <b>Haul route by boat.</b> A boat runs a haul route as a carriage does, between two stops
          on land: shore tiles or a haven, each with free water beside it. A grown resident standing
          on the shore beside a boat of your realm picks <strong>Haul route…</strong> on their card,
          the goods to take and to bring back and the Food kept on board for them (
          {num(HAUL_KEEP_FOOD)} unless you pick another amount), then the other stop on the map; the
          tile they stand on is the first stop. With Add step it is <b>Haul route by boat</b>: the
          boat, the first stop (a walk there goes first), then the other one. A script gives it with{' '}
          <code>haul(boat, x, y, goods)</code> from the shore beside the boat. At each stop the
          rower gets off onto it and loads and unloads by hand from beside the boat, like a
          carriage's driver: at a haven from and into its storage, at a shore from and onto the pile
          on the tile. Then they board, take the oars and row to the free water beside the other
          stop. The boat leaves the first stop once it has goods on board and nothing more to load
          there; with none there yet it waits. The route ends when the boat isn't beside the stop
          any more (rowed off by someone else) or the rower can't get off onto it, and goes on until
          stopped otherwise. The rower's Doing line says what they load or where they row.
        </p>
        <p>
          <b>Haul route by ship.</b> A ship runs a haul route between two havens. A grown resident
          standing on the haven a ship of your realm is docked at picks <strong>Haul route…</strong>{' '}
          on their card (or <b>Haul route by boat or ship</b> with Add step, or a script's{' '}
          <code>haul(ship, x, y, goods)</code>), then a tile of the other haven; they are its
          captain. With them aboard it must have at least {num(SHIP_MIN_CREW)} crew, so the others
          board as crew first. At each haven the captain gets off and moves the goods straight
          between the haven's storage and the ship, as many as there are and fit, at once: first the
          goods for that haven off, then the Food kept on board for the crew topped up, then the
          goods for the other haven on. Then they board again as one of the crew and sail to the
          other haven, docking on the free Sea beside it; the rest of the crew stays aboard all the
          while and eats from the ship's Food. Goods go both ways as for a carriage, ore home and
          Food out, say. The ship leaves the first haven once it has goods for the other aboard;
          with none there yet it waits. Sailing on each time teaches Seafaring to the whole crew.
        </p>
        <p>
          <b>Stealing a boat.</b> A grown resident beside another realm's boat can row it off as a
          carriage is driven off: <strong>Row off (theft)</strong> on their card, then a tile, or a
          script's <code>row(boat, x, y)</code> naming that boat. The boat joins your realm at once
          with its load, and they take its oars. It can't be taken while someone rows it or anyone
          is aboard, nor while an armed resident of its owner stands beside it and none of your
          realm does. Boat and load are one theft, known through a witness like a carriage's: its
          owner's realm log says at once that it is gone and where it was last. A boat of nobody is
          simply yours.
        </p>
        <p>
          <b>Fighting at a boat.</b> Those aboard can be attacked by anyone beside it, as if the
          boat were the next land tile, and fight back from aboard; Down or dead, they stay in it.
          There are no fights between boats and none from open water, so a boat away from every
          shore is out of reach: an attack on someone aboard it finds no way and ends. An alarm at
          home doesn't reach whoever is rowing.
        </p>
      </Section>

      <Section id="how-to-trade">
        <p>
          Trade happens in person: one of your residents, or a carriage of yours, stands on the tile
          of a Trade Org warehouse (at its HQ or a trading post) or of an NPC city's storage. Click
          the warehouse or storage on the map and press <strong>Trade here</strong>, or open its
          city under Cities in sight. Its trade section lists what you <strong>can buy</strong>{' '}
          there and what you <strong>can sell</strong>, with the units and the price of each. Anyone
          with a resident in sight of it sees its prices.
        </p>
        <h3>Offers at a Player's storage</h3>
        <p>
          A storage of your realm can stand an <strong>offer</strong>: "gives 10 Wood, wants 5
          Stone", either side may be Coins, as many times over as you name and the goods are there.
          Post it under the city's trade section, wherever your residents are. The goods stay in the
          storage but are <strong>set aside</strong>: your workers, builders, Fetch, haul routes,
          pick-ups and refills leave them alone, while a thief or raider can take them like any
          others, cutting the offer down. Anyone in sight sees it and its rate. Someone of another
          realm, a resident or carriage on the storage's tile, accepts it as many times as they can
          pay and carry. It happens at once, whether you are online or not, and raises standing both
          ways like a trade: by the coins, or goods for goods by both goods at warehouse base
          prices, as a swap counts both its sale and its purchase. What they pay goes into the
          storage as ordinary goods. It ends when it is used up, when you take it down, or when the
          storage is torn down or no longer yours; what was set aside is ordinary goods of that
          storage again.
        </p>
        <h3>Direct offers</h3>
        <p>
          Under <strong>Direct offers</strong> in the Diplomacy drawer you can send an offer to one
          realm you know of: one you see residents of, an ally, one whose city you have seen, one
          with a standing either way, or your side in a contract, demand or direct offer. Name a
          storage of yours, and the goods are set aside there as for any offer. They hear at once
          wherever they are, with a notice and the place, and only they can accept it: someone of
          theirs goes to the storage and takes it in person, as with any offer, or they decline it
          from anywhere. Anyone else in sight of the storage sees it, and that it is for another
          realm. It lapses after {num(DIRECT_OFFER_DAYS)} game days. Declined, lapsed or taken down,
          the goods are ordinary again and both of you are told. At most{' '}
          {num(DIRECT_OFFERS_TO_ONE_REALM)} can stand to one realm.
        </p>
        <p>
          Or have the Trade Organization carry it, while the HQ stands. Name a city of yours and a
          city of theirs whose storage you see, and whether you pay the fee or split it; the form
          shows the fee before you send. Nothing is set aside. They accept it whole from anywhere,
          each side’s goods within one carriage load, and it becomes two Transfers: a caravan takes
          what is there at each city, up to what was agreed, with a fee for what it takes. Each
          caravan takes the share of the side it picks up from as it collects, and the other side’s
          from their storage as it unloads there. If that storage is short of coins then, the goods
          stay delivered and the Trade Organization bears the loss. It changes no standing, and it
          is cancelled if the HQ falls.
        </p>
        <h3>Sending a trader</h3>
        <p>
          With nobody of yours there, the trade section offers to send someone: your residents
          nearest first, with what each carries, or a carriage of yours. Send walks them (or drives
          the carriage) to the tile, and the section shows them on the way. A trade moves only what
          the trader holds, so send coins to buy and goods to sell.
        </p>
        <h3>Buying and selling</h3>
        <p>
          Once one is there, pick the trader, their hands or a carriage of yours on the tile, the
          good and how many. The form says what they carry and the room left (a carriage holds{' '}
          {num(CARRIAGE_CAPACITY)} kg; what a resident carries is under{' '}
          <a href="#transport">Carrying &amp; transport</a>). Buying takes coins from the trader and
          puts the goods in their hands or carriage; selling is the other way round. It happens at
          once, cut down to what the trader holds, what the warehouse or storage holds and what
          fits. A trade that won't go says why: no coins in hand, no room, none in stock, or not
          wanted. Each unit is priced as it moves, so a big trade moves the price as it goes (see{' '}
          <a href="#trade">Trade &amp; prices</a>).
        </p>
        <h3>Swapping</h3>
        <p>
          A trader there can also swap goods for goods, with no coins in hand: under Swap, pick the
          good you want, how many, and the good you give. It is a sale and a purchase at once, each
          unit priced as those are, so the rate comes from the place's prices and moves as its stock
          moves. You hand over enough to pay for what you want, rounded up, and what is over comes
          back in coins as far as the place holds them. It is cut down like any trade, and the
          button says what it would move or why it won't go. Like a trade it raises standing, by
          both the sale and the purchase.
        </p>
        <h3>Trading with a wandering trader</h3>
        <p>
          While a wandering trader stands at a city, anyone with a resident or carriage on its tile
          can trade with it the same way. Press <strong>Trade here</strong> on its tile, or open the
          city it stands at. It trades with its load, but never the Food its crew keep on board, its
          coins come from and go onto the carriage, and it takes goods only as far as the carriage
          holds. It orders no delivery and makes no swap. Those the Trade Organization refuses can't
          trade with it.
        </p>
        <h3>What an NPC city buys and sells</h3>
        <p>
          An NPC city sells only its surplus, what its storages hold above its reserve, and buys
          only goods it is short of, up to its reserve and with the coins in its storage. It takes
          nothing else. Its prices come from its stock like a warehouse's, and its standing toward
          you moves them: the better, the cheaper it sells and the more it pays. It swaps only its
          surplus for what it is short of, and its Rates in the Trade section list each good it is
          short of against each it has spare, at today's prices. Pick one to fill in the swap, or to
          send someone there if nobody of yours is. Below {signed(NPC_CITY_REFUSES_STANDING)} it
          won't trade with you at all. Every trade raises standing both ways (see{' '}
          <a href="#standing">Standing &amp; reactions</a>).
        </p>
        <h3>Buying a horse</h3>
        <p>
          An NPC city sells any horse beyond the {num(NPC_HORSES_KEPT)} it keeps to breed. Only in
          person: a grown resident of yours goes to its finished stable with the Coins in their
          hands, not on a carriage. Press <strong>Trade here</strong> on the stable's tile, or open
          the city: the Trade section lists the horses standing there with name, stats, age and
          price, and says why one won't go. A horse that is hitched, ridden or Down isn't for sale.
          The Coins go into its storage, and the horse is yours where it stands, ready to ride home.
          Buying one raises standing both ways like any trade, and any breeding it was part of ends.
        </p>
        <p>
          An average new horse costs about {num(HORSE_PRICE_BASE)} coins while the city has all it
          wants. Each point of its mean stat above or below average moves that by{' '}
          {pct(HORSE_PRICE_PER_STAT)}, and each game year of age takes off{' '}
          {pct(HORSE_PRICE_AGE_PER_YEAR)}, leaving at least {pct(HORSE_PRICE_AGE_FLOOR)}. As the
          city nears the pair it keeps it asks more, up to {pct(HORSE_PRICE_SCARCITY)} more for the
          last it would sell; with more than it wants, up to {pct(HORSE_PRICE_GLUT)} less. Its
          standing toward you moves the price like its trade prices. Below{' '}
          {signed(NPC_CITY_REFUSES_STANDING)} it won't sell you one.
        </p>
        <h3>Selling a horse</h3>
        <p>
          An NPC city buys a horse while it has fewer than it wants, which grows with its size. Ride
          one of yours into its finished stable and get off, with the rider or another grown
          resident of yours there. <strong>Trade here</strong> on the stable's tile, or the city's
          Trade section, lists your horses standing there with what it pays, and says why one won't
          go. A horse that is hitched, ridden or Down can't be sold. A stolen horse sells like any
          other.
        </p>
        <p>
          It pays about {pct(HORSE_PRICE_PAID_SHARE)} of what it would ask for that horse once it is
          among its own, so a good horse fetches more, and a city with few pays more. Good standing
          brings what it pays and what it asks closer, and it always asks more than it pays. The
          Coins come out of its storages, so it must hold them, and go into your resident's hands;
          if they can't carry all of them the sale doesn't go, so come with room. The horse is the
          city's where it stands, which feeds and breeds it from then on, and any breeding it was
          part of ends. Selling one raises standing both ways like any trade. Below{' '}
          {signed(NPC_CITY_REFUSES_STANDING)} it won't buy from you.
        </p>
        <h3>Delivery</h3>
        <p>
          At a Trade Org warehouse, instead of carrying, a caravan brings what you buy to your
          city's storage, or fetches what you sell from it, for a fee. Pick the city under Delivery
          in the trade form; the buttons show the fee before you order. It goes to or from a city of
          your realm, at most {num(DELIVERY_LOAD)} kg at a time. A delivery is paid at once, goods
          and fee, and the warehouse keeps the goods for you until a caravan brings them. A pick-up
          is paid when the caravan collects, at the warehouse's prices of that moment, less the fee.
          Carrying it yourself costs nothing but is at your own risk. The fees are under{' '}
          <a href="#transport">Carrying &amp; transport</a>.
        </p>
        <h3>Transfer</h3>
        <p>
          To send goods or coins to another realm, open one of its cities under Cities in sight:
          under Transfer, a caravan fetches them from one of your cities and brings them to that
          city's storage, for a fee the button shows before you send. Nobody of yours needs to be at
          a warehouse. The fee is {num(TRANSFER_FEE_FACTOR)} times a delivery's over the caravan's
          whole way, taken from your city's storage with the goods; at most {num(DELIVERY_LOAD)} kg
          go at a time, coins counting by their weight. The other realm doesn't have to agree.
        </p>
      </Section>

      <Section id="trade">
        <p>
          A Trade Org warehouse, at the HQ or a trading post, trades in person with whoever stands
          on it: a Player's resident or carriage, or an NPC city's trader.
        </p>
        <p>
          Each warehouse prices every good from its own stock. At {num(PRICE_REFERENCE_FLOORS)}{' '}
          times its stock floor it sells at the base price; less stock costs more (to the power{' '}
          {num(PRICE_ELASTICITY)}), between {pct(PRICE_RANGE.min)} and {pct(PRICE_RANGE.max)} of the
          base price. It buys at {pct(BUY_SHARE)} of its selling price. Each unit is priced as it
          moves, so a big trade moves the price as it goes. A swap goes at these same prices (see{' '}
          <a href="#how-to-trade">How to trade</a>).
        </p>
        <p>
          A wandering trader at a stop prices the same way from what it carries, as if its floor
          were {pct(TRADER_FLOOR_SHARE)} of a warehouse's, buying lower than it sells. An NPC city
          treats it as its visiting trader: a spare hand brings over its surplus and buys what the
          city is short of, Food included but never a weapon.
        </p>
        <table>
          <thead>
            <tr>
              <th>Good</th>
              <th>Base price</th>
              <th>Warehouse pays</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(WAREHOUSE_BASE_PRICE) as PricedGood[]).map((g) => {
              const p = priceAt(g, PRICE_REFERENCE_FLOORS)
              return (
                <tr key={g}>
                  <td>{goodName(g)}</td>
                  <td>{num(p.sell)}</td>
                  <td>{num(p.buy)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <h3>How Iron's price follows stock</h3>
        <table>
          <thead>
            <tr>
              <th>Stock, in floors</th>
              <th>Sells at</th>
              <th>Pays</th>
            </tr>
          </thead>
          <tbody>
            {[
              0.5,
              1,
              2,
              PRICE_REFERENCE_FLOORS,
              PRICE_REFERENCE_FLOORS * 2,
              PRICE_REFERENCE_FLOORS * 8,
            ].map((f) => {
              const p = priceAt('iron', f)
              return (
                <tr key={f}>
                  <td>{num(f)}</td>
                  <td>{num(p.sell)}</td>
                  <td>{num(p.buy)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <h3>NPC cities</h3>
        <p>
          When the world is made, NPC cities are placed region by region, wherever there is room: in
          each frontier region {num(NPC_TOWNS_PER_FRONTIER)} town(s) and{' '}
          {num(NPC_VILLAGES_PER_FRONTIER)} village(s), in each heartland{' '}
          {num(NPC_VILLAGES_PER_HEARTLAND)} village(s). They stand on the mainland only: none on an
          island, none within {num(NPC_STARTING_SITE_CLEARANCE)} tiles of a starting site, and none
          within {num(NPC_WAY_CLEARANCE)} tiles of a pass or land bridge, with its farms. A full
          city's new village stays on land its people can walk to, never across the sea, and as far
          from the starting sites.
        </p>
        <p>
          An NPC city thinks over what its people do once a game hour ({realTimeOf(NPC_PLAN_TICKS)}
          of real time) and keeps to that plan in between: a worker stays where the city put them
          until it moves them, and a builder picks up the next piece of a project as soon as one is
          finished. Only its defence acts at once.
        </p>
        <p>
          An NPC city keeps a reserve: {days(NPC_TRADE.reserveFoodDays)} of Food for everyone; the
          materials for a house and {num(NPC_TRADE.reserveWallStretches)} tiles of wall; a{' '}
          {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()} for each soldier it keeps and hasn't armed
          yet ({pct(NPC_SOLDIER_SHARE)} of its adults), with the Iron and Wood to forge them (a city
          that knows of a coal node keeps the steel gear instead, under Coal); and{' '}
          {num(NPC_WAR_CHEST_PER_RESIDENT)} coins a resident as its war chest. Coins below the war
          chest count as short only for a city that can earn them: one with a mint or gold mine,
          Gold ore in its storage, a gold node it knows of, a Trade Org warehouse within{' '}
          {num(NPC_TRADER_REACH)} tiles, or a wandering trader passing within{' '}
          {num(TRADER_STOP_REACH)} tiles on its loop. A city with none of these still keeps its war
          chest out of what it sells, but never waits on Coins it can't earn. A stable is wanted
          once it has a horse, or with none once nothing else is short, and what the stable lacks of{' '}
          {days(STABLE_FEED_DAYS)} of Food for its horses is in the reserve too; what the stable
          holds counts.
        </p>
        <p>
          A city with a smithy of its own, finished or begun, also keeps a set of{' '}
          <a href="#work">Tools</a> for each of its workers and builders who carries none (its
          adults beyond the soldiers it keeps) and {num(NPC_TOOLS_SPARE)} spare. It never sells
          them, but they never count as short either: its spare hands forge them, first of all
          surplus work while it holds fewer, from Iron and Wood above its reserve, and up to{' '}
          {num(NPC_SURPLUS_CAP.tools ?? 0)} more a step of its needs; its smithy forges them only
          once its soldiers are armed. So a city forging a set for every worker still founds, lays
          roads and trains. One grown, unarmed resident at a time who carries none, idle or at work,
          fetches a set from its storage, as soldiers fetch their weapons, and one whose set breaks
          fetches the next. Soldiers carry none. A trading post's and the HQ's workers fetch theirs
          from their warehouse, only what it holds above its floor of Tools.
        </p>
        <p>
          A city's needs grow in steps, one for every {num(NPC_RESIDENTS_PER_NEEDS_STEP)} residents.
          A village or town under {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents counts as one
          step; from there on it is a big city. Each step keeps another house's and those wall
          tiles' Wood in its reserve, and each past the first {num(NPC_TRADE.reserveStonePerStep)}{' '}
          Stone. Its surplus caps, its builders and its road crew below are per step too.
        </p>
        <p>
          A new NPC village or town starts with {num(NPC_START_HORSES)} horses, with{' '}
          {days(NPC_START_HORSE_FOOD_DAYS)} of Food for each on the ground by them, and lays its
          stable out where they stand, so they are in it once it is finished. It breeds them up to{' '}
          {num(NPC_HORSES_BASE)} horses and one more for every {num(NPC_RESIDENTS_PER_HORSE)}{' '}
          residents, at most what a stable holds ({num(STABLE_CAPACITY)}), while Food isn't short. A
          founding party takes no horses, and a daughter gets its first when a Player sells it some.
          Trading posts and the HQ have none of this.
        </p>
        <p>
          One of its residents at a time feeds its stable, by the Feed the stable default: when the
          stable holds less than {days(NPC_STABLE_REFILL_DAYS)} of Food for its horses they fill it
          up, and work for the city in between. The Food comes from what is above the{' '}
          {days(NPC_TRADE.reserveFoodDays)} kept for its people. Below that only while a horse is
          hungry or Down, and then only {days(NPC_STABLE_HUNGRY_DAYS)} of Food for each such horse:
          a short city feeds its people first. Trading posts and the HQ don't do this.
        </p>
        <p>
          It shares out its adults in this order: soldiers; farmers, as many as feed everyone (each
          eats {num(FOOD_PER_DAY)} Food a day, a farmer makes {num(WORK_OUTPUT_PER_DAY.food ?? 0)})
          and one more while it has no food surplus; with its Food below its reserve but not yet
          running short, as many more as win back what it lacks in {days(NPC_FOOD_REFILL_DAYS)}, if
          that is more; a new farm when they don't fit; up to {num(NPC_BUILDERS)} builders a step
          while it has a project; everyone else is a spare hand. A farm is otherwise built only when
          Food is short of its reserve ({days(NPC_TRADE.reserveFoodDays)} of Food for everyone), or,
          with nothing else keeping it from being full, short of the Food surplus its founding waits
          on (below), with every farm at its full crew of {num(WORKPLACE_MAX_WORKERS.farm ?? 0)};
          never because spare hands filled the farms working for surplus. It needs nobody idle for
          that: the new farm's farmers come from those working for surplus and from its scouts
          first, and from other work only after them. A farm already begun is finished before
          another, and that new farm comes before anything else it has begun. Spare hands go to the
          good the reserve is shortest of, as a share of what it wants of it, filling one
          workplace's crew before the next. A workplace by a way where the city lost people (Threat)
          is worth less to it: each person lost there takes {num(NPC_JOB_WEIGHTS.danger)} from the
          work's score, at most {num(NPC_JOB_WEIGHTS.most)}. Of several workplaces of a good it
          picks the safest, and a worker leaves a dangerous camp for a safe one of the same good; a
          dangerous mine can lose to safe work on another good. Farming while Food is short is never
          weighed down. Without a workplace for that good, the city builds one: on the nearest
          fitting resource node it knows of, or a smelter, smithy or mint in its area like a house.
          With every workplace of another short good at its full crew and someone idle, it opens
          another of them, however many it has. It doesn't begin a building whose materials it has
          no way to get: a material it holds too little of must come from a workplace of its own, a
          node it knows of, or a Trade Org warehouse within its trader's reach. A town with no iron
          in reach builds no smithy, however much Iron its first stock held, and a building it can't
          finish waits, begun, without holding up its other building.
        </p>
        <p>
          Those with nothing to do, those carrying a child and its children stand at a house of the
          city rather than on its storage, each at their own one, and stay there: they eat where
          they stand, as anyone does in their own city's area, and leave when the city has work for
          them. A city with no house has them at home. Its soldiers stand apart from this, and
          trading posts and the HQ don't do it.
        </p>
        <p>
          An NPC city sets out its town by a layout, picked at random when it comes to be (a
          self-managed city when its Leader dies) and kept. In Grid, square blocks{' '}
          {num(CITY_GRID_BLOCK)} tiles along each side lie between straight lanes a tile wide, left
          free for streets, with a lane through each gate. In Rings, houses stand in circles round
          the town hall, with a circular lane every {num(CITY_RING_STEP)} tiles between them and a
          lane from each gate to the middle; only a storage goes inside the first lane. In Main
          street, one straight street runs from the gate past the town hall, with buildings in rows
          along it; side lanes cross it every {num(CITY_SIDE_LANE_GAP)} tiles, and once the rows on
          the street are full, buildings go further back along those. In Quarters, two streets cross
          at the town hall, with houses north of them, workshops (smelter, smithy, mint, stable)
          south-west and storages south-east, each part in long rows in bands{' '}
          {num(CITY_QUARTER_ROWS)} tiles deep between lanes; a building whose part has no room left
          spills over into another. Houses, storages, smelters, smithies, mints and stables take the
          next spot of the layout that fits, nearest home first, inside its wall and on outward as
          the city grows; a lake or a rock only leaves a gap in a block, a circle or a row. Walls,
          gates, farms and workplaces on nodes go where they do anyway. A city from before layouts
          got one when they shipped: nothing was torn down, and new buildings follow it around what
          stands. Trading posts, the HQ and Players' cities have none.
        </p>
        <p>
          Its streets are real roads. Its road crew lays them ahead of its other roads, nearest home
          first, once its town hall, a house, a storage or a workshop stands beside a tile, and only
          from materials above its reserve. Tiles kept free for streets stay free, and a street
          stops at whatever already stands on its line. Like any road they belong to nobody.
        </p>
        <p>
          So it builds the whole chain its land allows, from the node up: weapons short wants a
          smithy, which wants Iron, so a smelter, which wants Iron ore, so a mine first, and the
          Wood and Stone the mine is built of before that. A smelter or smithy is worked only while
          the storage holds the input for a batch, which its workers take with them, and one of them
          fetches more when it runs out, as yours do. A good it knows no node of stays short: a
          village that knows no ore forges no weapons, and a mint is built only with Gold ore it
          knows of. What it stays short of, its trader buys.
        </p>
        <p>
          A spare hand with nothing short to work for doesn't stand idle. A few at a time, one for
          every {num(NPC_RESIDENTS_PER_SCOUT)} residents, go scouting: they explore with as much
          Food as they can carry, and turn back when it only just covers the way home. A new scout
          sets out only while that Food comes from above the city's reserve. A city knows every node
          within {num(NPC_NODE_REACH)} tiles; what a scout saw, out to {num(NPC_SCOUT_LIMIT)} tiles,
          it knows only once they step back into its area alive. A scout killed on the way brings
          nothing, and nothing protects them. What is short calls them home, with what they saw.
          Once a city knows its limit it stops scouting.
        </p>
        <p>
          What a scout brought home it can build on. Short of a good it knows no nearer node of, it
          puts up the workplace on a far one, and the crew works it like any other, its carrier
          bringing their Food on the way back from the storage. Knowing such a node, it no longer
          buys that good from its trader or founds a daughter for it. A place a scout or a builder
          finds no way to is given up, and it counts on no node there.
        </p>
        <p>
          The others stay at or go to one of the city's workplaces and work for surplus, past its
          reserve, the good furthest below its cap first. Each step of its needs caps it at{' '}
          {num(NPC_SURPLUS_CAP.food ?? 0)} Food, {num(NPC_SURPLUS_CAP.wood ?? 0)} Wood,{' '}
          {num(NPC_SURPLUS_CAP.stone ?? 0)} Stone, {num(NPC_SURPLUS_CAP.ironOre ?? 0)} each of Iron
          ore, Iron and Gold ore, {num(NPC_SURPLUS_CAP.coins ?? 0)} coins and{' '}
          {num(NPC_SURPLUS_CAP[NPC_SMITHY_WEAPON] ?? 0)}{' '}
          {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()}s above what it keeps. A smelter, smithy or
          mint is worked for surplus only from input above the reserve. Once every good they could
          work for is at its cap they work on past it, the good least far past first, up to{' '}
          {num(NPC_SURPLUS_PAST_CAP)} times its cap, farms aside; only past that are they idle. What
          is short, its trader and a founding party still take them first, the next time it thinks.
          So its workplaces stay busy, and its trader has more to sell.
        </p>
        <p>
          With nothing short, a big city whose one lumber camp, quarry or mine has its crew full and
          its good below the cap opens a second of that kind, on the nearest node it knows. For
          surplus it opens no third, and none for a good at its cap.
        </p>
        <p>
          Ahead of scouting and that work comes its road crew: up to {num(NPC_ROAD_CREW)} spare
          hands a step, apart from its builders, build its streets, then road from its home to each
          of its workplaces outside its area, farms too, the nearest first. They follow the way a
          resident would walk, tile by tile, so a road goes round a lake, and they skip tiles that
          already have a road. One of them out on a way with a tile's materials and Food in hand
          lays the tiles nearest them before walking home to a street owed meanwhile. They only use
          materials above its reserve and what its project still needs; with none to spare, or with
          something short that they can work for, they go back to other work and bring back what
          they carry. Once its full wait is under way, they also leave a town hall's and a storage's
          materials untouched, so founding comes before roads. Like any road it belongs to nobody,
          and anyone can use it or tear it down; a tile torn down is laid again in time.
        </p>
        <p>
          With its workplaces joined the crew goes on: to the nearest Trade Organization warehouse
          within {num(NPC_TRADER_REACH)} tiles, its trader's reach, leaving out those of the HQ's
          inner ring, which keeps everyone out, and then to the edge of the area of its nearest
          neighbour, any city but the Trade Organization's. A big city, of{' '}
          {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents or more, doesn't stop there: while it
          has materials to spare it goes on to its further warehouses within that reach and its
          further neighbours, one road at a time, the nearest first. A road two neighbours would
          each build is built by only one of them. A road on Mountain takes{' '}
          {num(MOUNTAIN_ROAD_WORK_FACTOR)} times the work here as anywhere. The crew takes Food
          along for the walk, goes back for more before a tile it couldn't walk home from on what it
          has, and fetches more when it runs low, as any builder does. A way longer than{' '}
          {num(NPC_ROAD_LONGEST)} tiles, or with no way through, is given up.
        </p>
        <p>
          A big city, from {num(2 * NPC_RESIDENTS_PER_NEEDS_STEP)} residents, builds beyond its
          needs. With nothing short, its outer wall standing with its gate, and materials above its
          reserve, it puts up an <strong>inner ring</strong> of wall round its town hall and
          storage, up to {num(NPC_INNER_WALL_REACH)} tiles from the hall's middle, tile by tile as
          it does its outer wall. It takes the shape that leaves fewest gaps, along its layout's
          streets where it can: a square on the lanes round the town hall in Grid, a circle on the
          first lane in Rings. What stands on its line leaves a gap, and a street it crosses stops
          at it. Its one gate stands in line with the outer gate and goes up last, so its people
          never lose the way to the storage; its own pass through the gate as they do any of its
          gates. It waits whenever something runs short or the outer wall is moving out, and it
          stays when the outer wall moves. Before that, with nothing short and materials above its
          reserve, it builds one <a href="#training">training ground</a> in its area, and its
          soldiers train there.
        </p>
        <p>
          Once it is a <strong>town</strong>, {num(NPC_STONE_WALL_RESIDENTS)} residents or more, an
          NPC city upgrades its wall to <strong>stone</strong> (see{' '}
          <a href="#transport">Upgrading to stone</a>): its outer gate first, then that wall tile by
          tile, nearest the gate first, and its inner ring once the outer one is all stone. It does
          this last of all its projects. While it does, its reserve sets aside the Stone of{' '}
          {num(NPC_WALL_STONE_SET_ASIDE_TILES)} tiles of stone wall for it: its roads, repairs and
          trade leave that Stone, a founding party's Stone counts only above it, and only its walls
          spend it. It never counts as short: its spare hands refill it working for surplus, so the
          wall doesn't pull them off other work. It upgrades a tile at a time once it holds a builder's trip of Stone it may
          spend, from what it sets aside or beyond its reserve, while its road crew is in and its
          wall is not moving out. A town with none builds a quarry for it, and its spare hands work it. A
          new outer wall it puts up when it grows is of stone once its old one was. Villages,
          starting cities and the Trade Organization's cities stay wooden.
        </p>
        <h3>Trading posts and the HQ</h3>
        <p>
          Every heartland has a trading post near its middle; the frontier gets one more in each
          stretch of about {num(TRADING_POST_REGION)} tiles across that has room. The HQ stands in a
          frontier region, as far from the starting sites as the mainland allows. None of them
          stands on an island, a pass or a land bridge, or within {num(NPC_STARTING_SITE_CLEARANCE)}{' '}
          tiles of a starting site, and the caravans and wandering traders drive from the HQ to
          every post over the passes and land bridges.
        </p>
        <p>
          The Trade Organization runs its own chain the same way. A trading post's reserve is its
          warehouse's stock floor ({num(WAREHOUSE_FLOOR.ironOre)} Iron ore,{' '}
          {num(WAREHOUSE_FLOOR.wood)} Wood, {num(WAREHOUSE_FLOOR.coins)} coins and so on), the HQ's{' '}
          {num(HQ_FLOOR_FACTOR)} times that, and {num(HQ_FOOD_FLOOR_FACTOR)} times its{' '}
          {num(WAREHOUSE_FLOOR.food)} Food for the traders to carry; their Food is their storage's,
          kept by their farmers. Their spare hands work and build for whatever their warehouses are
          short of, on the nearest node within {num(NPC_NODE_REACH)} tiles, and carry the output
          into the warehouse. A post never grows in people; the HQ grows only while it is too weak.
          Neither sends a trader or founds a city.
        </p>
        <p>
          Only the HQ's warehouses top up to their floor at the end of each game day, so the world
          always has a market of last resort. Nothing tops up a trading post's warehouse: its floor
          only says what its spare hands, caravan and wandering traders go for, and all it holds
          came by them or from people selling to it. A post can run dry, even of Food and Coins, and
          its prices climb as it does, so prices differ with what reached each post. Rob a trader or
          raid a post and you empty a real market. Its people and soldiers eat from its storage,
          which its farm fills, not from the Food on sale in the warehouse.
        </p>
        <p>
          The Trade Organization lives on in its trading posts should its HQ ever fall: they keep
          their warehouses, prices and soldiers and go on trading in person, but with no caravans
          and no traders their warehouses hold only what they had and what their own hands bring.
          What only the HQ gave it is gone for good: no deliveries or transfers, no army to hire and
          nobody sent out to punish. See "The fall of the HQ" for what that costs.
        </p>
        <p>
          Once one good's surplus makes a full load for one of its spare hands (beside the Food for
          the walk) and a Trade Org warehouse lies within {num(NPC_TRADER_REACH)} tiles, an NPC city
          sends that spare hand, never a soldier, as its trader: they carry the load and the coins
          above its war chest there, sell the load, buy the good shortest of its reserve that it has
          no node for (never Food or a weapon) as far as their coins and arms allow, and walk home
          to the storage. A city has one trader out for each {num(NPC_RESIDENTS_PER_TRADER)} of its
          residents, and a village keeps one; they spread over the goods with surplus, and only with
          no other good to sell does one take a second load of a good already on the road. None go
          while Food runs short or armed outsiders stand in its area. A city of{' '}
          {num(NPC_ESCORT_TOWN_RESIDENTS)} residents or more, a town, sends{' '}
          {num(NPC_TRADER_ESCORTS)} soldier with each trader as their escort, of the soldiers beyond
          those on its town hall and at its gates; a village's trader goes alone. The escort keeps
          pace with the trader: the trader waits for an escort fallen behind, and one gone ahead waits
          for the trader. It fights whoever goes for them and comes home with them. Nothing else protects them on the way; a trader not back after{' '}
          {days(NPC_TRADER_GIVE_UP_DAYS)} is given up, and the city may send another.
        </p>
        <p>
          The same trader goes to a Player's offer within {num(NPC_OFFER_REACH)} tiles, ahead of any
          warehouse run, when it gives what the city is short of and wants what it has spare or
          Coins, at a rate at least as good as its own prices, and the city doesn't refuse that
          realm. A direct offer is left to the realm it is for. They take as many times over as make
          up what it lacks and fit in their arms, never a weapon either way, and walk home with it.
          It looks once a game hour; while Food runs short only an offer that gives Food will send
          them. If the offer is gone or cut down when they get there, or there is no way in, they
          carry what they didn't spend back home. The Trade Organization never accepts offers.
        </p>
        <p>
          A city is full once it has had spare hands, idle, on a road crew, scouting or working for
          surplus, and none of Food, Wood and Stone short of its reserve for {days(NPC_FULL_DAYS)},
          with a food surplus and its founding party's materials above its reserve. Its war chest
          and its soldiers' gear and what that is made from (weapons, armour, bows, arrows, Steel,
          Iron, Iron ore, Coal) don't keep it from being full: it still works and buys them. Once it
          lacks nothing but its founding party's materials, those count as short: its spare hands
          gather them, it builds a workplace for one it has none of, and they are still spare hands
          while they do. Food, Wood and Stone come first, Food its surplus too: only once it holds{' '}
          {pct(NPC_FOUND_FOOD_SURPLUS_SHARE)} of its Food surplus cap past its reserve, and while
          full its farmers work to win that back as they do its reserve. While it saves for its
          party, its walls and repairs spend only the Stone above its reserve and the party's Stone,
          and its walls the Stone its reserve sets aside for them.
          Its workplaces come first as well: its spare hands go on a road crew, scout and work at
          its workplaces for surplus, and only those left over gather for the party. Past{' '}
          {num(NPC_FOUND_VILLAGE_RESIDENTS)} residents it waits a game day less for each{' '}
          {num(NPC_FULL_RESIDENTS_PER_DAY)} more, but at least {days(NPC_FULL_DAYS_LEAST)}. A dip
          below its reserve only restarts that wait if it lasts longer than{' '}
          {days(NPC_FULL_DIP_DAYS)}, though nobody sets out during one. A full city founds a
          daughter. Once a game day it looks for a free Plains site {num(NPC_CITY_MIN_DISTANCE)} to{' '}
          {num(NPC_FOUND_REACH)} tiles away, with room for a village and on no realm's territory,
          nearest a node of a material it has none of in reach. A founding party of{' '}
          {num(NPC_VILLAGE.residents)} adults, one more for each{' '}
          {num(NPC_FOUND_RESIDENTS_PER_MEMBER)} residents past {num(NPC_FOUND_VILLAGE_RESIDENTS)} up
          to {num(NPC_FOUND_PARTY_MOST)}, sets out. One in{' '}
          {num(Math.round(1 / NPC_FOUND_ESCORT_SHARE))} of them, rounded down and at least one, is a
          soldier of its escort, as far as the city has soldiers beyond those on its town hall and
          at its gates; they fight for the rest on the way and stay as the daughter's first
          soldiers. The party carries a town hall's and a storage's materials, a house's for each{' '}
          {num(HOUSING_ROOM.house ?? 1)} members past {num(NPC_VILLAGE.residents)}, and Food for
          twice the walk and {days(NPC_FOUND_FOOD_DAYS)} there, with as many more adults as it takes
          to carry all of it. They come from its spare hands and its workers near home first, then
          from its farmers beyond those who feed it; while too few are at hand, its workers far out
          come home to set out and wait there. With too few hands to carry all of it, the party
          sets out once it holds the town hall's materials and its Food, and the city sends a
          second wave of carriers after it with the rest, as hands come free: while the town hall
          is going up they join the party, and once the daughter stands they carry what it still
          lacks to it, until its storage stands. Like the party, they stay as the daughter's
          residents. Hands sent back from far workplaces leave them, and none of them goes back to
          work there while called home. One too full for their own Food puts
          down what crowds it out at the storage first, so nobody sets out without it. The party builds the town hall, which founds the daughter: an NPC city of
          its own with a name from the game. It then builds its storage, a farm and a house, and
          once its storage holds the Wood of its reserve, its first wall, a ring{' '}
          {num(Math.floor(NPC_VILLAGE.size / 2))} tiles round its home. Mother and daughter start at
          a standing of {num(NPC_FOUND_STANDING)} toward each other, which fades like any other, and
          share nothing. A party whose town hall doesn't stand after {days(NPC_FOUND_GIVE_UP_DAYS)}{' '}
          gives up and walks home. Trading posts and the Trade Organization's HQ never found cities.
        </p>
        <h3>What drives an NPC city</h3>
        <p>
          An NPC city is more than its needs. It has a <b>temperament</b>, fixed for good, which
          leans it one way; it feels <b>threat</b> from those it sees armed nearby and from those
          who killed or robbed its people, and remembers where it lost them; and each game day it
          takes a <b>stance</b> from both: growing, arming, trading, settling further out, or
          turning on whoever hurt it. The stance decides what it builds and how many soldiers it
          keeps, its threat how far it sends its traders and where its workers go, and its
          temperament which stance it reaches for first. Below, each in turn; Threat is under
          Standing & reactions.
        </p>
        <h3>Temperament</h3>
        <p>
          Every NPC city has a temperament, fixed when it comes to be: merchant, militarist or
          settler. A self-managed city gets one when its Leader dies, unless it had one before. A
          daughter takes its mother's {pct(NPC_DAUGHTER_TAKES_MOTHERS_TEMPERAMENT)} of the time and
          otherwise draws one of its own, which may still be the same. Whoever sees a city reads its
          temperament on its card, and keeps it in Last seen; whoever has traded with it reads it in
          the Standing list while they hold a standing with each other. Scripts see the same.
          Trading posts and the HQ have none. On its own a temperament changes nothing: it tilts the
          city's stance.
        </p>
        <h3>Stance</h3>
        <p>
          What an NPC city is after for now. It picks again at its first planning pass of each game
          day, from what it needs: <b>Fortify</b> by the threat it feels from the one it fears most,
          fully at {num(NPC_STANCE.fortifyThreat)}; <b>Trade</b> with a Food surplus and a Trade
          Organization warehouse within its traders' reach; <b>Expand</b> with a Food surplus and
          nothing short. Trade and Expand alone are worth {pct(NPC_STANCE.tradeNeed)} and{' '}
          {pct(NPC_STANCE.expandNeed)} of what it takes. Its temperament's own stance (merchant
          Trade, militarist Fortify, settler Expand) counts {num(NPC_STANCE.temperamentTilt)} times;
          the greatest need that is full wins, and it grows (<b>Grow</b>) when none is.
        </p>
        <ul>
          <li>
            <b>Fortify</b> keeps {num(NPC_STANCE.fortifySoldiers)} times the soldiers it keeps by
            its size, sends {num(NPC_STANCE.fortifyEscorts)} more with each escort, shuts its gates
            to armed outsiders {num(NPC_STANCE.fortifyGateWatch)} times as far off, and weighs the
            danger places by the way to a workplace {num(NPC_STANCE.fortifyDanger)} times as much.
          </li>
          <li>
            <b>Trade</b> works for surplus only up to {pct(NPC_STANCE.tradeSurplusCap)} of its caps,
            so more goes to market, and has {num(NPC_STANCE.tradeTraders)} more trader out.
          </li>
          <li>
            <b>Expand</b> waits {pct(NPC_STANCE.expandFullDays)} of the days full before it founds
            and sends {num(NPC_STANCE.expandScouts)} times the scouts.
          </li>
        </ul>
        <p>
          <b>Taking a node.</b> An NPC city short of a good it has no workplace for builds on the
          nearest free node of it that it knows. In Expand, when that node lies out of its City
          area, {num(NPC_SITE_ESCORTS)} of its soldiers beyond its hall and gate posts go along and
          stand at the site until the workplace is built. A militarist city in Expand that knows no
          free node of the good goes for the nearest workplace on one that a realm holds, in no
          city: the realm's residents within {num(NPC_NODE_GUARD_RANGE)} tiles of it hold it. It
          goes only when the soldiers it can spare are at least {num(NPC_TAKE_OUTWEIGH_TIMES)} times
          as strong as the armed ones there, and never fewer than {num(NPC_TAKE_PARTY_MIN)}. They
          strike everyone of that realm there, an attack like any other and a crime against it,
          until none is left up; then the workplace is the city's and its own workers move in
          (Holding a workplace). It never goes for the node of a realm in its shelter (Demands).
        </p>
        <p>
          Whoever sees an NPC city reads its stance on its card as a mood line: growing, arming,
          busy trading, looking to expand, or retaliating against whom. Scripts see it as the city's
          stance.
        </p>
        <h3>Retaliating</h3>
        <p>
          An NPC city turns on a realm (<b>Retaliate</b>) once it feels a threat of{' '}
          {num(NPC_RETALIATE.threat)} from it and knows of a recent crime of theirs against it, such
          as its traders killed. It arms as under Fortify and sends that realm demands for Coins.
          Rarely it marches: with a threat of {num(NPC_RETALIATE.marchThreat)}, its standing toward
          them at {signed(NPC_RETALIATE.marchStanding)} or below, and its soldiers beyond its hall
          and gate posts {num(NPC_RETALIATE.marchOutweigh)} times as strong as the defenders of
          their nearest city, those soldiers walk to that city's town hall and occupy it. Held to
          the end, the city leaves the realm and goes on as an NPC city of its own. Never against a
          realm in its shelter.
        </p>
        <p>
          It ends when its threat from them fades below {num(NPC_RETALIATE.endsBelow)} (a paid
          demand clears it at once) or its losses leave it weaker than them. Then it turns to
          Fortify, and a march under way is called off: its soldiers walk home.
        </p>
        <p>
          An NPC city sells only what it holds above this reserve and buys only what it is short of.
          It lends residents at {num(NPC_TRADE.pricePerResidentWeek)} coins each a game week, but
          only its spare hands: those its plan has idle, on a road crew, scouting or working for
          surplus. Its farmers, those working for a good short of its reserve and its builders stay,
          and so do {pct(NPC_TRADE.defenceShare)} of its adults at home, its soldiers among them.
          They take weapons and armour along only from what its storages hold above its reserve;
          with none spare they come unarmed. It lends nobody while it weighs a demand, while its
          town hall is occupied, or while your armed residents stand in its City area or in sight of
          it. Those it lends never act against it: they refuse an order to attack its residents,
          walls or gates, to climb its walls or to tear down its buildings, whether you give it by
          hand, in a queue, to a group or an army or from a script, and they can't occupy its town
          hall nor count as your fighters toward it. Struck by one of its own, they still defend
          themselves. The Trade Organization hires out soldiers at{' '}
          {num(TRADE_ORG_ARMY.pricePerSoldierWeek)} coins each a game week. A contract runs at most{' '}
          {days(CONTRACT_MAX_DAYS)}. An NPC city hires too, on its own: once it feels a threat of{' '}
          {num(NPC_ACTING_FIRST.hireThreat)} from one Organization, it asks the Trade Organization
          for up to {num(NPC_ACTING_FIRST.hireSoldiers)} soldiers for{' '}
          {days(NPC_ACTING_FIRST.hireDays)}, if its storages hold the whole price, and pays each
          week from them. They stand at its town hall and fight attackers in its City area. They set
          out with the Food for the walk there and back from a storage of their own city, and in its
          City area they eat from its storage as at home.
        </p>
        <p>
          An NPC city shuts its gates while anyone armed who isn't of the city or its alliance
          stands within {num(NPC_GATE_WATCH_RANGE)} tiles of one, and opens them once nobody does.
          The Trade Organization's army doesn't count, so its soldiers can walk in and buy, unless
          the city refuses the Trade Organization or the army has come for that city. Any other
          armed outsider near still shuts the gates, on the soldiers too.
        </p>
        <p>
          The soldiers of an NPC village, town or self-managed city run the same Alarm default as
          your armed residents do (see Alarms): they go after a thief they saw, an attacker and
          whoever occupies the town hall, as no crime, and walk to the town hall to hold it while an
          armed outsider is in the area, then go back to their posts. An unarmed visitor they leave
          alone, and striking anyone else there is a crime for them too. One who gets armed or comes
          home while the hall is occupied joins in. Trading posts and the HQ keep their own rules:
          their soldiers go straight at attackers and occupiers in the area, a post's at thieves it
          knows of as well.
        </p>
        <p>
          Between fights those soldiers stand spread out, each on the post their id gives them among
          those the city has: first {num(NPC_SOLDIERS_ON_HALL)} on the town hall, where one is
          enough to stop anyone occupying it, then {num(NPC_SOLDIERS_AT_GATE)} at each gate, and the
          rest up on the walk of its wall, on the tiles they can get up to; they stay up between
          fights, and coming down for another post takes the time again. A city with too little wall
          for them, or none, has them stand on the free ground within {num(NPC_POST_AROUND_HALL)}{' '}
          tiles of its hall as well. They eat where they stand. If those on the hall or at a gate
          are called away or die, the next soldiers take over at the city's next planning pass, and
          they come back once the alarm is over. In a big city with a training ground some train in
          turns (<a href="#training">Training</a>). Trading posts and the HQ don't do this.
        </p>
        <p>
          The soldiers it keeps by its size ({pct(NPC_SOLDIER_SHARE)} of its adults) are all it
          keeps in peace. Anyone else armed, such as a smith carrying the smithy’s spears to the
          storage, stands down: they put their weapons, armour and Arrows into its storage and go
          back to work, those on a round, escorting, training or on alarm last. Soldiers just
          standing on a post count as standing idle; those on a round, escorting or training don’t.
        </p>
        <p>
          Of the soldiers on its wall {pct(1 / NPC_SOLDIERS_PER_PATROL)} walk a round, and never
          more than {num(NPC_PATROLS_MAX)} in a city however big: {num(NPC_PATROL_WALL_STOPS)} stops
          along its wall, {num(NPC_PATROL_ROAD_STOPS)} along its roads inside it, and back to where
          they set out. When a round ends the next by id goes, so those on the wall take turns;
          those on the hall and at the gates stay put. They refill as they walk, and one low on Food
          with none to take goes back to their post. A stop they can't get to they skip. An alarm
          breaks a round off, and they go on with it once the alarm is over.
        </p>
        <p>
          Bought outright, an NPC city asks {num(CITY_PRICE_PER_RESIDENT)} coins a resident plus,
          for its buildings:{' '}
          {(Object.entries(CITY_PRICE_BY_BUILDING) as [BuildingKind, number][])
            .map(([k, c]) => `${kindName(k).toLowerCase()} ${num(c)}`)
            .join(', ')}
          . Standing moves that price by up to {pct(CITY_PRICE_STANDING_SWING)} either way: cheaper
          the better it holds you.
        </p>
        <p>
          Trade raises standing by a point, both ways, for every{' '}
          {num(STANDING_NPC_TRADE_COINS_PER_POINT)} coins with an NPC city and every{' '}
          {num(STANDING_TRADE_COINS_PER_POINT)} with the Trade Organization or another realm. A swap
          counts both its sale and its purchase, and so does an accepted offer of goods for goods.
          The trade section shows your standing there and how far your last trade moved it, and the
          realm log says so for each trade.
        </p>
      </Section>

      <Section id="standing">
        <p>
          Standing runs from {signed(-STANDING_RANGE)} to {signed(STANDING_RANGE)}. A known crime
          lowers the victim's standing toward the culprit; standing drifts back toward neutral by{' '}
          {num(STANDING_DRIFT_PER_DAY)} a game day. A crime is remembered for{' '}
          {days(CRIME_MEMORY_DAYS)} after the news stops spreading. Taking from or tearing down
          another realm's outpost storage counts the same as its city storage, and taking what
          another realm's Down resident carries is theft too. So is driving off in another's
          carriage (see Transport): one theft, worth {num(CARRIAGE_STOLEN_WORTH)} coins for the
          carriage, {num(HORSE_STOLEN_WORTH)} for its horse, and the load. So is mounting another's
          horse or hitching it (see Riding): one theft, worth {num(HORSE_STOLEN_WORTH)} coins. A
          carriage driven off with a horse of a different owner is a theft from each. Taking back
          what was stolen from you is theft like any other. In your own city's area, force against
          someone occupying its town hall or a thief you know of is no crime (see Under attack).
        </p>
        <p>
          An NPC city goes after those who steal from it. Once one of its residents saw the theft,
          or the news reached it, it sends up to {num(NPC_HUNTERS_PER_THIEF)} soldiers after the
          thief while they are within {num(NPC_HUNT_REACH)} tiles of its home: only soldiers beyond
          those holding its town hall and its gates go. They strike the thief down, which is no
          crime, take what was stolen from where the thief fell and carry it into the city's
          storage. A thief who gets further off is let go, and the soldiers go back to their posts.
        </p>
        <table>
          <thead>
            <tr>
              <th>Crime</th>
              <th>Standing lost</th>
              <th>Forgotten after</th>
            </tr>
          </thead>
          <tbody>
            {crimeForgotten().map((c) => (
              <tr key={c.crime}>
                <td>{CRIME_NAMES[c.crime]}</td>
                <td>{signed(-c.loss)}</td>
                <td>{days(c.days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Trade raises it too: a point for every {num(STANDING_NPC_TRADE_COINS_PER_POINT)} coins
          with an NPC city, every {num(STANDING_TRADE_COINS_PER_POINT)} with the Trade Organization
          or another realm. To stay level against the drift takes{' '}
          {num(STANDING_DRIFT_PER_DAY * STANDING_NPC_TRADE_COINS_PER_POINT)} coins of trade a game
          day with an NPC city.
        </p>
        <p>
          Each paid week of a mercenary contract raises standing by {num(STANDING_PER_PAID_WEEK)}{' '}
          both ways; an unpaid week breaks it and costs {num(STANDING_CONTRACT_BROKEN_LOSS)}.
        </p>
        <h3>Thresholds</h3>
        <ul>
          <li>
            Below {signed(NPC_CITY_REFUSES_STANDING)} an NPC city won't trade or hire out to you and
            keeps its gates shut to you; below {signed(NPC_CITY_WONT_SELL_STANDING)} it won't sell
            itself to you.
          </li>
          <li>
            At {signed(PERSUADE_STANDING)}, and once your fighters near it have outweighed its own
            side for {days(OUTWEIGH_HOLD_DAYS)} without a break (Respect, below), an NPC city asks
            to join you; declined, it asks again after {days(PERSUADE_ASK_AGAIN_DAYS)}.
          </li>
          <li>
            An NPC city joins an alliance when it holds every member at{' '}
            {signed(NPC_ALLIANCE_JOIN_STANDING)} or better, and leaves when any falls below{' '}
            {signed(NPC_ALLIANCE_LEAVE_STANDING)}.
          </li>
          <li>
            An NPC city also seeks allies on its own: once it feels a threat of{' '}
            {num(NPC_ACTING_FIRST.allyThreat)} from one Organization, it invites into an alliance it
            leads, founding one if it has none, the realms in no alliance it holds at{' '}
            {signed(NPC_ALLIANCE_JOIN_STANDING)} or better (never the one it fears), and the NPC
            cities that feel threatened by the same Organization and hold it that well too.
          </li>
          <li>
            Below {signed(TRADE_ORG_REFUSES_TRADE_BELOW)} the Trade Organization won't trade with
            you; below {signed(TRADE_ORG_PUNISHES_BELOW)} its army (up to{' '}
            {num(TRADE_ORG_PUNISH.soldiers)} soldiers) comes to take {num(TRADE_ORG_PUNISH.times)}{' '}
            times what it lost. It walks to your city however far that is and gives up{' '}
            {days(TRADE_ORG_PUNISH.giveUpDays)} after it arrives; it looks in your storages when it
            arrives, so emptying them in time works, though you still see it come. It turns back on
            the road if the city stops being yours. Its soldiers pack Food at the HQ for the way
            there and back, keeping {num(TRADE_ORG_PUNISH.packRoom)} kg free for what they carry
            home; they refill at trading posts they pass and may take Food from your storage for the
            way back, apart from what they came to take. On the road they keep together. A supply
            wagon follows them, when the HQ has someone free to drive it: a Trade Org carriage with
            Food for the trip, always with {num(TRADE_ORG_PUNISH.wagonRoom)} kg free for what they
            take, which they put on it and it brings home to the warehouses. Taking from it or
            stealing it is a crime, its soldiers go after whoever does, and without it they go on
            with what they carry. Each soldier also packs {num(TRADE_ORG_PUNISH.purse)} Coins: short
            of Food on the road, with the wagon's share counted, they buy some within{' '}
            {num(TRADE_ORG_PUNISH.postReach)} tiles of them, by the same trade as anyone, from a
            trading post, an NPC city that doesn't refuse the Trade Organization, or a Player's Food
            offer of at most {num(TRADE_ORG_PUNISH.offerFoodPrice)} Coins a unit. They don't buy
            from you if you are the one they are after, and none of this counts as what they came to
            take. Your realm log says when it is coming, when it arrives, what it left with, why it
            turned back, or that it was lost. Besides stolen goods, carriages and horses it counts{' '}
            {(Object.entries(TRADE_ORG_LOSS) as [CrimeKind, number][])
              .map(([c, n]) => `${CRIME_NAMES[c].toLowerCase()} as ${num(n)} coins`)
              .join(', ')}
            .
          </li>
          <li>
            What its army came for and couldn't take stays your debt, from when it heads home or is
            lost, whatever the reason; an army sent by admin directive leaves none. While you owe, a
            crime it learns of adds what it cost to the debt instead of sending another army. Your
            realm log says what you owe, and "Cities in sight" shows it. A resident on any Trade Org
            warehouse's tile can pay it in coins, from their hands or a carriage there, in part or
            in full, even if it refuses to trade with you. The debt ends with the fall of its HQ.
          </li>
          <li>
            Once you owe, it sends you a <strong>demand</strong> for the debt, once for each debt,
            with a deadline {days(TRADE_ORG_DEBT_DEMAND_DAYS)} away. The demand always asks for what
            you owe now, and paying in full at a warehouse ends it. Accept and its caravan comes for
            what you set aside at a storage in a city, for no fee, or you send it by a Transfer to
            its nearest warehouse and pay the fee; what they bring in comes off the debt. Decline it
            or let it lapse and its next step starts at once: its next army comes for your
            workplaces. What accepting leaves owed starts that at the deadline.
          </li>
          <li>
            Its next army then goes to that city and tears down its workplaces, one after the other,
            the same way anyone can. Each comes off the debt for its worth (
            {(Object.entries(WORKPLACE_WRECK_WORTH) as [BuildingKind, number][])
              .map(([k, n]) => `${BUILDING_NAMES[k].toLowerCase()} ${num(n)} coins`)
              .join(', ')}
            ) until it is covered or none are left, and your realm log reports each one. The
            workplaces of a city are the farms laid out for it and those its residents work, not one
            nobody of it works or one someone else works. Its soldiers fight those who attack them,
            and it goes home after, with the debt still owed if that didn't cover it, and comes
            again. Pay in full at a warehouse while it is there and it stops and goes home.
          </li>
          <li>
            After {num(TRADE_ORG_DEBT_TRIPS)} such armies have reached a city, with the debt still
            owed, its next army comes to <strong>take the city</strong>. It holds the town hall as
            anyone would, for {days(OCCUPATION_GAME_DAYS)} without a break, and fights whoever is
            armed on the hall or attacks it. When the time is up the city joins the Trade
            Organization as a new trading post and all you owe is settled. Its storages become
            warehouses with what is in them, with prices and a stock floor, but its Food goes into a
            new storage near the town hall. Its people stay as the post's, your Leader staying in
            your realm, homeless, and it gets a caravan and joins the wandering traders' loops. Pay
            in full at a warehouse before that and the army goes home. Capturing that post later
            goes like any post's capture.
          </li>
          <li>
            A trading post you took is a debt too, once it has heard who took it: it adds the post's
            worth, {num(TRADE_ORG_LOSS.capture)} coins, to what you owe, sends no army of its own
            for it, and <strong>demands the city back</strong>, with a deadline{' '}
            {days(TRADE_ORG_DEBT_DEMAND_DAYS)} away. Accept and the city is a trading post again at
            once, with those who live there, its horses and carriages, its warehouse with all it
            holds and a caravan of its own, and the post's worth comes off your debt; anything else
            you owe stays owed. Decline it or let it lapse and your debt goes up its steps like any
            other. Paying all you owe at a warehouse ends this demand too, and you keep the city.
          </li>
          <li>
            A city whose Leader died starts out holding its former Player at{' '}
            {signed(FORMER_PLAYER_STANDING)}, and so does one that left a realm whose heir took
            over, toward that realm.
          </li>
        </ul>
        <p>
          Leaving an alliance takes {realSeconds(ALLIANCE_LEAVE_DELAY)}; soldiers recalled from its
          army are back under their owner's command after {realSeconds(ALLIANCE_RECALL_DELAY)}.
        </p>
        <h3>Respect</h3>
        <p>
          What an NPC city weighs when you demand it or it thinks of joining you. On your side only
          your armed residents count, and only while they stand in its City area or in sight of one
          of its people who is at home there: what its scouts and traders see far away doesn't
          count, nor do your walls, nor residents it lent you. Each counts by strength, as combat
          weighs them: their best weapon's blow, harder with Combat skill (up to{' '}
          {num(1 + COMBAT_SKILL_LIMIT)} times), plus what their shield and armour take off a blow.
          An untrained resident with a spear counts {num(fighterStrength(UNTRAINED_SPEAR))}; one
          with a sword, shield and armour and full Combat skill counts{' '}
          {num(fighterStrength(TRAINED_AND_ARMOURED))}. On its side count its soldiers, weighed the
          same way, and {num(RESPECT_PER_WALL)} for each of its own finished wall and gate tiles. It
          weighs this at its planning pass, once a game hour, and remembers since when each realm
          has outweighed it; the first pass one doesn't, that time starts again from nothing.
        </p>
        <h3>Threat</h3>
        <p>
          Apart from how it regards you, an NPC city keeps in mind how dangerous you are: its{' '}
          <strong>threat</strong> from each Organization, a strong friendly neighbour too. At its
          planning pass it adds what your armed residents weigh, by strength as respect weighs them,
          wherever it sees them: in its City area or in sight of any of its people, also its traders
          and scouts far from home. Standing a game day in sight adds {num(THREAT_SEEN_PER_DAY)} for
          each point of strength. Learning that you killed one of its people adds{' '}
          {num(THREAT_PER_KILLING)}, that you robbed it {num(THREAT_PER_ROBBERY)}. Threat fades to
          half every {days(THREAT_HALF_LIFE_DAYS)} and is forgotten below {num(THREAT_FORGOTTEN)}.
          You don't see it.
        </p>
        <p>
          It also remembers <strong>danger places</strong>: where one of its people was killed
          outside its City area, by anyone, bandits too. Another loss within{' '}
          {num(DANGER_PLACE_MERGE_RANGE)} tiles adds to the same place. A danger place fades to half
          every {days(DANGER_PLACE_HALF_LIFE_DAYS)}. While it remembers one within{' '}
          {num(DANGER_PLACE_WAY_REACH)} tiles of a way, the city sends a soldier more along that way
          for each person lost there, up to {num(DANGER_ESCORTS_MAX)} more.
        </p>
      </Section>

      <Section id="demands">
        <p>
          A demand tells another realm what you want and by when: <strong>a named city</strong> of
          theirs, or <strong>goods or Coins</strong>, with a note of at most{' '}
          {num(DEMAND_NOTE_MAX_LENGTH)} characters and a deadline of up to {days(DEMAND_MAX_DAYS)}.
          Open <strong>Demands</strong> in the Diplomacy drawer to send one or to answer one.
          Scripts can too (<code>sendDemand</code>, <code>acceptDemand</code>,{' '}
          <code>declineDemand</code>, <code>demands</code>).
        </p>
        <ul>
          <li>
            You can send one to any realm you know of: one whose residents you see, an ally, one
            whose city you have seen, one with a standing toward you or you toward it, or your side
            in a contract, demand or Direct offer.
          </li>
          <li>
            It arrives at once, wherever they are, on their Demands tab and as a notice. A realm
            sends at most {num(DEMANDS_PER_GAME_DAY)} a game day, scripts included.
          </li>
          <li>
            They accept or decline it, or let it lapse at the deadline; it also lapses when either
            side's Leader dies. Both realm logs say what happened.
          </li>
          <li>
            <strong>Accepting a demand for a city hands it over at once.</strong> It joins the
            sender's realm as a captured city does: the residents who live there, its horses and
            carriages as <a href="#combat">capturing</a> takes them. A Leader who lived there stays
            in their realm, homeless. You can do this with your last city too. It is your own
            choice, so it is no crime and costs no standing. A city no longer yours can't be handed
            over: the demand stays until you decline it or it lapses.
          </li>
          <li>
            <strong>Accepting a demand for goods or Coins hands them over the way you pick.</strong>{' '}
            Set aside at a storage of yours, they wait for the sender alone to fetch in person,
            wanting nothing back, under their Direct offers, for up to {days(DIRECT_OFFER_DAYS)};
            fetching them is no trade and raises no standing. Sent by a Transfer, a caravan brings
            them from a city of yours to a city of theirs whose storage you see, one load at a time,
            and you pay the fee. If the storage is short it says so before you accept, and what it
            holds is what goes. With none of it there you can't accept that way.
          </li>
          <li>
            <strong>An NPC city weighs it at its planning passes</strong>, one each game hour. You
            can send one to any NPC city you have seen or have a standing with. It gives in once the
            strength of your fighters near it (Respect, under Standing) has come to at least{' '}
            {num(DEMAND_YIELD_RESPECT_TIMES)} times its own side, and at least{' '}
            {num(DEMAND_YIELD_RESPECT_MIN)}, for {days(OUTWEIGH_HOLD_DAYS)} without a break: a real
            army that stays at the gate wins a city without a fight, a crowd with spears or an army
            walking through doesn't. Until then it <strong>wavers</strong>, and the Demands drawer
            shows how long is left; a planning pass on which your force doesn't outweigh it that far
            starts the time again from nothing. Your walls and fighters out of its sight don't
            count. It joins your realm as a persuaded city does, or sets what it holds of the goods
            aside at its storage for you alone to fetch. With none of your fighters near it declines
            at its next pass; it declines too when the deadline comes first, or with none of the
            goods there. Declining drops its standing toward you by{' '}
            {num(DEMAND_DECLINED_STANDING_LOSS)}.
          </li>
          <li>
            <strong>The Trade Organization always declines</strong>, within a game hour, and being
            asked costs you {num(DEMAND_TRADE_ORG_STANDING_LOSS)} of its standing. Everyone knows of
            it.
          </li>
          <li>
            <strong>A militarist NPC city sends demands too.</strong> Once a game day it sends one
            to each realm it knows of (one it feels threatened by, or one with a standing either
            way) whose armed residents, wherever they are, its own side outweighs at least{' '}
            {num(NPC_DEMAND_OUTWEIGH_TIMES)} times over, and by at least{' '}
            {num(NPC_DEMAND_MIN_STRENGTH)}: {num(NPC_DEMAND_COINS)} Coins within{' '}
            {days(NPC_DEMAND_DAYS)}, and the next no sooner than {days(NPC_DEMAND_AGAIN_DAYS)}{' '}
            later. It fetches nothing set aside: you pay by a Transfer from a city of yours to it,
            in sight or not. Paid, it no longer feels threatened by you and its standing toward you
            is back to neutral at least. Declined or let lapse, its standing toward you falls to{' '}
            {num(NPC_DEMAND_REFUSED_STANDING)}: it turns hostile. It never sends one to the Trade
            Organization.
          </li>
          <li>
            <strong>A new realm is sheltered</strong> for its first {days(NEW_REALM_SHELTER_DAYS)}:
            no NPC city sends it a demand or marches on it then. Players can.
          </li>
          <li>
            <strong>The threat is only words.</strong> Ignoring a demand does nothing by itself:
            whatever was threatened is the sender's to carry out, or not. The Trade Organization
            carries out what it threatens over a debt (see Standing & reactions).
          </li>
        </ul>
      </Section>

      <Section id="combat">
        <p>
          Residents in contact strike every {duration(STRIKE_TICKS)}. A blow does {num(BLOW_BASE)}{' '}
          plus {num(BLOW_PER_STRENGTH)} for each point of Strength plus the weapon's attack, then{' '}
          {pct(COMBAT_SKILL_EFFECT)} more for each point of Combat skill (at most twice as hard).
          Protection takes damage off, but a blow that lands does at least {num(MIN_BLOW_DAMAGE)}.
          Each point of Agility dodges {pct(DODGE_PER_AGILITY)} of blows, at most {pct(DODGE_LIMIT)}
          . Combat skill grows by {num(COMBAT_SKILL_PER_BLOW)} with every blow struck or taken.
        </p>
        <table>
          <thead>
            <tr>
              <th>Gear</th>
              <th>Attack</th>
              <th>Defence</th>
              <th>Lasts (blows)</th>
              <th>kg</th>
            </tr>
          </thead>
          <tbody>
            {(Object.entries(WEAPON_ATTACK) as [Good, number][]).map(([g, a]) => (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>{signed(a)}</td>
                <td>—</td>
                <td>{lasts(g)}</td>
                <td>{num(GOOD_WEIGHT[g])}</td>
              </tr>
            ))}
            {(Object.entries(PROTECTION_DEFENCE) as [Good, number][]).map(([g, d]) => (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>—</td>
                <td>{signed(-d)}</td>
                <td>{lasts(g)}</td>
                <td>{num(GOOD_WEIGHT[g])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          An average resident hits for {num(unarmed)} with bare fists, {num(sword)} with a sword,{' '}
          {num(steelSword)} with a steel sword, and {num(swordSkilled)} with a sword at full Combat
          skill ({num(COMBAT_SKILL_MAX)} points); they dodge {pct(dodge)} of blows. A resident has{' '}
          {num(MAX_HEALTH)} health.
        </p>
        <p>
          Each resident has three <strong>equipment</strong> slots: a <strong>weapon</strong>, a{' '}
          <strong>shield</strong> and <strong>armour</strong>, one item each. Only what is equipped
          counts in a fight, and only a resident with a weapon equipped is <strong>armed</strong> (a
          soldier): a spare sword in the pack makes nobody a soldier and a second shield adds
          nothing. A resident with an empty slot equips the best fitting item at once when they pick
          one up, from a storage, the ground, a carriage or a smithy; with the slot already full,
          the new one is only carried, even if it is better. Putting the equipped item down
          (storing, dropping it, or losing it as loot) empties its slot, and the best other item of
          that kind they carry takes its place. Equipped gear still weighs what it weighs and is
          part of what they carry. A resident's card shows their three slots.
        </p>
        <p>
          A <strong>Bow</strong> and a <strong>Crossbow</strong> are weapons for shooting, and each
          takes both hands: with one equipped the shield slot stays empty (the shield stays carried
          and goes back on when they put a one-handed weapon in its place), and a shield can't be
          put on beside one. In a blow they add nothing, so an archer in a brawl fights with their
          fists. They shoot <strong>Arrows</strong>, a plain good that is carried, stored and traded
          like any other and goes in no slot. A smithy makes each, the smith saying which as for the
          other gear:
        </p>
        <table>
          <thead>
            <tr>
              <th>Good</th>
              <th>Made from</th>
              <th>A batch makes</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {(['bow', 'crossbow', 'arrows'] as const).map((g) => (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>
                  {(Object.entries(forged(g).input) as [Good, number][])
                    .map(([input, n]) => `${num(n)} ${goodName(input)}`)
                    .join(', ')}
                </td>
                <td>{num(forged(g).output[g] ?? 0)}</td>
                <td>{num(GOOD_WEIGHT[g])} kg each</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Ranged combat</h3>
        <p>
          An armed resident with a Bow or Crossbow equipped <strong>shoots</strong> anyone they may
          strike whom they see within their weapon's <strong>reach</strong>, in tiles, contact
          included: given an attack order, they walk only until the target is in reach and shoot
          from there. Each shot uses up one Arrow they carry, whether it lands or not; out of Arrows
          they fight with their fists and have to walk into contact. Nothing blocks a shot for now.
          A shot is a strike like a blow: the one hit is under attack and fights back or flees,
          their city's alarm goes, and it is a crime where a blow would be. Agility dodges a shot as
          it does a blow, and a shield and armour take damage off it, but a Crossbow's bolt goes
          through part of them. Strength adds nothing to a shot; Combat skill makes a Bow much
          better, a Crossbow only a little.
        </p>
        <table>
          <thead>
            <tr>
              <th>Weapon</th>
              <th>Reach</th>
              <th>A shot every</th>
              <th>Damage</th>
              <th>At full Combat skill</th>
              <th>Through armour</th>
            </tr>
          </thead>
          <tbody>
            {(['bow', 'crossbow'] as const).map((w) => (
              <tr key={w}>
                <td>{goodName(w)}</td>
                <td>{num(SHOT_REACH[w] ?? 0)} tiles</td>
                <td>{duration(SHOT_TICKS[w] ?? 0)}</td>
                <td>{num(SHOT_DAMAGE[w] ?? 0)}</td>
                <td>{num((SHOT_DAMAGE[w] ?? 0) * (1 + (SHOT_SKILL_LIMIT[w] ?? 0)))}</td>
                <td>{pct(SHOT_PIERCE[w] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>Archers by default.</strong> Struck, an archer's Defend default shoots back from
          where they stand, walking only until the one who struck them is in reach. On an alarm, the
          Alarm default sends an archer on the ground up onto the city's wall tile between them and
          whoever they go after, and they shoot from there; up on the wall they wait for them to
          come in reach rather than come down. With no wall between them they shoot from where they
          stand. Out of Arrows an archer does what anyone armed does and closes in. Scripts see a
          resident's <code>reach</code> (null without a Bow or Crossbow) and the Arrows they carry
          in <code>carried.arrows</code>; <code>shoot(targetId)</code> shoots someone in reach
          without a step, and <code>attack</code> walks only until they are in reach.
        </p>
        <p>
          <strong>NPC archers.</strong> An NPC city with a smithy arms {pct(NPC_ARCHER_SHARE)} of
          its soldiers with a Bow (rounded down) and keeps {num(NPC_ARCHER_ARROWS)} Arrows in its
          reserve for each of them; its smithy forges them once its soldiers are armed. Each archer
          carries {num(NPC_ARCHER_ARROWS)} Arrows and fetches more from its storage as they run low.
          While the city has a wall, its archers stand on it and leave the town hall and the gates
          to the others. One without a smithy, and the Trade Organization's cities, keep no archers.
          A resident hired from an NPC city who takes a Bow from its surplus takes Arrows along too,
          also only from its surplus.
        </p>
        <p>
          To <strong>swap</strong> gear, pick another item they carry for a slot on their card (or
          the group card's Equip…, for each of them who carries it), or take a slot's item off;
          scripts do the same with <code>equip(good)</code> and <code>takeOff(slot)</code>, and a
          queue with the Put on gear and Take off gear steps. It takes {duration(EQUIP_TICKS)}, and
          they strike no blows meanwhile, even when struck; an order given under attack still goes.
          What comes off stays carried. A slot taken off stays empty until they pick up more that
          fits it, so a resident can walk unarmed with a sword in the pack.
        </p>
        <p>
          Anyone who sees a resident sees what they have equipped: on the map up close a mark for
          their weapon and shield and a rim for armour, bright for steel and grey for iron, and the
          same on their card, to scripts too. What else they carry stays hidden from other realms,
          as a carriage's load does, unless one of theirs stands on the same tile.
        </p>
        <p>
          Gear <strong>wears</strong>: a weapon with each blow it strikes, dodged or not, a shield
          and armour with each blow they take, and every equipped piece a little in training,{' '}
          {num(TRAINING_WEAR_BLOWS_PER_DAY)} blow's worth a game day. The table says how many blows
          each lasts. Worn out, a piece <strong>breaks</strong> and is gone, and the next best one
          carried takes its slot; until then it fights as well as new. A resident uses up the most
          worn piece of a kind first, and worn gear stays as worn in a storage, a carriage or the
          loot of the fallen. Its <strong>condition</strong> reads good, worn (from {pct(WORN_FROM)}{' '}
          of its life used) or nearly broken (from {pct(NEARLY_BROKEN_FROM)}), on the card and to
          scripts (<code>condition</code>), only for the realm carrying it; anyone else sees just
          its kind and metal.
        </p>
        <p>
          Defenders on their own city's wall take {pct(WALL_DEFENCE)} of the damage. A tile of wall
          takes {num(WALL_STRENGTH.wall)} damage to break and a gate {num(WALL_STRENGTH.gate)}: an
          average unarmed resident alone needs {duration(breakTicks('wall'))} for a wall and{' '}
          {duration(breakTicks('gate'))} for a gate. Of stone, a tile of wall takes{' '}
          {num(STONE_WALL_STRENGTH.wall)} and a gate {num(STONE_WALL_STRENGTH.gate)}:{' '}
          {duration(breakTicks('wall', true))} and {duration(breakTicks('gate', true))} for that
          resident. A broken one leaves {pct(BROKEN_MATERIALS_RETURNED)} of its materials. Climbing
          over takes {duration(CLIMB_TICKS)}, unable to dodge or strike back, and raises the alarm
          as breaking the wall does. So a starting city's armed residents, at home when the attack
          starts, get up onto their wall in time to beat breakers and climbers twice their number.
        </p>
        <p>
          <strong>The wall walk.</strong> Every wall and gate tile has a walk on top, unbroken round
          the ring; whoever is on it is <em>up</em>. Only the city's own realm and its allies get
          up, from the ground next to the wall, and getting up takes {duration(WALL_WALK_TICKS)}, as
          long again to get down. Along the walk is walking, over the gates too, while people pass
          under a gate on the ground. They come down only on the side they went up from, so the walk
          is never a way through the wall. Nobody walks onto a wall on the ground, nor squeezes past
          its corner. A path that ends on the wall counts the time to get up, so your residents go
          up only when you send them there; a path elsewhere never takes the walk. A resident's card
          says “Up on the wall walk”, and scripts see it as <code>me.up</code>. Going after an
          attacker at the wall, by the Alarm default or your order, a resident inside gets up onto
          the walk beside them unless the way round through a gate is quicker; a trading post's and
          the HQ's soldiers do the same.
        </p>
        <p>
          <strong>Towers.</strong> A tower is a {num(FOOTPRINT.tower)} × {num(FOOTPRINT.tower)}{' '}
          building of wood or stone (Build menu, under Defence), standing in a wall's line or alone,
          off resource nodes and not on Mountain. It isn't built over wall tiles: tear those down
          first. Like a wall it closes the way, and its top is part of the wall walk wherever a wall
          tile touches it: residents walk onto it from the walk, or get up onto it from the ground
          beside it as onto a wall. It holds {num(TOWER_ROOM)} residents up at once; one more waits
          beside it until someone leaves. It is broken like a wall but holds out longer: wooden,{' '}
          {num(WALL_STRENGTH.tower)} damage ({duration(breakTicks('tower'))} for that resident), of
          stone {num(STONE_WALL_STRENGTH.tower)} ({duration(breakTicks('tower', true))}), and it is
          struck from beside any of its tiles. Whoever is up on it when it breaks falls, as from a
          wall tile. A tower is broken, not climbed.
        </p>
        <p>
          <strong>Up on a tower.</strong> A resident up on a tower sees {num(TOWER_SIGHT_RANGE)}{' '}
          tiles around instead of {num(SIGHT_RANGE)}, and what they see is your realm's Sight: it
          shows on the map, is explored and kept in Last seen like anything else seen. An outsider
          coming into the city's area that such a lookout sees raises the alarm across the whole of
          its area, so a tower warns of an army early. An archer up on a tower shoots{' '}
          {num(TOWER_SHOT_REACH_BONUS)} tiles further than on the ground, beyond an archer on the
          wall ({num(WALL_SHOT_REACH_BONUS)} further), and up there takes the wall's cover as on the
          wall.
        </p>
        <p>
          <strong>NPC towers.</strong> A tower is part of a city like its wall, and grows its area
          the same way. An NPC town whose outer wall is all of stone builds stone towers, each just
          inside its wall and touching it: first one by each gate, leaving the way in free, then one
          in each corner. It builds each from Stone it holds beyond its reserve, last of its
          projects, and quarries for it if it has to. While it waits to found a daughter it starts
          no new tower, so founding comes first. Its soldiers on wall posts fill its towers first,{' '}
          {num(TOWER_ROOM)} to a tower, its archers before the others. When the town moves its wall
          out, it builds towers on the new wall, and tears the old ones down with the old wall.
        </p>
        <p>
          <strong>The high ground.</strong> Whoever is up strikes down at anyone on the ground next
          to the wall, but nobody on the ground can strike anyone up: from below there is only the
          wall or gate itself to break, or climbing it, both while being struck from above, or
          shooting up at them with a Bow or Crossbow. Order a resident below without Arrows to shoot
          to attack someone up and they won't (“they are up on the wall”). A climber is on the
          ground until over; one who made it and stands on the wall fights those up as anywhere, and
          so do those up on two walls that touch. Up on their own city's wall, defenders still take
          only {pct(WALL_DEFENCE)} of each blow and each shot.
        </p>
        <p>
          <strong>Archers on the wall.</strong> An archer up on a wall walk shoots{' '}
          {num(WALL_SHOT_REACH_BONUS)} tiles further than on the ground: a Bow{' '}
          {num((SHOT_REACH.bow ?? 0) + WALL_SHOT_REACH_BONUS)} tiles, a Crossbow{' '}
          {num((SHOT_REACH.crossbow ?? 0) + WALL_SHOT_REACH_BONUS)}. So archers on a wall shoot
          attackers before those can shoot back, and take only {pct(WALL_DEFENCE)} of what does come
          back up.
        </p>
        <p>
          <strong>A tile breaks.</strong> When a wall or gate tile breaks, whoever is up on it falls
          to the ground next to it on the inside of the ring (on a stretch with no inside, on the
          side toward its city) and loses {num(FALL_DAMAGE)} health. A fall kills like a blow: one
          left with no health, or Down, dies, and what they carried lies there as loot. Those up on
          the tiles next to it stay up.
        </p>
        <h3>Under attack</h3>
        <p>
          A resident of yours who is struck and lives runs their defence script,{' '}
          <strong>Defend</strong> (one of your default scripts): armed, they fight back at whoever
          struck them until that one is dead, gone or out of sight; unarmed, or struck from up on a
          wall where they can't strike back, they walk home to their city's town hall, away from the
          wall, and stop once there or once no blow has landed for {duration(DEFEND_CALM_TICKS)}.
          Their card says “Defending: fighting back at Bo” or “Defending: fleeing home”, with what
          they were doing on the line under it. What they were doing waits meanwhile: once Defend
          ends they go back to it, a script with its memory, a queue at its step, or a plain order.
          Struck again while defending, they keep defending. Scripts see the last blow as{' '}
          <code>me.struckBy</code> and <code>me.struckAt</code>. Residents of NPC cities, and in an
          army, fight back or flee home the same way. Armed neighbours at home who see the blow come
          to help (see Alarms below).
        </p>
        <p>
          <strong>On a carriage:</strong> the carriage is the way out. An unarmed driver drives on
          where they were going, at the same pace, a haul route too, and an armed one fights back
          with the carriage standing, comes back to it if the fight led away, and then goes on. An
          unarmed passenger stays aboard while the carriage is being driven; on one standing still,
          with no driver driving it or its horse Down or dead, they get off and walk home. An armed
          passenger gets off and fights back. A caravan's driver under attack doesn't wait for the
          escort either. Your own defence script decides for itself: a driver's{' '}
          <code>me.order</code> stays their drive or haul route until it gives them another order,
          and a carriage's <code>standsStill</code> says whether anything moves it.
        </p>
        <p>
          An order you give a resident under attack, while their defence script runs or within{' '}
          {duration(DEFEND_CALM_TICKS)} of a blow, ends the defence script and what it interrupted,
          and further blows don't undo it. One that ends by itself, like a walk or a drive to a
          target, stands until it is done or you replace it, however long that takes. What goes on
          until stopped, like a haul route, working, a task, a script or a queue, holds until no
          blow has landed for {duration(DEFEND_CALM_TICKS)}; after that the next blow runs the
          defence script as usual. An order given before the attack is interrupted as usual, and
          what a script or queue requests itself doesn't count as given by you.
        </p>
        <h3>Defence script</h3>
        <p>
          Defend is only the default: on a resident's card, the Script tab's{' '}
          <strong>Defence script</strong> picks any of your scripts for them to run when struck
          instead, a default script such as Work too; the group card picks it for all of them at
          once. If the script has params, you pick them as you pick it, as before a script starts,
          and they are kept for that resident like any script's. Back on “Defend (default)”, they
          defend by Defend again. It runs just as Defend does: in place of what they were doing,
          which goes on once it calls <code>end()</code>. It is kept for the resident, across your
          Leader's death too, and only you see it; scripts read it as <code>me.defenceScript</code>,
          the script's id, or <code>null</code> for Defend. If the script is gone from your library
          when they are struck, they defend by Defend, your realm log says so once, and the pick
          goes back to Defend. A resident lent to another realm defends by that realm's Defend.
        </p>
        <h3>Alarms</h3>
        <p>
          An alarm is something happening in a city's area that your residents at home can react to.
          Four things set it off. An occupation of the city's town hall starting reaches every
          resident of your realm standing in that city's area. An <strong>outsider</strong> coming
          into the area, someone of another realm or NPC city who isn't allied, reaches those
          standing there who see them (within {num(SIGHT_RANGE)} tiles), once as they come in and
          again if they leave and come back. Trade Organization caravans and wandering traders, with
          their crews, don't count, and someone already attacking gets no outsider alarm. A theft
          from your realm in that area, of goods from a storage, a carriage or a Down resident, or
          of a carriage or horse, reaches those standing there who see it; what lies in a pile is
          anyone's to take, so that raises none. An attack, someone striking or climbing a wall or
          gate of the city or striking a resident of yours standing in its area, reaches those
          standing there who see it, so the armed residents beside them react rather than only the
          one struck, who runs their defence script. It is raised once per attacker, the first time
          someone at home sees them at it, and again only after {duration(DEFEND_CALM_TICKS)} with
          no blow from them. Those already fighting aren't interrupted, and someone fighting back
          raises none. Army members, those hired out and those driving a carriage get no alarm. It
          runs their <strong>Alarm script</strong>, which by default is <strong>Alarm</strong> (one
          of your default scripts) for an armed resident and nothing for an unarmed one.
        </p>
        <p>
          Alarm goes after the occupier while they stand in the city's area, any other armed one of
          theirs there after them, and ends once they are gone. It goes after a thief or an attacker
          until they are dead or have left the area or sight; then, while others are still at the
          city's wall or its residents, it goes after the nearest of them in sight, and ends only
          once none is left. Their card says “On alarm: going after Bo”. For an armed outsider it
          walks to the town hall and stands there until no armed outsider is left in the area, then
          goes back to what it was doing; someone armed of yours on the hall blocks an occupation
          before it starts, at no cost in standing. An unarmed outsider it only writes in the script
          log.
        </p>
        <p>
          <strong>Force at home:</strong> in your own city's area, striking someone occupying its
          town hall, or a thief of your realm that you know of or one of your residents saw, is no
          crime and costs no standing. Someone occupying is someone armed standing on the hall, so
          one who has walked off it no longer is. Striking back at an attacker on their alarm is no
          crime either. Striking anyone else there is a crime as anywhere, and so is striking a
          thief outside the area. Scripts see this as <code>knownThief</code> on those{' '}
          <code>residents()</code> gives: whether your realm knows they stole from it or one of your
          residents saw it, no more than that.
        </p>
        <p>
          On a resident's card, the Script tab's <strong>Alarm script</strong> picks any of your
          scripts for them to run instead, an unarmed resident too, or <strong>None</strong> to run
          nothing; the group card picks it for all of them at once. It runs in place of what they
          were doing, which goes on with its memory once it calls <code>end()</code>, as for a
          defence script. A second alarm doesn't interrupt it, with two exceptions: a theft or an
          attack takes over from an outsider alarm, unless they are already attacking someone, and
          an occupation takes over from any other. The script goes on with its memory,{' '}
          <code>me.alarm</code> now the new one, and when it calls <code>end()</code> an outsider
          alarm it took over from goes on. So those holding the hall go after a thief or an
          attacker, then back to holding while armed outsiders remain; should an armed outsider lure
          them away and step onto the hall, the occupation brings them all back. A blow still runs
          their defence script, and once that ends the Alarm script goes on; while a defence script
          runs, or an order you gave under attack holds, an alarm doesn't reach them. An order you
          give meanwhile ends both. Scripts read the alarm as <code>me.alarm</code>: its{' '}
          <code>kind</code>, <code>about</code> who and their <code>realmId</code>, where (
          <code>cityId</code>, <code>x</code>, <code>y</code>) and <code>tick</code>;{' '}
          <code>inCityArea(cityId, x, y)</code> says whether a tile lies in a city's area,{' '}
          <code>cityAreaAt(x, y)</code> which city's area it lies in, and{' '}
          <code>outsidersIn(cityId)</code> lists the outsiders you see in one. The pick reads as{' '}
          <code>me.alarmScript</code>. If the script is gone from your library when an alarm comes,
          your realm log says so once and the pick goes back to Alarm.
        </p>
        <h3>Capturing a city</h3>
        <p>
          A city is captured by occupying its town hall: armed residents of your realm stand on it
          (any of its tiles), nobody else's armed residents do, and none of the city's defenders do
          (armed residents of its realm or an ally, or for an NPC city its own). An ally of yours on
          the hall counts as another realm, so nobody occupies it. Held {days(OCCUPATION_GAME_DAYS)}{' '}
          without a break, the city joins your realm with its buildings and the residents who live
          there, loyal at once; its Leader never joins. Beating its defenders is not enough on its
          own, and defenders elsewhere in the city don't stop the clock: they have to come to the
          hall. An NPC city's soldiers, a trading post's and the HQ's do: anyone occupying their
          town hall is an attacker to them, even one who attacks nobody, and those in the city's
          area go after them, which is no crime. The first tick the occupation doesn't hold, it is
          broken and its days are lost; the next one starts again from nothing. Your realm log says
          when one of your town halls is occupied, by whom, and when the occupation is broken, and
          likewise when you occupy a town hall and when your occupation is broken. Every city is
          captured this way: NPC cities, Players' cities, trading posts and the Trade Org HQ, whose
          hired mercenaries defend it. Anyone with the town hall in sight sees who occupies it and
          the game days left: a small flag in the occupier's colour on the hall, and "Occupied by …"
          on its tile card and in the city inspector, a warning when it is your city. Out of sight
          it isn't shown, nor remembered in Last seen. Scripts see it as{' '}
          <code>city.occupation</code>: who occupies a town hall in sight, and the ticks left.
        </p>
        <h3>The fall of the HQ</h3>
        <p>
          Taking the Trade Org HQ is hopeless in practice but not forbidden, and it changes the
          world for good: nothing ever takes its place. The captor gets the city with its people,
          wherever they stand, and its warehouses as storages with everything in them, coins
          included. Caravans end at once: their crew join the captor where they stand, each
          carriage, horse and load going with them. Deliveries and transfers still open are
          cancelled with a line in your realm log and nothing refunded, and trading posts take no
          new ones. Every contract with the Trade Organization ends at once, with no refund and no
          loss of standing: soldiers you hired from it are the captor's where they stand, and your
          mercenaries guarding the HQ walk home. Its punishments and debts end, and admin directives
          stay in force and can be bought off at a post, but it sends nobody out for them. With no
          caravans or wandering traders the posts' warehouses get only what their own hands bring
          and what people sell them. When the last trading post falls too, the Trade Organization is
          gone.
        </p>
        <h3>What joins with a city</h3>
        <p>
          However a city joins a realm, captured, bought, persuaded or handed over, its horses and
          carriages come with it. An NPC city's are all its own, wherever they stand, at a stable or
          on the road. A Player's aren't tied to one city, so of those the ones in its area or at
          its stables join, and the rest stay with their realm. Either way a horse a joining
          resident rides and a carriage one drives join with them, and a carriage's hitched horse
          with it. Another NPC city's or realm's that happen to stand there don't.
        </p>
      </Section>

      <Section id="siege">
        <p>
          A <b>siege machine</b> is a machine of a realm, built in the field where it is needed, so
          a siege needs a supply line like an army. There are two: a <b>ram</b>, a roofed frame on
          wheels round a heavy beam, and a <b>catapult</b>, which throws Stone at walls from far
          off. NPC cities and the Trade Organization don't build them, for now.
        </p>
        <p>
          <b>Building a ram.</b> A resident lays out a <b>ram site</b> with Build (in the Build menu
          under Siege) on any tile a carriage could stand on, off resource nodes and buildings, one
          to a tile. It is a construction site like any other: it takes {goods(ramCost().materials)}{' '}
          and {duration(ramCost().buildTicks)} of one average resident's work, carried there and put
          in by anyone. Once finished the site is gone and a ram of the realm of whoever finished it
          stands on its tile.
        </p>
        <p>
          <b>Crew.</b> Residents of its realm join its <b>crew</b> with Crew the ram on its card:
          they walk onto its tile, following it if it moves, and are its crew while they stand
          there. Children don't crew it. With at least {num(RAM_CREW)} of its crew on it, one of
          them <b>pushes</b> it (Push the ram to…) to a tile a carriage could go to, along a way a
          carriage could take: a tile of Plains takes about {duration(ramPushTicks()[0]!.ticks)}, of
          Forest or Hills {duration(ramPushTicks()[1]!.ticks)} and of road{' '}
          {duration(ramPushTicks()[2]!.ticks)}. The crew go along on its tile. One who walks off is
          no longer of its crew, and below {num(RAM_CREW)} it stops where it is.
        </p>
        <p>
          <b>Ramming.</b> Pushed next to a wall or gate of another realm's city, or of nobody's, one
          of its crew swings it with the whole crew (Ram the gate on its card, or{' '}
          <code>ram(machine, wall)</code> in a script). It strikes every{' '}
          {duration(RAM_STRIKE_TICKS)} for {num(RAM_BLOW)} damage, far harder than any blow: a tile
          of wooden wall falls in {duration(ramBreakTicks('wall'))}, a stone gate in{' '}
          {duration(ramBreakTicks('gate', true))}. Each strike raises the alarm as a blow at the
          wall does, and breaking another realm's wall is a crime of tearing down, as by hand. Below
          its crew size it stops. Its crew is under its roof: nobody up on a wall strikes them, and
          no shot reaches them, so defenders have to come down and out to fight them or to strike
          the ram, which is struck only from the ground.
        </p>
        <p>
          <b>Breaking and tearing down.</b> Anyone may attack a ram of another realm, as a wall:
          every blow lands, and after {num(RAM_STRENGTH)} damage it breaks, leaving{' '}
          {goods(ramCost().broken)} on its tile. Breaking another realm's ram is a crime of tearing
          down. Its own realm tears it down from its tile in {duration(ramCost().teardownTicks)} of
          one average resident's work, which leaves {goods(ramCost().tornDown)}.
        </p>
        <p>
          <b>The catapult.</b> It is built, crewed, pushed, broken and torn down as a ram is: its
          site (Build, under Siege) takes {goods(ramCost('catapult').materials)} and{' '}
          {duration(ramCost('catapult').buildTicks)} of one average resident's work, it needs{' '}
          {num(CATAPULT_CREW)} of its crew on it, and it breaks after {num(CATAPULT_STRENGTH)}{' '}
          damage. One of its crew aims it with the whole crew (Throw Stone at… on its card, then the
          wall on the map, or <code>throw(machine, wall)</code> or <code>throw(machine, x, y)</code>{' '}
          in a script) at a wall, gate or tower of another realm's city, or of nobody's, within{' '}
          {num(CATAPULT_REACH)} tiles: well beyond a Bow's{' '}
          {num((SHOT_REACH.bow ?? 0) + WALL_SHOT_REACH_BONUS)} from up on a wall. Every{' '}
          {duration(CATAPULT_SHOT_TICKS)} it throws one Stone for {num(CATAPULT_BLOW)} damage: a
          tile of wooden wall falls to {num(catapultBreak('wall').shots)} Stone in{' '}
          {duration(catapultBreak('wall').ticks)}, a stone gate to{' '}
          {num(catapultBreak('gate', true).shots)} in {duration(catapultBreak('gate', true).ticks)}.
          The Stone is what its crew carry, then what lies on its tile; out of Stone it stops. It
          hits the building only, never anyone on it or by it. Each shot raises the alarm and
          breaking another realm's wall is a crime, as with a ram. Its crew stands in the open:
          archers in reach shoot them and anyone can strike them.
        </p>
        <p>
          A ram shows on the map to whoever sees its tile, with whose it is and its crew, but Last
          seen doesn't keep it, as it moves. A ram of a realm that ends belongs to nobody. Scripts
          see the machines in sight with <code>machines()</code>, join a crew with{' '}
          <code>crew(machine)</code> and push one with <code>push(machine, x, y)</code>.
        </p>
      </Section>

      <Section id="territory">
        <p>
          Cities and guarded workplaces project control. A city starts at {num(TERRITORY_CITY_BASE)}
          , a guarded workplace at {num(TERRITORY_WORKPLACE_BASE)}; each resident adds{' '}
          {num(TERRITORY_PER_RESIDENT)} and each armed one {num(TERRITORY_PER_ARMED)} more. Control
          reaches {num(TERRITORY_REACH_PER_ROOT)} tiles times the square root of its strength, at
          most {num(TERRITORY_MAX_REACH)} tiles, fading with distance; where two overlap, the
          stronger wins.
        </p>
        <p>
          The Region map shows territory over all the terrain you explored, one colour per
          Organization (an alliance’s members share one). Zoomed far out it is filled in; at the
          middle and close zoom only its borders show, unless the Region map button is on.
        </p>
        <table>
          <thead>
            <tr>
              <th>City</th>
              <th>Control</th>
              <th>Reach</th>
            </tr>
          </thead>
          <tbody>
            {[
              cityControl(0, 0),
              cityControl(START_RESIDENTS, 0),
              cityControl(START_RESIDENTS, START_RESIDENTS / 2),
              cityControl(START_RESIDENTS * 4, START_RESIDENTS),
            ].map((c) => (
              <tr key={`${c.residents}-${c.armed}`}>
                <td>
                  {num(c.residents)} residents, {num(c.armed)} of them armed
                </td>
                <td>{num(c.strength)}</td>
                <td>{num(c.reach)} tiles</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="language">
        <p>
          Scripts are written in the game's own small language. It reads much like JavaScript, with
          less of it.
        </p>
        {SCRIPT_LANGUAGE.map((rule) => (
          <div key={rule.title}>
            <h3>{rule.title}</h3>
            <p>{withCode(rule.text)}</p>
            {rule.example && (
              <pre>
                <code>{rule.example}</code>
              </pre>
            )}
          </div>
        ))}
      </Section>

      <Section id="api">
        <p>
          What a script gets from the game. Values are read like names; queries and actions are
          called. Every call costs one step, and its cost here on top. Queries answer from what you
          see and have explored, nothing more; the helpers <code>floor</code> and{' '}
          <code>pickRandom</code> work only on what you give them. An action asks for the order of
          its name for <code>me</code>, checked exactly as one from the map, and answers{' '}
          <code>null</code> when asked for, or why not. Four actions ask for no order.{' '}
          <code>doing</code>: its text, at most {num(DOING_MAX_LENGTH)} characters, is what the
          resident card and list say the resident is doing, until the script says something else;
          only you see it. Without it they show what the task and its current order have the
          resident doing, such as “Building a house: fetching 10 wood from the storage”.{' '}
          <code>end</code>: once this run is over the script ends and the resident stands idle; in a
          queue, its next step starts; a defence script hands back to what it interrupted. Given a
          reason, <code>end(reason)</code> also notes it in your realm log, like “Ana stopped Work:
          no workplace on her tile”: short text, cut like <code>doing</code>’s, that only you see,
          for every end. <code>log</code>: adds a short line, cut like <code>doing</code>’s, to the
          resident's script log, with the game time. <code>wait</code>: once this run is over the
          script is not run again until the resident's order ends or is replaced, or they are
          struck; then it runs every tick again. With no order it does nothing. The defaults wait
          after every walk, store and fetch, and Breed horses while it tends, so a resident on the
          move costs no step; the resident card says “script waiting”, and an edited copy of a
          default waits just the same. The Build and Tear down defaults end once the site is
          finished or the building is gone; a script that never calls <code>end</code> runs until
          another order ends it. A script runs as a resident's or as an army's: names marked
          resident only or army only are only there for one of them, and a default script runs as a
          resident's.
        </p>
        <h3>Values</h3>
        <ApiTable is="value" />
        <h3>Queries</h3>
        <ApiTable is="query" />
        <h3>Actions</h3>
        <ApiTable is="action" />
        <h3>Script views</h3>
        <p>
          What a script gets of each kind of thing. Every field listed is always there; one you
          aren't allowed to see, or that doesn't apply, is <code>null</code>, as its last column
          says. A script sees no other fields. The game may add fields at any time; when one is
          renamed or removed, each Player whose scripts read it is told in their realm log, with the
          field and the scripts.
        </p>
        {(
          Object.entries(SCRIPT_VIEWS) as [ScriptViewName, (typeof SCRIPT_VIEWS)[ScriptViewName]][]
        ).map(([name, view]) => (
          <div key={name} id={`view-${name}`} className="wiki-section">
            <h4>
              <code>{name}</code>
            </h4>
            <p>{withCode(view.description)}</p>
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Holds</th>
                  <th>What it is</th>
                  <th>null</th>
                </tr>
              </thead>
              <tbody>
                {view.fields.map((f) => (
                  <tr key={f.name}>
                    <td>
                      <code>{f.name}</code>
                    </td>
                    <td>{typeNode(f.type)}</td>
                    <td>{withCode(f.description)}</td>
                    <td>{f.nullWhen ? withCode(f.nullWhen) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Section>

      <Section id="params">
        <p>
          A script can ask for values you pick for whoever runs it, such as which storage the output
          goes to. Each is a <code>param</code> line at the very top of the script, read further
          down as <code>params.name</code>. A <code>param</code> line anywhere else is a syntax
          error.
        </p>
        <pre>
          <code>{`param storage: storage
if (params.storage != null) { store(["wood"], params.storage) }`}</code>
        </pre>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Holds</th>
            </tr>
          </thead>
          <tbody>
            {SCRIPT_PARAM_TYPES.map((t) => (
              <tr key={t}>
                <td>
                  <code>{t}</code>
                </td>
                <td>{PARAM_DESCRIPTIONS[t]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul>
          <li>
            Starting at once: giving a task or Run script starts it in one tap, with the values the
            resident keeps or the defaults; in a group each one goes on with their own.
          </li>
          <li>
            Before it starts: a Customise button beside the order, on the resident card, the group
            card and in Add step, shows its params, filled with those values. Change what you like
            and press Start; Cancel gives nothing. Each param's <code>?</code> says what it is for.
            On a phone the form rises from the bottom of the screen, with Start and Cancel always in
            view. For a group the form shows once, and each of them gets the same values. With Shift
            held the step added to the queue keeps the values. An order whose script has no params
            to show has no Customise.
          </li>
          <li>
            The form opens by itself only when a param has no default and no <code>none:</code> in
            its comment, since the script has nothing to go on without it. Give each param one or
            the other to start your script in one tap.
          </li>
          <li>A defence script starts nothing, so its params are still shown when you pick it.</li>
          <li>
            A resident's card shows one field for each param of the script they run: pick it on the
            map, or clear it. A <code>number</code> param has a number field instead: type a whole
            number of zero or more and press Enter. A <code>choice</code> param has a list of its
            words, and a <code>waypoint</code> param a list of your waypoints (or pick its marker on
            the map); the first entry in either list leaves it unset. None of them stops the script.
          </li>
          <li>
            The comment at the end of a <code>param</code> line is what the card shows: what the
            param is for, and after <code>none:</code> what the script uses while none is picked.
            Each field says the value the script uses: the one picked, else a <code>number</code>{' '}
            param's default, a default script's target the one on their tile, or what the comment
            says after <code>none:</code>.
            <pre>
              <code>{PARAM_COMMENT_EXAMPLE}</code>
            </pre>
          </li>
          <li>
            A group's card sets a <code>number</code> param for each of them running a script with
            it.
          </li>
          <li>
            The values are kept for each resident and each script. Giving the task again keeps them;
            a param removed from the script is dropped, and a new one starts unset.
          </li>
          <li>
            A <code>building</code> param can name a workplace or construction site of anyone's you
            know, in sight or last seen; out of sight the card names it with "(last seen)" and the
            script reads it as you last saw it. A param reads <code>null</code> while none is
            picked, and once the one picked is gone or no longer one it may name. A{' '}
            <code>number</code> param reads the number typed, or <code>null</code> while unset. A{' '}
            <code>choice</code> param reads the word picked as a string; a word the script no longer
            lists is dropped. A <code>waypoint</code> param reads the waypoint, with its{' '}
            <code>id</code>, <code>name</code>, <code>x</code> and <code>y</code>; once you remove
            the waypoint it reads as unset.
          </li>
          <li>
            A <code>number</code> param may have a default: <code>= n</code> after its type, a whole
            number of zero or more. Unset, it reads the default; the number typed wins over it, and
            clearing the field goes back to it. Its field shows the default while unset. A{' '}
            <code>choice</code> param may have one too, one of its words: <code>= north</code> after
            its list. A <code>building</code>, <code>storage</code> or <code>waypoint</code> param
            can't have one.
            <pre>
              <code>{PARAM_DEFAULT_EXAMPLE}</code>
            </pre>
          </li>
          <li>
            A <code>choice</code> param lists the words it can be in brackets after its type, each
            once; a default that is not one of them is a syntax error. A <code>waypoint</code> param
            is one of your waypoints.
            <pre>
              <code>{PARAM_CHOICE_EXAMPLE}</code>
            </pre>
          </li>
          <li>
            The Work default has <code>workplace</code>: the workplace to work, the one they stand
            on while none is picked; it is never kept between starts, so Customise on Run script
            shows it empty, and giving Work on a workplace fills it without asking. It also has{' '}
            <code>storage</code>: the main storage, for the output, inputs and Food; and{' '}
            <code>output</code>, <code>input</code> and <code>food</code>, each taking its place for
            that one use when picked. The Build default has <code>site</code>: the construction site
            to join; and <code>source</code>: where materials come from, a carriage too. Unset, each
            uses the nearest storage; a source picked that holds none of what the site lacks is left
            alone, and they just build. The Haul default has <code>carriage</code>: the carriage to
            drive. The Tear down default has <code>building</code>, the Breed horses and Feed the
            stable defaults <code>stable</code>. Like Work's <code>workplace</code>, each of these
            is the one they stand on while none is picked, never kept between starts, and filled by
            giving the task. Feed the stable also has <code>source</code>: where the Food comes
            from. The Tear down default has <code>source</code>: where Food comes from. The Build,
            Build line and Tear down defaults also have <code>food</code>: where Food comes from,
            their <code>source</code> while none is picked. The Work, Build and Tear down defaults
            also have the <code>number</code> params <code>foodAt</code> (default {num(GET_FOOD_AT)}
            ; 0 turns it off) and <code>foodTake</code> (default {num(GET_FOOD_TAKE)}) for getting
            food, in units of Food (a resident eats about {num(foodEatenPerDay())} a game day). Work
            also has <code>crewFood</code> (default {num(CREW_FOOD)}; 0 brings none): the Food the
            workplace's pile keeps for the crew, which the carrier tops up on the way back from the
            storage.
          </li>
        </ul>
        <h3>Workplace settings</h3>
        <p>
          How a workplace is worked belongs to the workplace, not to each worker. On the card of a
          workplace, or of a construction site of one, open Work settings: pick its work script and
          set that script's params there, once for the whole crew.
        </p>
        <ul>
          <li>
            The work script is your Work default, or any script of yours that declares{' '}
            <code>param {WORKPLACE_PARAM}: building</code>. Switching to another one starts its
            values over, and everyone working there by the settings switches to it, as if given Work
            again.
          </li>
          <li>
            Each of its params but <code>{WORKPLACE_PARAM}</code>, which is the workplace itself,
            has a field as on a resident's card: pick it on the map or type a number, and clear it.
            Each shows its comment and the value it uses.
          </li>
          <li>
            You can set them for any workplace your realm knows: your own, or anyone's in sight or
            last seen. Two realms working the same farm each keep their own, and neither sees the
            other's. NPC cities keep none.
          </li>
          <li>
            Your scripts read them on a building as <code>workSettings</code>: the work script's id
            (<code>null</code> for the Work default) and the values set by name.
          </li>
          <li>Settings of a workplace that is gone go with it.</li>
        </ul>
        <h4>Working by the settings</h4>
        <ul>
          <li>
            Giving a resident Work at a workplace, from their card, a group card or a queue step,
            runs its work script, at once. Customise shows its params filled with the workplace's
            values.
          </li>
          <li>
            A value you change in that form becomes that resident's own, an override. What they kept
            for that script before doesn't carry over, with Customise or without.
          </li>
          <li>
            While they work there, each param reads their override, else the workplace's value, else
            the script's default. Their card says which: a value "from the workplace", or "their
            own" with a button back to the workplace's.
          </li>
          <li>
            Changing a value on the workplace's card reaches everyone working there without an
            override at once, from their next use of it.
          </li>
          <li>
            A script you give by hand with Run script stays the resident's own choice and reads only
            their own values.
          </li>
        </ul>
      </Section>

      <Section id="scripts">
        <p>
          Scripts run once a tick (a real second) for each resident or army running them. Each
          evaluated step costs one; asking for a list of things costs {num(SCRIPT_LIST_QUERY_COST)}{' '}
          more, a question about a tile {num(SCRIPT_TILE_QUERY_COST)} more, and requesting an action{' '}
          {num(SCRIPT_ACTION_COST)} more. Declaring a function costs nothing; calling it costs the
          steps of the call and of what the function does.
        </p>
        <ul>
          <li>Each resident's or army's script: {num(SCRIPT_STEP_BUDGET)} steps a tick.</li>
          <li>Function calls nest at most {num(SCRIPT_MAX_CALL_DEPTH)} deep.</li>
          <li>A script's memory holds at most {num(SCRIPT_MEMORY_MAX)} characters of JSON.</li>
          <li>
            A value passed to an action or <code>withMemory</code> holds at most{' '}
            {num(SCRIPT_ACTION_VALUE_MAX)} characters of JSON.
          </li>
          <li>
            One value a script builds is bounded: a string holds at most{' '}
            {num(SCRIPT_MAX_STRING_LENGTH)} characters, a list {num(SCRIPT_MAX_LIST_LENGTH)} items
            and an object {num(SCRIPT_MAX_OBJECT_KEYS)} keys. Past that the script stops with a
            runtime error, like a call too deep.
          </li>
        </ul>
        <p>
          The Library has its caps too: it holds at most {num(SCRIPT_LIBRARY_MAX_SCRIPTS)} scripts,
          your default scripts among them, and each script keeps at most {num(SCRIPT_MAX_VERSIONS)}{' '}
          versions. A save past either is refused and says so next to the Save button: delete old
          versions, or whole scripts, to make room. The versions the game adds to a default script
          you haven’t edited don’t count against you.
        </p>
        <p>
          To debug a script, open the Script tab of a resident or army running it: it shows the
          script's memory and params as they are now, changing every tick. You can't change memory
          there. Only you see the memory of your scripts; a large one is shown cut.
        </p>
        <p>
          The Script tab also shows the steps the script used last tick out of its{' '}
          {num(SCRIPT_STEP_BUDGET)}, marked when it ran out, and its last runtime error with the
          line and how long ago. The error stays until the script ends or you save a new version;
          click it to open that line in the Library. Errors still go into the realm log as well.
          Should the game itself hit an error running a script, that script ends as if it had called{' '}
          <code>end()</code>, your realm log says so once, and everything else goes on.
        </p>
        <p>
          The Script tab of your resident also shows their script log, newest first: the lines their
          scripts gave <code>log(text)</code> and the reasons they gave <code>end(reason)</code>,
          each with its game time. A resident keeps their last {num(SCRIPT_LOG_LINES)} lines across
          scripts, so it still shows why the last one ended after it did; once full, the oldest line
          goes. Only you see it: it never goes in the realm log, to other Players or to scripts. The
          game’s default scripts log their decisions and turns, never every tick, like “pile full:
          carrying 10 stone to the storage at 12,6” or “low on Food (2): fetching 6 at the storage
          at 12,6”.
        </p>
      </Section>

      <Section id="examples">
        <p>
          The game's default scripts, as they are now: what residents run for a task you give them
          on the map, and Defend, which they run when struck. Each Player has their own copy to edit
          in the script editor; here they are to read.
        </p>
        {Object.entries(DEFAULT_SCRIPTS).map(([task, s]) => (
          <div key={task}>
            <h3>{s.name}</h3>
            <pre>
              <code>{s.source}</code>
            </pre>
          </div>
        ))}
      </Section>
    </main>
  )
}
