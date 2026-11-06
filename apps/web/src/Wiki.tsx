import { useEffect, type ReactNode } from 'react'
import {
  PARAM_DESCRIPTIONS,
  WORKPLACE_PARAM,
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_STEPS,
  SCRIPT_PARAM_TYPES,
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
  DIRECT_OFFERS_TO_ONE_REALM,
  DIRECT_OFFER_DAYS,
  PASSENGER_WEIGHT,
  CARRIAGE_MAX_CAPACITY,
  CARRY_BASE,
  CARRY_PER_STRENGTH,
  CARRYING_DAYS,
  PAIRING_WAIT_DAYS,
  CHILD_STAT_SPREAD,
  CHILD_YEAR_DAYS,
  CITY_AREA_MARGIN,
  CITY_BUILDING_REACH,
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  CITY_PRICE_STANDING_SWING,
  CLIMB_TICKS,
  COMBAT_SKILL_EFFECT,
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
  DRIVING_SKILL_PER_DAY,
  STARVE_DAYS,
  DOWN_DAYS,
  FEED_UNITS,
  NPC_REVIVE_REACH,
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
  MAX_HEALTH,
  MIN_BLOW_DAMAGE,
  OCCUPATION_GAME_DAYS,
  NPC_ALLIANCE_JOIN_STANDING,
  NPC_ALLIANCE_LEAVE_STANDING,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  FOOD_PER_DAY,
  NPC_BUILDERS,
  NPC_ROAD_CREW,
  NPC_ROAD_LONGEST,
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_FOOD_DAYS,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_REACH,
  NPC_FOUND_STANDING,
  NPC_FULL_DAYS,
  NPC_VILLAGE,
  NPC_NODE_REACH,
  NPC_RESIDENTS_PER_SCOUT,
  NPC_SCOUT_LIMIT,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_OFFER_REACH,
  NPC_TRADER_REACH,
  NPC_PLAN_TICKS,
  NPC_SURPLUS_CAP,
  NPC_SMITHY_WEAPON,
  NPC_SOLDIER_SHARE,
  NPC_WAR_CHEST_PER_RESIDENT,
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
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  SCRIPT_TILE_QUERY_COST,
  LAST_SEEN_EVERY_TICKS,
  SIGHT_RANGE,
  STABLE_BREED_DAYS,
  STABLE_CAPACITY,
  FOAL_STAT_SPREAD,
  BREED_FOOD,
  STABLE_FEED_DAYS,
  DEFEND_CALM_TICKS,
  STANDING_CONTRACT_BROKEN_LOSS,
  STANDING_DRIFT_PER_DAY,
  STANDING_PER_PAID_WEEK,
  DEMANDS_PER_GAME_DAY,
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  DEMAND_TRADE_ORG_STANDING_LOSS,
  DEMAND_YIELD_RESPECT_MIN,
  DEMAND_YIELD_RESPECT_TIMES,
  STANDING_RANGE,
  STANDING_TRADE_COINS_PER_POINT,
  START_RESIDENTS,
  STAT_BASE_MAX,
  STAT_BASE_MIN,
  STRIKE_TICKS,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
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
  WALK_TICKS_PER_TILE,
  aboutTime,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  WEAPON_ATTACK,
  WORK_SKILL_EFFECT,
  WORK_SKILL_MAX,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_SKILL,
  RECIPES,
  BATCHES_PER_DAY,
  WORK_OUTPUT_PER_DAY,
  carryCapacity,
  walkSpeed,
  workFactor,
  type BuildingKind,
  type CrimeKind,
  type Good,
  type Stock,
  DEFAULT_SCRIPTS,
  SCRIPT_VIEWS,
  type ScriptType,
  type ScriptViewName,
} from '@csp/shared'
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
  carriageCost,
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

/** The Wiki's topics, in order, each a section with its own anchor (`/wiki#food`). */
export const WIKI_TOPICS = [
  { id: 'controls', title: 'Controls' },
  { id: 'queues', title: 'Queues' },
  { id: 'time', title: 'Time & map' },
  { id: 'waypoints', title: 'Waypoints' },
  { id: 'exploring', title: 'Exploring' },
  { id: 'terrain', title: 'Terrain & walking' },
  { id: 'residents', title: 'Residents & stats' },
  { id: 'training', title: 'Training' },
  { id: 'food', title: 'Food & hunger' },
  { id: 'work', title: 'Workplaces & output' },
  { id: 'building', title: 'Building & tearing down' },
  { id: 'transport', title: 'Carrying & transport' },
  { id: 'how-to-trade', title: 'How to trade' },
  { id: 'trade', title: 'Trade & prices' },
  { id: 'standing', title: 'Standing & reactions' },
  { id: 'demands', title: 'Demands' },
  { id: 'combat', title: 'Combat & walls' },
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
  const strong = wikiResident({ strength: avg * 1.5 }, { mining: WORK_SKILL_MAX / 10 })
  const strongAgile = wikiResident({ agility: avg * 1.5 })
  const plainsTicksPerTile = 1 / walkSpeed(AVERAGE, Terrain.Plains, 0)
  const unarmed = blow()
  const sword = blow({ sword: 1 })
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
          What a click picks on a tile goes in this order, at every zoom: one of your residents
          there, then a building, then the bare tile, each showing its card. A carriage of yours, or
          a horse of yours nobody rides, counts like a building. A click on a stack of your
          residents (a token with a count, or the +N badge up close) picks them all as a group; its
          card’s Members tab picks one of them. A stack with someone else’s residents in it opens
          the tile card instead, which lists them all. With a mouse, what a click would pick is
          outlined while you hover over it, in its owner’s colour; on a touch screen a tap picks by
          the same order.
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
          any more stays greyed out, saying why (“nobody stands on a carriage of your realm”).
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
            <strong>Get off</strong> gets every passenger among them off. See Passengers.
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
          A queue gives a resident a list of steps to do one after another, up to{' '}
          {num(QUEUE_MAX_STEPS)} of them. A step is any order you could give them on its own: walk
          to, pick up, drop, store, fetch, drive, unhitch a horse, mount or dismount, board or get
          off a carriage, work, build, haul, feed the stable, breed horses, tear down, Build line
          (road or wall), relocate to another of your cities, or run one of your scripts with its
          params.
        </p>
        <p>
          To plan ahead, use <strong>Add step</strong> under the queue on the resident's card: it
          lists every kind of step. One that acts on a place (work a workplace, build, store at or
          fetch from a storage, pick up, feed the stable, breed, …) has you pick that place on the
          map, anywhere, not only where the resident stands now; one that needs more (which goods,
          what to build, what a smithy makes, which script) asks for it on the card after. What to
          build is the same Build menu as on the card; a kind dimmed because the tile lacks
          something today, such as a city's area, can still be added, for a step before it may bring
          that. A step that has to be done on its tile goes after a walk there, unless the step
          before already walks there. It works on a resident with no queue too, and starts one.
          Adding a step only checks that it could make sense (the place is there as you last knew
          it, and a carriage or horse is yours). A workplace or construction site can be anyone's,
          in sight or as last seen, since a workplace has no owner: queue Work at a far mine and
          they walk there and work it. Whether a step can start is checked when its turn comes.
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
          in it. Drag a step or use its arrows to reorder it, remove it, type a duration in game
          minutes (the real time shows beside it) or clear it, and switch loop on or off.
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
          To keep a plan, <strong>Save…</strong> it under a name, such as “Mine run”; saving under a
          name already taken asks before it overwrites. <strong>Load…</strong> lists the saved
          queues with their step count and date, to load one or delete it; loading adds its steps
          after the planned ones, in any resident's planner or a group's. Saved queues are kept in
          this browser, as saved groups are: the server never sees them, and another browser has its
          own. A saved step keeps its places, so one whose building is gone from the map (torn down,
          say) is flagged in the planner; it is still given, and skipped when its turn comes.
        </p>
        <p>
          To do some steps several times in a row, pick them (in a row) and press{' '}
          <strong>Repeat</strong>: they are wrapped in a repeat block, done {num(DEFAULT_REPEAT)}{' '}
          times until you type another count. The block shows its count with its steps indented
          under it; it is picked, moved, copied, pasted, saved and removed as one,
          <strong> Unwrap</strong> puts its steps back as they were, and a block can hold another.
          Repeat blocks are the planner's own: on a resident's card, wrapping steps opens a plan of
          their queue that waits for <strong>Give</strong> (or Discard), and giving it, or Give to
          all on a group's plan, makes each block that many plain copies of its steps, so the queue,
          the server and your scripts only ever see steps. The running queue lists the copies, the
          current one marked. A queue holds at most {num(QUEUE_MAX_STEPS)} steps after repeats; the
          planner counts them and won't give a plan over that, saying by how much. Loop still loops
          the whole queue.
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
          resource node to look for (forest, stone, iron ore or gold ore), or none to just explore
          until you stop them; <code>toward</code>, a compass direction, or a <code>waypoint</code>{' '}
          to head for instead; with neither they take the nearest unexplored land first.{' '}
          <code>food</code> is where they refill; with none picked, the nearest storage of your
          realm with Food.
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
                <td>{pct(TERRAIN_SPEED[Terrain[t]])}</td>
                <td>{pct(TERRAIN_FOOD[Terrain[t]])}</td>
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
          {num(TRAIN_SKILL_FACTOR)} times as fast as by working, and Combat to its most in{' '}
          {days(trainingDays('combat'))}. Training costs time and the food trainees eat; nothing
          trained decays, though old age shrinks a trained stat with its base.
        </p>
        <p>
          Players' residents train, by order, queue step or script. NPC cities and the Trade
          Organization train nobody yet.
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
          first round trip.
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
          its pile. Once they lack the input for a batch (Iron ore, Gold ore, or the Iron and Wood
          of what a smith makes), one worker at a time, picked at random, fetches a load of what is
          missing from their <code>input</code> storage, else their <code>storage</code>, else the
          nearest storage of their realm holding it, puts it on the pile and goes back to work; not
          while someone carries the output. With none anywhere they stand idle.
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
            {buildCosts().map((b) => (
              <tr key={b.kind}>
                <td>{kindName(b.kind)}</td>
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
          {num(DRIVING_SKILL_PER_DAY)} a game day of driving. Carriages can't enter mountains.
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
          drive, which is no theft.
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
          already; a diagonal wall line closes the way like a straight one. The tiles your
          residents' road and wall lines still have to build, running or waiting in their queues,
          show faintly on your map, the picked residents' stronger; only you see them.
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
          paused breeding and how far along it is. The progress is lost only when one of the two
          leaves the stable or dies. The Breed horses default first takes {num(BREED_FOOD)} Food
          from the stable for the resident's meals, if they carry less. NPC cities have one of their
          residents breed their horses the same way.
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
          <strong>Refilling from a carriage:</strong> passengers and the driver eat the food they
          carry, and when they run low take a meal from the carriage's Food (passengers also from
          another carriage of your realm on or next to their tile), as at home, so a carriage with
          Food on board keeps them fed on a long drive. The Food a haul route keeps on board is left
          for the horse and the driver: passengers don't touch it, and the driver leaves the horse's
          share of {num(HAUL_HORSE_FOOD)}. On a carriage without Food they go hungry like anyone
          away from home.
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
          comes to hold goods it doesn't produce, and caravans carry no Food or Coins, so a post gets
          those only from traders. The HQ is a
          stop like a post, its Coins going through its coin warehouse and its other goods through
          its goods warehouse, so new Food and Coins reach the posts, and a trader's lost escorts
          are made up there each time round. Its crew and a lost carriage go as for a caravan, and
          robbing one is a theft from the Trade Organization, but it owes nobody a delivery, so
          nothing is sent again.
        </p>
        <p>
          A caravan or trader leaves the HQ only with enough Food for its crew and horse to reach its
          next stop, so when the HQ is short, as in a new world, its carriages stand and wait. They
          leave the storage what the HQ's own people eat in {num(HQ_PEOPLE_FOOD_DAYS)} days, but may
          always take {num(WAITING_HORSE_FOOD)} Food for the horse. Short of Food, they top up from
          the goods warehouse, which the stock floor fills each day, so buying Food there can keep
          them waiting a little longer. A caravan with a delivery or transfer waiting wants all it
          keeps on board, as there is no Food on that way. Away from the HQ nothing waits: a
          carriage takes what a post's storage has and drives on.
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
          Standing). If they are killed on the way and no trader ever gets there, it never reacts.
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
          Under <strong>Direct offers</strong> on the tool rail you can send an offer to one realm
          you know of: one you see residents of, an ally, one whose city you have seen, one with a
          standing either way, or your side in a contract, demand or direct offer. Name a storage of
          yours, and the goods are set aside there as for any offer. They hear at once wherever they
          are, with a notice and the place, and only they can accept it: someone of theirs goes to
          the storage and takes it in person, as with any offer, or they decline it from anywhere.
          Anyone else in sight of the storage sees it, and that it is for another realm. It lapses
          after {num(DIRECT_OFFER_DAYS)} game days. Declined, lapsed or taken down, the goods are
          ordinary again and both of you are told. At most {num(DIRECT_OFFERS_TO_ONE_REALM)} can
          stand to one realm.
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
          An NPC city thinks over what its people do once a game hour ({realTimeOf(NPC_PLAN_TICKS)}
          of real time) and keeps to that plan in between: a worker stays where the city put them
          until it moves them, and a builder picks up the next piece of a project as soon as one is
          finished. Only its defence acts at once.
        </p>
        <p>
          An NPC city keeps a reserve: {days(NPC_TRADE.reserveFoodDays)} of Food for everyone; the
          materials for a house and {num(NPC_TRADE.reserveWallStretches)} tiles of wall; a{' '}
          {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()} for each soldier it keeps and hasn't armed
          yet ({pct(NPC_SOLDIER_SHARE)} of its adults), with the Iron and Wood to forge them; and{' '}
          {num(NPC_WAR_CHEST_PER_RESIDENT)} coins a resident as its war chest. A stable is wanted
          once it has a horse.
        </p>
        <p>
          It shares out its adults in this order: soldiers; farmers, as many as feed everyone (each
          eats {num(FOOD_PER_DAY)} Food a day, a farmer makes {num(WORK_OUTPUT_PER_DAY.food ?? 0)})
          and one more while it has no food surplus, a new farm when they don't fit; up to{' '}
          {num(NPC_BUILDERS)} builders while it has a project; everyone else is a spare hand. Spare
          hands go to the good the reserve is shortest of, as a share of what it wants of it,
          filling one workplace's crew before the next. Without a workplace for that good, the city
          builds one: on the nearest fitting resource node it knows of, or a smelter, smithy or mint
          in its area like a house.
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
          Food as they can carry, and turn back when it only just covers the way home. A city knows
          every node within {num(NPC_NODE_REACH)} tiles; what a scout saw, out to{' '}
          {num(NPC_SCOUT_LIMIT)} tiles, it knows only once they step back into its area alive. A
          scout killed on the way brings nothing, and nothing protects them. What is short calls
          them home, with what they saw. Once a city knows its limit it stops scouting.
        </p>
        <p>
          What a scout brought home it can build on. Short of a good it knows no nearer node of, it
          puts up the workplace on a far one, and the crew works it like any other, its carrier
          bringing their Food on the way back from the storage. Knowing such a node, it no longer
          buys that good from its trader or founds a daughter for it. A place a scout or a builder
          finds no way to is given up, and it counts on no node there.
        </p>
        <p>
          The others stay at or go to one
          of the city's workplaces and work for surplus, past its reserve, the good furthest below
          its cap first: {num(NPC_SURPLUS_CAP.food ?? 0)} Food, {num(NPC_SURPLUS_CAP.wood ?? 0)}{' '}
          Wood, {num(NPC_SURPLUS_CAP.stone ?? 0)} Stone, {num(NPC_SURPLUS_CAP.ironOre ?? 0)} each of
          Iron ore, Iron and Gold ore, {num(NPC_SURPLUS_CAP.coins ?? 0)} coins and{' '}
          {num(NPC_SURPLUS_CAP[NPC_SMITHY_WEAPON] ?? 0)}{' '}
          {GOOD_LABELS[NPC_SMITHY_WEAPON].toLowerCase()}s above what it keeps. A smelter, smithy or
          mint is worked for surplus only from input above the reserve. Past the cap they stop and
          are idle. What is short, its trader and a founding party still take them first, the next
          time it thinks. So its workplaces stay busy, and its trader has more to sell.
        </p>
        <p>
          Ahead of scouting and that work comes its road crew: up to {num(NPC_ROAD_CREW)} spare hands, apart from
          its builders, build road from its home to each of its workplaces outside its area, farms
          too, the nearest first. They follow the way a resident would walk, tile by tile, so a road
          goes round a lake, and they skip tiles that already have a road. They only use materials
          above its reserve and what its project still needs; with none to spare, or with something
          short that they can work for, they go back to other work and bring back what they carry.
          Like any road it belongs to nobody, and anyone can use it or tear it down; a tile torn down
          is laid again in time.
        </p>
        <p>
          With its workplaces joined the crew goes on: to the nearest Trade Organization warehouse
          within {num(NPC_TRADER_REACH)} tiles, its trader's reach, leaving out those of the HQ's
          inner ring, which keeps everyone out, and then to the edge of the area of its nearest
          neighbour, any city but the Trade Organization's. A road two neighbours would each build
          is built by only one of them. A road on Mountain takes{' '}
          {num(MOUNTAIN_ROAD_WORK_FACTOR)} times the work here as anywhere. The crew takes Food along
          for the walk, goes back for more before a tile it couldn't walk home from on what it has,
          and fetches more when it runs low, as any builder does. A way longer than{' '}
          {num(NPC_ROAD_LONGEST)} tiles, or with no way through, is given up.
        </p>
        <h3>Trading posts and the HQ</h3>
        <p>
          The Trade Organization runs its own chain the same way. A trading post's reserve is its
          warehouse's stock floor ({num(WAREHOUSE_FLOOR.ironOre)} Iron ore,{' '}
          {num(WAREHOUSE_FLOOR.wood)} Wood, {num(WAREHOUSE_FLOOR.coins)} coins and so on), the HQ's{' '}
          {num(HQ_FLOOR_FACTOR)} times that, and {num(HQ_FOOD_FLOOR_FACTOR)} times its{' '}
          {num(WAREHOUSE_FLOOR.food)} Food for the traders to carry; their Food is their storage's, kept by their farmers.
          Their spare hands work and build for whatever their warehouses are short of, on the
          nearest node within {num(NPC_NODE_REACH)} tiles, and carry the output into the warehouse.
          A post never grows in people; the HQ grows only while it is too weak. Neither sends a
          trader or founds a city.
        </p>
        <p>
          Only the HQ's warehouses top up to their floor at the end of each game day, so the world
          always has a market of last resort. Nothing tops up a trading post's warehouse: its floor only says what
          its spare hands, caravan and wandering traders go for, and all it holds came by them or
          from people selling to it. A post can run dry, even of Food and Coins, and its prices climb
          as it does, so prices differ with what reached each post. Rob a trader or raid a post and
          you empty a real market. Its people and soldiers eat from its storage, which its farm fills,
          not from the Food on sale in the warehouse.
        </p>
        <p>
          The Trade Organization lives on in its trading posts should its HQ ever fall: they keep
          their warehouses, prices and soldiers and go on trading in person, but with no caravans and
          no traders their warehouses hold only what they had and what their own hands bring. What
          only the HQ gave it is gone for good: no deliveries or transfers, no army to hire and
          nobody sent out to punish. See "The fall of the HQ" for what that costs.
        </p>
        <p>
          Once one good's surplus makes a full load for one of its spare hands (beside the Food for
          the walk) and a Trade Org warehouse lies within {num(NPC_TRADER_REACH)} tiles, an NPC city
          sends that spare hand, never a soldier, as its trader: they carry the load and the coins
          above its war chest there, sell the load, buy the good shortest of its reserve that it has
          no node for (never Food or a weapon) as far as their coins and arms allow, and walk home
          to the storage. One trader at a time, and none while Food runs short or armed outsiders
          stand in its area. Nothing protects them on the way; a trader not back after{' '}
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
          A city is full once it has had spare hands, idle, on a road crew, scouting or working for surplus, and nothing short
          of its reserve for {days(NPC_FULL_DAYS)}, with a food surplus and a town hall's and a storage's
          materials above its reserve. A full city founds a daughter. Once a game day it looks for a
          free Plains site {num(NPC_CITY_MIN_DISTANCE)} to {num(NPC_FOUND_REACH)} tiles away, with
          room for a village and on no realm's territory, nearest a node of a material it has none
          of in reach. A founding party of {num(NPC_VILLAGE.residents)} adults, one of them armed,
          sets out carrying the materials and Food for twice the walk and{' '}
          {days(NPC_FOUND_FOOD_DAYS)} there, and builds the town hall, which founds the daughter: an
          NPC city of its own with a name from the game. It then builds its storage, a farm and a
          house, and once its storage holds the Wood of its reserve, its first wall, a ring{' '}
          {num(Math.floor(NPC_VILLAGE.size / 2))} tiles round its home. Mother and daughter start at
          a standing of {num(NPC_FOUND_STANDING)} toward each other, which fades like any other, and
          share nothing. A party whose town hall doesn't stand after {days(NPC_FOUND_GIVE_UP_DAYS)}{' '}
          gives up and walks home. Trading posts and the Trade Organization's HQ never found cities.
        </p>
        <p>
          An NPC city sells only what it holds above this reserve and buys only what it is short of.
          It lends residents at {num(NPC_TRADE.pricePerResidentWeek)} coins each a game week,
          keeping {pct(NPC_TRADE.defenceShare)} of its adults at home. The Trade Organization hires
          out soldiers at {num(TRADE_ORG_ARMY.pricePerSoldierWeek)} coins each a game week. A
          contract runs at most {days(CONTRACT_MAX_DAYS)}.
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
          Every {num(STANDING_TRADE_COINS_PER_POINT)} coins of trade with the Trade Organization or
          an NPC city raise standing by a point, both ways.
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
          what was stolen from you is theft like any other.
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
            At {signed(PERSUADE_STANDING)} and with enough respect an NPC city asks to join you;
            declined, it asks again after {days(PERSUADE_ASK_AGAIN_DAYS)}.
          </li>
          <li>
            An NPC city joins an alliance when it holds every member at{' '}
            {signed(NPC_ALLIANCE_JOIN_STANDING)} or better, and leaves when any falls below{' '}
            {signed(NPC_ALLIANCE_LEAVE_STANDING)}.
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
            way back, apart from what they came to take. Your realm log says when it is coming, when
            it arrives, what it left with, why it turned back, or that it was lost. Besides stolen
            goods, carriages and horses it counts{' '}
            {(Object.entries(TRADE_ORG_LOSS) as [CrimeKind, number][])
              .map(([c, n]) => `${CRIME_NAMES[c].toLowerCase()} as ${num(n)} coins`)
              .join(', ')}
            .
          </li>
          <li>
            A city whose Leader died starts out holding its former Player at{' '}
            {signed(FORMER_PLAYER_STANDING)}.
          </li>
        </ul>
        <p>
          Leaving an alliance takes {realSeconds(ALLIANCE_LEAVE_DELAY)}; soldiers recalled from its
          army are back under their owner's command after {realSeconds(ALLIANCE_RECALL_DELAY)}.
        </p>
      </Section>

      <Section id="demands">
        <p>
          A demand tells another realm what you want and by when: <strong>a named city</strong> of
          theirs, or <strong>goods or Coins</strong>, with a note of at most{' '}
          {num(DEMAND_NOTE_MAX_LENGTH)} characters and a deadline of up to {days(DEMAND_MAX_DAYS)}.
          Open <strong>Demands</strong> on the tool rail to send one or to answer one. Scripts can
          too (<code>sendDemand</code>, <code>acceptDemand</code>, <code>declineDemand</code>,{' '}
          <code>demands</code>).
        </p>
        <ul>
          <li>
            You can send one to any realm you know of: one whose residents you see, an ally, one
            whose city you have seen, one with a standing toward you or you toward it, or your side
            in a contract, demand or Direct offer.
          </li>
          <li>
            It arrives at once, wherever they are, in their Demands drawer and as a notice. A realm
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
            <strong>An NPC city answers for itself</strong> within a game hour, when it next plans.
            You can send one to any NPC city you have seen or have a standing with. It gives in when
            the armed residents and walls of yours in its sight come to at least{' '}
            {num(DEMAND_YIELD_RESPECT_TIMES)} times its soldiers, and at least{' '}
            {num(DEMAND_YIELD_RESPECT_MIN)}, so an army at the gate can win a city without a fight.
            Those out of its sight don't count. It joins your realm as a persuaded city does, or sets
            what it holds of the goods aside at its storage for you alone to fetch. Otherwise, or
            with none of the goods there, it declines, and its standing toward you drops by{' '}
            {num(DEMAND_DECLINED_STANDING_LOSS)}.
          </li>
          <li>
            <strong>The Trade Organization always declines</strong>, within a game hour, and being
            asked costs you {num(DEMAND_TRADE_ORG_STANDING_LOSS)} of its standing. Everyone knows of
            it.
          </li>
          <li>
            <strong>The threat is only words.</strong> Ignoring a demand does nothing by itself:
            whatever was threatened is the sender's to carry out, or not.
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
              <th>kg</th>
            </tr>
          </thead>
          <tbody>
            {(Object.entries(WEAPON_ATTACK) as [Good, number][]).map(([g, a]) => (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>{signed(a)}</td>
                <td>—</td>
                <td>{num(GOOD_WEIGHT[g])}</td>
              </tr>
            ))}
            {(Object.entries(PROTECTION_DEFENCE) as [Good, number][]).map(([g, d]) => (
              <tr key={g}>
                <td>{goodName(g)}</td>
                <td>—</td>
                <td>{signed(-d)}</td>
                <td>{num(GOOD_WEIGHT[g])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          An average resident hits for {num(unarmed)} with bare fists, {num(sword)} with a sword,
          and {num(swordSkilled)} with a sword at full Combat skill ({num(COMBAT_SKILL_MAX)}{' '}
          points); they dodge {pct(dodge)} of blows. A resident has {num(MAX_HEALTH)} health.
        </p>
        <p>
          Defenders on their own city's wall take {pct(WALL_DEFENCE)} of the damage. A tile of wall
          takes {num(WALL_STRENGTH.wall)} damage to break and a gate {num(WALL_STRENGTH.gate)}: an
          average unarmed resident alone needs {duration(breakTicks('wall'))} for a wall and{' '}
          {duration(breakTicks('gate'))} for a gate. A broken one leaves{' '}
          {pct(BROKEN_MATERIALS_RETURNED)} of its materials. Climbing over takes{' '}
          {duration(CLIMB_TICKS)}, unable to dodge or strike back.
        </p>
        <h3>Under attack</h3>
        <p>
          A resident of yours who is struck and lives runs their defence script,{' '}
          <strong>Defend</strong> (one of your default scripts): armed, they fight back at whoever
          struck them until that one is dead, gone or out of sight; unarmed, they walk home to their
          city's town hall, and stop once there or once no blow has landed for{' '}
          {duration(DEFEND_CALM_TICKS)}. Their card says “Defending: fighting back at Bo” or
          “Defending: fleeing home”, with what they were doing on the line under it. What they were
          doing waits meanwhile: once Defend ends they go back to it, a script with its memory, a
          queue at its step, or a plain order. Struck again while defending, they keep defending.
          Scripts see the last blow as <code>me.struckBy</code> and <code>me.struckAt</code>.
          Residents of NPC cities, and in an army, fight back or flee home the same way.
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
        <h3>Capturing a city</h3>
        <p>
          A city is captured by occupying its town hall: armed residents of your realm stand on it
          (any of its tiles), nobody else's armed residents do, and none of the city's defenders do
          (armed residents of its realm or an ally, or for an NPC city its own). An ally of yours on
          the hall counts as another realm, so nobody occupies it. Held {days(OCCUPATION_GAME_DAYS)}{' '}
          without a break, the city joins your realm with its buildings and the residents who live
          there, loyal at once; its Leader never joins. Beating its defenders is not enough on its
          own, and defenders elsewhere in the city don't stop the clock: they have to come to the
          hall. The first tick the occupation doesn't hold, it is broken and its days are lost; the
          next one starts again from nothing. Your realm log says when one of your town halls is
          occupied, by whom, and when the occupation is broken, and likewise when you occupy a town
          hall and when your occupation is broken. Every city is captured this way: NPC cities,
          Players' cities, trading posts and the Trade Org HQ, whose hired mercenaries defend it.
          Anyone with the town hall in sight sees who occupies it and the game days left: a small
          flag in the occupier's colour on the hall, and "Occupied by …" on its tile card and in the
          city inspector, a warning when it is your city. Out of sight it isn't shown, nor
          remembered in Last seen. Scripts see it as <code>city.occupation</code>: who occupies a
          town hall in sight, and the ticks left.
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
          mercenaries guarding the HQ walk home. Its punishments end, and admin directives stay in
          force and can be bought off at a post, but it sends nobody out for them. With no caravans
          or wandering traders the posts' warehouses get only what their own hands bring and what
          people sell them. When the last trading post falls too, the Trade Organization is gone.
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
          {num(SCRIPT_ACTION_COST)} more.
        </p>
        <ul>
          <li>Each resident's or army's script: {num(SCRIPT_STEP_BUDGET)} steps a tick.</li>
          <li>All of a realm's scripts together: {num(SCRIPT_REALM_STEP_BUDGET)} steps a tick.</li>
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
