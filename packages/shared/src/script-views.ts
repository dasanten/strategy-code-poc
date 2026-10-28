import { GOODS, STAT_NAMES, type SkillName } from './world.js'

/**
 * Script views (`CONTEXT.md`: Script view; ADR 0011): what a script gets of each kind of thing,
 * as plain data beside `SCRIPT_API`. Each view lists its fields, each with the kind of value it
 * holds, a description and, for one that can be `null`, when it is. The editor completes and
 * checks fields from them and the Wiki lists them.
 */

/**
 * The kind of value a field or an API name holds: a plain value, a script view, or a list of
 * either. `any` is anything (`memory`, an object of the script's own making), never checked.
 */
export type ScriptType =
  'number' | 'string' | 'boolean' | 'any' | { view: ScriptViewName } | { list: ScriptType }

export interface ScriptField {
  name: string
  type: ScriptType
  description: string
  /** When the field is `null`; absent when it never is. */
  nullWhen?: string
}

export interface ScriptView {
  /** What the view is of, in words, for the Wiki and the editor. */
  description: string
  fields: readonly ScriptField[]
}

export type ScriptViewName =
  | 'resident'
  | 'army'
  | 'stats'
  | 'stat'
  | 'skills'
  | 'goods'
  | 'residentOrder'
  | 'orderEnded'
  | 'queue'
  | 'armyOrder'
  | 'tile'
  | 'pair'
  | 'carrying'
  | 'runningScript'
  | 'building'
  | 'site'
  | 'price'
  | 'city'
  | 'hire'
  | 'horse'
  | 'carriage'
  | 'pile'
  | 'node'
  | 'lastSeen'
  | 'directive'
  | 'directiveGoal'
  | 'material'

const field = (
  name: string,
  type: ScriptType,
  description: string,
  nullWhen?: string,
): ScriptField => ({ name, type, description, ...(nullWhen === undefined ? {} : { nullWhen }) })

const view = (name: ScriptViewName): ScriptType => ({ view: name })
const listOf = (type: ScriptType): ScriptType => ({ list: type })

const SKILLS: readonly SkillName[] = [
  'mining',
  'woodcutting',
  'smelting',
  'smithing',
  'construction',
  'farming',
  'combat',
  'driving',
]

const id = (what: string) => field('id', 'string', `The ${what}’s id, unique in the world.`)
const x = field('x', 'number', 'The tile it stands on, from west to east.')
const y = field('y', 'number', 'The tile it stands on, from north to south.')

const BUILDING_FIELDS: readonly ScriptField[] = [
  id('building'),
  field(
    'kind',
    'string',
    'What it is: "townHall", "house", "storage", "warehouse", "wall", "gate", "farm", "stable", "mine", "quarry", "lumberCamp", "smelter", "mint", "smithy" or "road".',
  ),
  field(
    'cityId',
    'string',
    'The city it belongs to.',
    'for a building of no city, such as a workplace on a node',
  ),
  x,
  y,
  field(
    'stock',
    view('goods'),
    'The goods kept here.',
    'for any building but a storage, warehouse or stable, and when the Player doesn’t see inside it',
  ),
  field(
    'breeding',
    'number',
    'A stable’s ticks of breeding toward its next foal.',
    'until a stable starts breeding',
  ),
  field(
    'site',
    view('site'),
    'How far it has come while it is a construction site.',
    'once it is finished',
  ),
  field('teardown', 'number', 'Work put into tearing it down so far.', 'until someone starts'),
  field(
    'closed',
    'boolean',
    'true for a gate its realm has closed.',
    'for an open gate and any other building',
  ),
  field(
    'damage',
    'number',
    'Damage a wall or gate has taken from blows.',
    'until someone strikes it',
  ),
  field(
    'prices',
    listOf(view('price')),
    'A Trade Org warehouse’s prices, one for each good it keeps.',
    'for any building but a Trade Org warehouse',
  ),
]

const CITY_FIELDS: readonly ScriptField[] = [
  id('city'),
  field('name', 'string', 'The city’s name, as the Player knows it.'),
  field('realmId', 'string', 'The realm it belongs to.', 'for an NPC city'),
  field('townHallId', 'string', 'Its town hall, which makes it a city.'),
  field(
    'tradeOrg',
    'string',
    '"hq" or "post" for a city of the Trade Organization.',
    'for any other city',
  ),
  field(
    'price',
    'number',
    'The Coins an NPC city asks the Player to buy it.',
    'for a realm’s city, and an NPC city that won’t sell',
  ),
  field(
    'wontSell',
    'boolean',
    'true when an NPC city holds the Player in too low standing to sell.',
    'otherwise',
  ),
  field(
    'refuses',
    'boolean',
    'true when an NPC city won’t trade with the Player, hire out to them or let their residents through its gates.',
    'otherwise',
  ),
  field(
    'hire',
    view('hire'),
    'What an NPC city would lend the Player.',
    'for a realm’s city, and an NPC city that refuses them',
  ),
  field(
    'trade',
    listOf(view('price')),
    'An NPC city’s prices to the Player, one for each good.',
    'unless a storage of the NPC city is in sight',
  ),
]

/** Every view a script can get, by name. */
export const SCRIPT_VIEWS: Readonly<Record<ScriptViewName, ScriptView>> = {
  resident: {
    description: 'A resident, as the Player sees them; `me` in a resident’s script.',
    fields: [
      id('resident'),
      field('name', 'string', 'The resident’s name.'),
      field(
        'owner',
        'string',
        'The realm they belong to.',
        'for a resident of an NPC city or of nobody',
      ),
      field('cityId', 'string', 'The city they live in.', 'for a resident of no city'),
      x,
      y,
      field('stats', view('stats'), 'Strength, endurance, agility and intellect.'),
      field('skills', view('skills'), 'What they have learned by doing.'),
      field(
        'health',
        'number',
        '0 is dead; full is 100.',
        'for a resident of another realm that isn’t allied',
      ),
      field(
        'hunger',
        'number',
        'Fully fed is 100, empty 0.',
        'for a resident of another realm that isn’t allied',
      ),
      field('bornAt', 'number', 'The tick they were born; may be before the world began.'),
      field('age', 'number', 'Their age in game years.', 'except on `me` and an army’s `members`'),
      field('lifespan', 'number', 'The age in game years at which they die of old age.'),
      field('carried', view('goods'), 'The goods they carry.'),
      field('order', view('residentOrder'), 'What they were ordered to do.', 'when idle'),
      field(
        'orderEnded',
        view('orderEnded'),
        'How their last store or fetch order ended.',
        'until one ended, and after their next store or fetch order or an order from the UI',
      ),
      field(
        'queue',
        view('queue'),
        'The queue they work through; `order` or `script` is its current step’s.',
        'when they have none, and for a resident of another realm',
      ),
      field('pair', view('pair'), 'Their pair, to have a child.', 'unless they are paired'),
      field('carrying', view('carrying'), 'The child they carry.', 'unless they carry one'),
      field(
        'script',
        view('runningScript'),
        'The script they run.',
        'when they run none, and on `me` (a script’s own state is `memory`)',
      ),
    ],
  },
  army: {
    description: 'An army of the Player’s realm; `me` in an army’s script.',
    fields: [
      id('army'),
      field('name', 'string', 'The name the Player gave it.'),
      field('realmId', 'string', 'The realm it belongs to.'),
      field('memberIds', listOf('string'), 'Its residents’ ids; never empty.'),
      field(
        'members',
        listOf(view('resident')),
        'Its residents, as the Player sees them, with their `age`.',
      ),
      field('order', view('armyOrder'), 'What it was ordered to do.', 'when idle'),
    ],
  },
  stats: {
    description: 'A resident’s stats.',
    fields: STAT_NAMES.map((s) => field(s, view('stat'), `Their ${s}.`)),
  },
  stat: {
    description: 'One stat: what they were born with and what training added.',
    fields: [
      field('base', 'number', 'What they were born with.'),
      field('trained', 'number', 'What training added, at most the base.'),
    ],
  },
  skills: {
    description: 'What a resident has learned by doing; a skill they haven’t learned is null (0).',
    fields: SKILLS.map((s) =>
      field(s, 'number', `How far they have learned ${s}.`, 'until they start learning it'),
    ),
  },
  goods: {
    description: 'Goods by kind, in units, like {food: 3, wood: 10}.',
    fields: GOODS.map((g) => field(g, 'number', `Units of ${g}.`, 'when there are none')),
  },
  queue: {
    description:
      'A resident’s queue: steps done one after another. The current step’s order or script is the resident’s `order` or `script`.',
    fields: [
      field('step', 'number', 'The current step, counted from 1.'),
      field('steps', 'number', 'How many steps it holds.'),
      field('loop', 'boolean', 'Whether the first step follows the last.'),
      field(
        'kind',
        'string',
        'The current step’s order: "walkTo", "store", "task", "runScript", ….',
      ),
      field('task', 'string', 'The task the current step gives.', 'unless it gives a task'),
      field('scriptId', 'number', 'The script the current step runs.', 'unless it runs a script'),
      field(
        'minutes',
        'number',
        'The current step’s duration in game minutes.',
        'when it has none',
      ),
      field('startedAt', 'number', 'The tick the current step started.', 'until it has'),
    ],
  },
  residentOrder: {
    description:
      'A resident’s order, as plain data; which fields it has depends on its `kind`, the others are null.',
    fields: [
      field(
        'kind',
        'string',
        'The order: "walkTo", "drive", "haul", "pickUp", "drop", "store", "fetch", "build", "tearDown", "workAt", "attack", "climb", "roadLine", "wallLine", "pay", "buyCity", "trade", "handIn" or "buyOff".',
      ),
      field('target', view('tile'), 'Where a walk or drive goes.', 'for other orders'),
      field(
        'at',
        view('tile'),
        'The tile a build, work, tear-down or climb is on.',
        'for other orders',
      ),
      field(
        'progress',
        'number',
        'How far into the next step or piece of work.',
        'for orders that have none',
      ),
      field('buildingId', 'string', 'The building worked or torn down.', 'for other orders'),
      field('building', 'string', 'The kind of building being built.', 'for other orders'),
      field(
        'siteId',
        'string',
        'The construction site being built.',
        'for other orders, and until it is laid out',
      ),
      field(
        'makes',
        'string',
        'What a smithy is to make.',
        'for other orders, and at other workplaces',
      ),
      field(
        'carriageId',
        'string',
        'The carriage driven, hauled with or traded from.',
        'for other orders, and when none',
      ),
      field('targetId', 'string', 'Who is attacked.', 'for other orders'),
      field('wallId', 'string', 'The wall or gate climbed.', 'for other orders'),
      field(
        'from',
        'any',
        'Where goods are picked up from (a spot), fetched from (a spot: a storage or carriage), or a haul’s first stop (a tile).',
        'for other orders',
      ),
      field(
        'to',
        'any',
        'Where goods are dropped (a spot), stored (a spot: a storage or carriage), or a haul’s second stop (a tile).',
        'for other orders',
      ),
      field(
        'goods',
        'any',
        'The goods picked up, dropped, stored or fetched, like {food: 3} (null units for a store or fetch of as many as there are), or the goods a haul takes to its second stop, as a list.',
        'for other orders',
      ),
      field('returnGoods', listOf('string'), 'The goods a haul brings back.', 'for other orders'),
      field(
        'keepFood',
        'number',
        'The Food a haul keeps on board for the horse.',
        'for other orders',
      ),
      field(
        'stop',
        'string',
        'The haul stop a carriage is at or bound for: "from" or "to".',
        'for other orders',
      ),
      field(
        'phase',
        'string',
        'A haul’s "loading" or "driving", a road line’s "walking" or "building", a store’s "walking", "putting" or "refilling", a fetch’s "walking" or "taking".',
        'for other orders',
      ),
      field(
        'tiles',
        listOf('any'),
        'The road line’s tiles still to build, as [x, y] pairs.',
        'for other orders',
      ),
      field('side', 'string', 'A trade’s "buy" or "sell".', 'for other orders'),
      field('good', 'string', 'The good traded or handed in.', 'for other orders'),
      field('units', 'number', 'The units traded or handed in.', 'for other orders'),
      field('cityId', 'string', 'The city bought, or a caravan trade’s city.', 'for other orders'),
      field('toCityId', 'string', 'Where handed-in goods go.', 'for other orders'),
      field('contractId', 'string', 'The mercenary contract paid.', 'for other orders'),
      field('weeks', 'number', 'The weeks paid.', 'for other orders'),
      field('directiveId', 'string', 'The directive bought off.', 'for other orders'),
      field(
        'army',
        'string',
        'The army that gave this order.',
        'for an order of the resident’s own',
      ),
    ],
  },
  armyOrder: {
    description: 'An army’s order; which fields it has depends on its `kind`, the others are null.',
    fields: [
      field('kind', 'string', 'The order: "walkTo", "attack", "guard" or "follow".'),
      field('target', view('tile'), 'Where a walk goes.', 'for other orders'),
      field('at', view('tile'), 'Where it guards.', 'for other orders'),
      field('targetId', 'string', 'Who it attacks or follows.', 'for other orders'),
      field('started', 'boolean', 'Whether its members got their orders yet.'),
    ],
  },
  tile: {
    description: 'A tile.',
    fields: [
      field('x', 'number', 'From west to east.'),
      field('y', 'number', 'From north to south.'),
    ],
  },
  orderEnded: {
    description: 'How a resident’s last store or fetch order ended.',
    fields: [
      field('kind', 'string', 'The order: "store" or "fetch".'),
      field('tick', 'number', 'The tick it ended.'),
      field(
        'reason',
        'string',
        'Why it ended before it was done: "no way", "the storage is gone" or "the carriage is gone".',
        'when it was done',
      ),
    ],
  },
  pair: {
    description: 'A resident’s pair, to have a child.',
    fields: [
      field('partnerId', 'string', 'Who they are paired with.'),
      field('since', 'number', 'The tick they paired.'),
    ],
  },
  carrying: {
    description: 'A child a resident carries.',
    fields: [
      field('since', 'number', 'The tick they started carrying it.'),
      field('partnerId', 'string', 'The other parent.'),
      field('partnerName', 'string', 'The other parent’s name.'),
      field('partnerBase', 'any', 'The other parent’s base stats, like {strength: 5, …}.'),
    ],
  },
  runningScript: {
    description: 'The script a resident runs.',
    fields: [
      field(
        'scriptId',
        'number',
        'The script in its Player’s library; 0 while it runs a default without one.',
      ),
      field(
        'memory',
        'any',
        'Its memory, to read but not change.',
        'for a resident of another Player',
      ),
    ],
  },
  building: {
    description: 'A building or construction site, as the Player sees it.',
    fields: BUILDING_FIELDS,
  },
  site: {
    description: 'How far a construction site has come.',
    fields: [
      field('delivered', view('goods'), 'Materials delivered so far.'),
      field('work', 'number', 'Work put in so far.'),
    ],
  },
  price: {
    description: 'A price for one good, at a Trade Org warehouse or an NPC city.',
    fields: [
      field('good', 'string', 'The good.'),
      field('buy', 'number', 'What it pays for one unit.'),
      field('sell', 'number', 'What it asks for one unit.'),
      field('stock', 'number', 'What it holds.', 'unless the Player sees inside'),
      field('forSale', 'number', 'Units an NPC city would sell.', 'at a warehouse'),
      field('wanted', 'number', 'Units an NPC city would buy.', 'at a warehouse'),
    ],
  },
  city: {
    description: 'A city, as the Player sees it.',
    fields: CITY_FIELDS,
  },
  hire: {
    description: 'What an NPC city would lend.',
    fields: [
      field('spare', 'number', 'How many residents it would lend.'),
      field('pricePerResidentWeek', 'number', 'What it asks for each a week, in Coins.'),
    ],
  },
  horse: {
    description: 'A horse, as the Player sees it.',
    fields: [
      id('horse'),
      field('realmId', 'string', 'The realm it belongs to.', 'for one of an NPC city or of nobody'),
      field('cityId', 'string', 'The NPC city it belongs to.', 'for one of a realm or of nobody'),
      x,
      y,
      field(
        'hunger',
        'number',
        'Fully fed is 100, empty 0.',
        'for one of another realm that isn’t allied',
      ),
      field(
        'health',
        'number',
        '0 is dead; full is 100.',
        'for one of another realm that isn’t allied',
      ),
    ],
  },
  carriage: {
    description: 'A carriage, as the Player sees it.',
    fields: [
      id('carriage'),
      field('realmId', 'string', 'The realm it belongs to.', 'for one of an NPC city or of nobody'),
      field('cityId', 'string', 'The NPC city it belongs to.', 'for one of a realm or of nobody'),
      x,
      y,
      field('horseId', 'string', 'The horse hitched to it.', 'when none is'),
      field('load', view('goods'), 'The goods on board.', 'unless the Player sees inside'),
      field(
        'loadLevel',
        'string',
        'How heavily it looks loaded: "empty", "light", "half", "heavy" or "full".',
      ),
    ],
  },
  pile: {
    description: 'Goods lying on a tile.',
    fields: [id('pile'), x, y, field('goods', view('goods'), 'The goods lying there.')],
  },
  node: {
    description: 'A resource node.',
    fields: [
      id('node'),
      field('kind', 'string', 'What it yields: "forest", "stone", "ironOre" or "goldOre".'),
      x,
      y,
    ],
  },
  lastSeen: {
    description:
      'A building, construction site or city the Player has seen and that is out of their sight now, as they last saw it.',
    fields: [
      field('is', 'string', '"building" or "city".'),
      field('seenAt', 'number', 'The tick it was last in sight.'),
      id('building or city'),
      ...BUILDING_FIELDS.filter((f) => f.name !== 'id').map((f) => ({
        ...f,
        nullWhen: f.nullWhen ? `for a city, ${f.nullWhen}` : 'for a city',
      })),
      ...CITY_FIELDS.filter((f) => f.name !== 'id').map((f) => ({
        ...f,
        nullWhen: f.nullWhen ? `for a building, ${f.nullWhen}` : 'for a building',
      })),
    ],
  },
  directive: {
    description: 'An admin directive in force.',
    fields: [
      id('directive'),
      field('target', 'string', 'The realm or NPC city it names.'),
      field('targetName', 'string', 'The target’s name.'),
      field('withAlliance', 'boolean', 'Whether it names the target’s alliance too.'),
      field('reason', 'string', 'Why it was given.'),
      field('givenAt', 'number', 'The tick it was given.'),
      field('goals', listOf(view('directiveGoal')), 'What ends it.'),
      field(
        'price',
        'number',
        'The Coins the target can pay to buy it off.',
        'when it can’t be bought off',
      ),
    ],
  },
  directiveGoal: {
    description: 'A goal of an admin directive.',
    fields: [
      field('kind', 'string', '"city" or "soldiers".'),
      field(
        'city',
        'string',
        'The city to destroy, by its name when the goal was set.',
        'for a soldiers goal',
      ),
      field('count', 'number', 'Soldiers to kill.', 'for a city goal'),
      field(
        'percent',
        'number',
        'The share of its soldiers the count was set as.',
        'unless it was set as a share',
      ),
    ],
  },
  material: {
    description: 'Materials a construction site still lacks.',
    fields: [
      field('good', 'string', 'The good.'),
      field('units', 'number', 'How many units it lacks.'),
    ],
  },
}

/** A view's field by name, if it has one. */
export function scriptViewField(name: ScriptViewName, fieldName: string): ScriptField | undefined {
  return SCRIPT_VIEWS[name].fields.find((f) => f.name === fieldName)
}

/**
 * Where a script value doesn't hold what its type declares: a field missing that is never null,
 * or a value of the wrong kind, each with its path (`residents[0].stats`). A missing field reads
 * as `null` in a script, so it counts as a hidden one. Empty for a value that fits.
 */
export function scriptValueProblems(value: unknown, type: ScriptType, path: string): string[] {
  if (value === null || value === undefined || type === 'any') return []
  if (typeof type === 'string') {
    return typeof value === type ? [] : [`${path} is a ${typeof value}, not a ${type}`]
  }
  if ('list' in type) {
    if (!Array.isArray(value)) return [`${path} is not a list`]
    return value.flatMap((item, i) => scriptValueProblems(item, type.list, `${path}[${i}]`))
  }
  if (typeof value !== 'object' || Array.isArray(value)) return [`${path} is not a ${type.view}`]
  const record = value as Record<string, unknown>
  return SCRIPT_VIEWS[type.view].fields.flatMap((f) => {
    const at = `${path}.${f.name}`
    const item = record[f.name]
    if ((item === null || item === undefined) && f.nullWhen === undefined) {
      return [`${at} is missing`]
    }
    return scriptValueProblems(item, f.type, at)
  })
}
