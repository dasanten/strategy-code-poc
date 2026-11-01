import { useEffect, type ReactNode } from 'react'
import {
  PARAM_DESCRIPTIONS,
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
  CARAVAN_ROBBERIES_PER_ESCORT,
  CARRIAGE_CAPACITY,
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
  HORSE_GRANT_FOOD,
  HQ_FLOOR_FACTOR,
  HORSE_GRANT_HORSES,
  HORSE_HUNGRY_SHARE,
  HORSE_NAME_MAX_LENGTH,
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
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_FOOD_DAYS,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_REACH,
  NPC_FOUND_STANDING,
  NPC_FULL_DAYS,
  NPC_VILLAGE,
  NPC_NODE_REACH,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_TRADER_REACH,
  NPC_PLAN_TICKS,
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
import { PARAM_DEFAULT_EXAMPLE, SCRIPT_LANGUAGE } from './wiki-scripting.js'
import { apiNames, type ApiName } from './script-editor.js'

/** The Wiki's topics, in order, each a section with its own anchor (`/wiki#food`). */
export const WIKI_TOPICS = [
  { id: 'controls', title: 'Controls' },
  { id: 'queues', title: 'Queues' },
  { id: 'time', title: 'Time & map' },
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
          the card shows its letter key; press it to run the action. Escape drops what is picked.
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
          its way to the storage too. A passenger’s way is the carriage’s.
        </p>
        <p>
          In the same colour the map outlines the places they are set on: the buildings and
          carriages their script’s params name, and where their order heads for (the workplace they
          work, the site they build, the storage or carriage they store at or fetch from, both stops
          of a haul). Only places you can see or remember are outlined.
        </p>
        <p>
          On a touch screen one finger pans the map, two fingers pinch to zoom, and a tap picks. A
          long-press does what right-click does. Turn on Select to make a one-finger drag box a
          group instead of panning.
        </p>
        <p>
          On a phone the card sits at the bottom of the screen. Drag its handle to show just its
          header, half the screen or all of it; a tap on the handle goes one step up. While an order
          waits for a target the card drops to its header. The menu button at the top left opens the
          drawers, your goods, the wiki and Log out.
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
          on alone.
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
            <strong>Build road</strong> and <strong>Build wall</strong>: pick where the line starts
            and ends; they all build along it. <strong>Tear down</strong>: pick a building; those
            standing at it tear it down.
          </li>
          <li>
            <strong>Attack</strong>: pick a resident of another realm, or a wall or gate, for them
            all to attack. <strong>Climb a wall</strong>: those next to the one picked climb over.
          </li>
          <li>
            <strong>Board carriage</strong> (one for each carriage of your realm some of them stand
            on) puts those on its tile aboard, in the group's order, until it is full;{' '}
            <strong>Get off</strong> gets every passenger among them off. See Passengers.
          </li>
        </ul>
        <p>
          Those who can't take an order are skipped, and the card says who and why: children don't
          work, build or drive, and store, fetch or put down only Food; a partner carrying a child
          doesn't work, build, tear down, breed or haul; orders bound to a place go only to those
          standing there; Board skips those not on the carriage's tile, the driver, riders and, once
          it is full, the rest.
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
          off a carriage, work, build, haul, feed the stable, breed horses, tear down, build a road
          or wall line, or run one of your scripts with its params.
        </p>
        <p>
          To plan ahead, use <strong>Add step</strong> under the queue on the resident's card: it
          lists every kind of step. One that acts on a place (work a workplace, build, store at or
          fetch from a storage, pick up, feed the stable, breed, …) has you pick that place on the
          map, anywhere, not only where the resident stands now; one that needs more (which goods,
          what to build, what a smithy makes, which script) asks for it on the card after. A step
          that has to be done on its tile goes after a walk there, unless the step before already
          walks there. It works on a resident with no queue too, and starts one. Adding a step only
          checks that it could make sense (the place is there as you last knew it, and a carriage or
          horse is yours). A workplace or construction site can be anyone's, in sight or as last
          seen, since a workplace has no owner: queue Work at a far mine and they walk there and
          work it. Whether a step can start is checked when its turn comes.
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
          on their card), they walk to their storage (or the nearest one of your realm with Food),
          take Food up to <code>foodTake</code> ({num(GET_FOOD_TAKE)} unless set) and go back.
          Whenever they are at a storage anyway, their own food is topped up to{' '}
          <code>foodTake</code> instead of {num(OWN_FOOD)}. With <code>foodAt</code> set to 0 they
          don't go on their own and rely on refilling.
        </p>
        <p>
          A crew at a far workplace is fed by its carrier: the worker who carries a load to the
          storage brings back the Food the workplace's pile lacks of <code>crewFood</code> (
          {num(CREW_FOOD)} unless set) and puts it on the pile, where the crew takes its meals, so
          nobody else leaves for Food while the pile holds some. A farm's pile keeps its own Food
          instead. <code>crewFood</code> 0 brings none. A resident an NPC city sends to a workplace
          sets out with Food for the walk there and back plus {days(SET_OUT_WORK_DAYS)} of work, not
          a fixed amount, so they last until the carrier's first round trip.
        </p>
        <p>
          A full hunger meter lasts {days(HUNGER_DAYS)} without eating; an empty one costs all
          health in {days(STARVE_DAYS)}, so a resident without food dies{' '}
          {days(HUNGER_DAYS + STARVE_DAYS)} after their last meal. Fed again, they heal from nothing
          to full in {days(HEAL_DAYS)}.
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
          carries a full load to the nearest storage of their realm.
        </p>
        <p>
          A worker who carries less Food than <code>foodAt</code> ({num(GET_FOOD_AT)} unless set)
          leaves work for their <code>storage</code>, or the nearest storage of your realm with
          Food, takes Food up to <code>foodTake</code> ({num(GET_FOOD_TAKE)} unless set) and comes
          back. With no Food anywhere they work on. Carrying a load tops their food up to{' '}
          <code>foodTake</code> too, and the carrier brings back what the workplace's pile lacks of{' '}
          <code>crewFood</code> ({num(CREW_FOOD)} unless set) for the crew's meals, so a worker with
          Food on the pile stays. <code>foodAt</code> 0 turns getting food off,{' '}
          <code>crewFood</code> 0 the crew's Food.
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
          {num(GET_FOOD_AT)} unless set) goes to their <code>source</code>, or the nearest storage
          of your realm with Food, takes Food up to <code>foodTake</code> ({num(GET_FOOD_TAKE)}{' '}
          unless set) and comes back to the site. With no Food anywhere they work on. Fetching
          materials tops their food up to <code>foodTake</code> too, before the materials.{' '}
          <code>foodAt</code> 0 turns this off.
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
          storage”), so the line shows and can be finished later. Build line has Build's params; its
          line comes only from the order, so run directly, with Run script or as a queue step, it
          ends at once (“no line given”). The plain <code>roadLine</code> and <code>wallLine</code>{' '}
          actions, which build only with what the resident carries, stay for your scripts.
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
        <table>
          <thead>
            <tr>
              <th>Goods</th>
              {(Object.keys(GOOD_WEIGHT) as Good[]).map((g) => (
                <th key={g}>{goodName(g)}</th>
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
        <h3>Breeding</h3>
        <p>
          Horses don't breed on their own. A grown resident standing at a finished stable is given
          Breed horses and picks two fed horses of their realm in it; they tend them for{' '}
          {days(STABLE_BREED_DAYS)}, and then a foal of their realm is born in the stable. Each of
          its stats is its parents' average, give or take {num(FOAL_STAT_SPREAD)}. The progress
          belongs to the two horses, and the stable keeps it: breeding pauses when the resident
          leaves or is given another order, or while the stable has no room left for the foal, and
          any grown resident who breeds there later carries on with that pair first, where it
          stopped, if both are still fed. The stable's card shows a paused breeding and how far
          along it is. The progress is lost only when one of the two leaves the stable or dies. The
          Breed horses default first takes {num(BREED_FOOD)} Food from the stable for the resident's
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
          A resident on a tile with a free horse of their realm can mount it, and dismount anywhere;
          the horse stays where they get off. A rider goes wherever they walk at the speed the horse
          would pull a carriage there (the carriage column above), never up onto walls, and into
          mountains only along a finished road, like a carriage. A horse with less than{' '}
          {pct(HORSE_HUNGRY_SHARE)} of its hunger meter left goes at {pct(HUNGRY_HORSE_PACE)} of its
          pace. Riding trains Driving like driving does, and Driving makes riding faster. A rider
          carries no more than on foot, and can't drive a carriage; a ridden horse is never hitched.
          A hungry ridden horse eats Food on the ground in reach first, then what its rider carries
          beyond their own {num(OWN_FOOD)} Food: the rider never goes without for the horse, so give
          a rider extra Food for a long ride. When a ridden horse goes hungry with nothing to spare,
          your realm log says so. On the map a rider sits on a horse token, and up close their
          activity icon is a horseshoe while they ride somewhere.
        </p>
        <p>
          A rider’s Doing line says <em>Riding to …</em> where it would say <em>Walking to …</em>,
          and their card shows the horse they ride: its stats, age, health and hunger, and that it
          eats from their spare Food, with <strong>Dismount</strong> under Orders.
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
          driven, and picking them shows the carriage's way ahead. Scripts see a resident's{' '}
          <code>aboard</code> and a carriage's <code>passengerIds</code>.
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
          full, and says who was skipped and why; its Get off gets them all off. Board and Get off
          are queue steps too: Board ends once they are aboard and Get off once they are off, so put
          a step that waits for the stop between them (a script that calls <code>end()</code> once
          they are there), e.g. board, wait, get off, work. A Board step whose carriage has left
          their tile by its turn is skipped.
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
          Every Player may claim {num(HORSE_GRANT_HORSES)} new horses once, ever, whenever they
          choose and whether or not they have horses: a notice at the top of the screen has a Claim
          button until they do. The horses get new stats and ages and go in your finished stable
          nearest your Leader's city; with no stable, they stand next to that city's storage (or
          next to your Leader), each with {num(HORSE_GRANT_FOOD)} Food on the ground by it. The
          realm log says where they are. Once claimed the offer is gone for good, also after your
          Leader dies and you found a new realm; while you have no living Leader you can't claim it.
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
        <h3>What an NPC city buys and sells</h3>
        <p>
          An NPC city sells only its surplus, what its storages hold above its reserve, and buys
          only goods it is short of, up to its reserve and with the coins in its storage. It takes
          nothing else. Its prices come from its stock like a warehouse's, and its standing toward
          you moves them: the better, the cheaper it sells and the more it pays. Below{' '}
          {signed(NPC_CITY_REFUSES_STANDING)} it won't trade with you at all. Every trade raises
          standing both ways (see <a href="#standing">Standing &amp; reactions</a>).
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
          moves, so a big trade moves the price as it goes.
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
          builds one: on the nearest fitting resource node within {num(NPC_NODE_REACH)} tiles of
          home, or a smelter, smithy or mint in its area like a house.
        </p>
        <p>
          So it builds the whole chain its land allows, from the node up: weapons short wants a
          smithy, which wants Iron, so a smelter, which wants Iron ore, so a mine first, and the
          Wood and Stone the mine is built of before that. A smelter or smithy is worked only while
          the storage holds the input for a batch, which its workers take with them; once the city
          isn't short of what it makes, they stop. A good with no node in reach stays short: a
          village with no ore in reach forges no weapons, and a mint is built only with Gold ore in
          reach.
        </p>
        <h3>Trading posts and the HQ</h3>
        <p>
          The Trade Organization runs its own chain the same way. A trading post's reserve is its
          warehouse's stock floor ({num(WAREHOUSE_FLOOR.ironOre)} Iron ore,{' '}
          {num(WAREHOUSE_FLOOR.wood)} Wood, {num(WAREHOUSE_FLOOR.coins)} coins and so on), the HQ's{' '}
          {num(HQ_FLOOR_FACTOR)} times that; their Food is their storage's, kept by their farmers.
          Their spare hands work and build for whatever their warehouses are short of, on the
          nearest node within {num(NPC_NODE_REACH)} tiles, and carry the output into the warehouse,
          so less of its stock comes from the floor. A post never grows in people; the HQ grows only
          while it is too weak. Neither sends a trader or founds a city.
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
          A city is full once it has had spare hands with nothing to do and nothing short of its
          reserve for {days(NPC_FULL_DAYS)}, with a food surplus and a town hall's and a storage's
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
          another realm's outpost storage counts the same as its city storage.
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
            times what it lost, giving up after {days(TRADE_ORG_PUNISH.giveUpDays)}. Besides stolen
            goods it counts{' '}
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
          queue at its step, or a plain order. Struck again while defending, they keep defending; an
          order you give them meanwhile ends both. Scripts see the last blow as{' '}
          <code>me.struckBy</code> and <code>me.struckAt</code>. Residents of NPC cities, and in an
          army, fight back or flee home the same way.
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
            Before it starts: giving a task or Run script whose script has params first shows them,
            filled with the values the resident keeps or the defaults. Change what you like and
            press Start; Cancel gives nothing. A script without params starts at once. For a group
            the form shows once, and each of them gets the same values. With Shift held the step
            added to the queue keeps the values.
          </li>
          <li>
            A resident's card shows one field for each param of the script they run: pick it on the
            map, or clear it. A <code>number</code> param has a number field instead: type a whole
            number of zero or more and press Enter. Neither stops the script.
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
            <code>number</code> param reads the number typed, or <code>null</code> while unset.
          </li>
          <li>
            A <code>number</code> param may have a default: <code>= n</code> after its type, a whole
            number of zero or more. Unset, it reads the default; the number typed wins over it, and
            clearing the field goes back to it. Its field shows the default while unset. A{' '}
            <code>building</code> or <code>storage</code> param can't have one.
            <pre>
              <code>{PARAM_DEFAULT_EXAMPLE}</code>
            </pre>
          </li>
          <li>
            The Work default has <code>workplace</code>: the workplace to work, the one they stand
            on while none is picked; it is never kept between starts, so the form before it starts
            shows it empty, and giving Work on a workplace fills it without asking. It also has{' '}
            <code>storage</code>: where the output goes. The Build default has <code>site</code>:
            the construction site to join; and <code>source</code>: where materials come from, a
            carriage too. Unset, each uses the nearest storage; a source picked that holds none of
            what the site lacks is left alone, and they just build. The Haul default has{' '}
            <code>carriage</code>: the carriage to drive. The Tear down default has{' '}
            <code>building</code>, the Breed horses and Feed the stable defaults <code>stable</code>
            . Like Work's <code>workplace</code>, each of these is the one they stand on while none
            is picked, never kept between starts, and filled by giving the task. Feed the stable
            also has <code>source</code>: where the Food comes from. The Tear down default has{' '}
            <code>source</code>: where Food comes from. The Work, Build and Tear down defaults also
            have the <code>number</code> params <code>foodAt</code> (default {num(GET_FOOD_AT)}; 0
            turns it off) and <code>foodTake</code> (default {num(GET_FOOD_TAKE)}) for getting food,
            in units of Food (a resident eats about {num(foodEatenPerDay())} a game day). Work also
            has <code>crewFood</code> (default {num(CREW_FOOD)}; 0 brings none): the Food the
            workplace's pile keeps for the crew, which the carrier tops up on the way back from the
            storage.
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
