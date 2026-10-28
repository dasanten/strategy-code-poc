import {
  DOING_MAX_LENGTH,
  SCRIPT_ACTION_COST,
  SCRIPT_LIST_QUERY_COST,
  SCRIPT_TILE_QUERY_COST,
} from './balance.js'
import type { ScriptType, ScriptViewName } from './script-views.js'

/**
 * The game API as a script sees it (`CONTEXT.md`: Script, Memory, Step budget; ADR 0002): the
 * built-in names a running script gets, as plain data, so the server binds them and the editor
 * can list them. Values are read like variables; queries and actions are called. A resident's
 * script gets `SCRIPT_API`, an army's `ARMY_SCRIPT_API`: the same values and queries, but
 * army actions.
 *
 * - A **value** is set before the run: `me` (the resident or army running the script),
 *   `memory`, `tick`, `mapSize`.
 * - A **query** answers from what the Player sees and has explored, nothing more.
 * - An **action** asks for the order of the same name for `me`, checked exactly as a UI order
 *   is. It answers `null` when requested, or why not as a string; a script can request nothing
 *   an order couldn't. `doing` and `end` ask for no order: `doing` keeps the resident's Doing
 *   line in `memory` (`CONTEXT.md`: Doing), `end` ends the script once this run is over.
 *
 * `cost` is the steps one call costs on top of the 1 every evaluated node costs. `returns` is
 * what a value holds or a call answers, in terms of the script views (ADR 0011).
 */
export interface ScriptBinding {
  name: string
  is: 'value' | 'query' | 'action'
  /** The arguments, by name; a `?` marks one that may be left out. */
  params: readonly string[]
  cost: number
  description: string
  returns: ScriptType
}

const value = (name: string, returns: ScriptType, description: string): ScriptBinding => ({
  name,
  is: 'value',
  params: [],
  cost: 0,
  description,
  returns,
})

const list = (
  name: string,
  of: ScriptViewName,
  description: string,
  params: string[] = [],
): ScriptBinding => ({
  name,
  is: 'query',
  params,
  cost: SCRIPT_LIST_QUERY_COST,
  description,
  returns: { list: { view: of } },
})

/** An action answers `null` when its order was requested, or why not as a string. */
const action = (name: string, params: string[], description: string): ScriptBinding => ({
  name,
  is: 'action',
  params,
  cost: SCRIPT_ACTION_COST,
  description,
  returns: 'string',
})

/** The values every script gets but `me`, and the queries. */
const SHARED: readonly ScriptBinding[] = [
  value(
    'memory',
    'any',
    'An object kept between ticks for whoever runs it; whatever is set on it stays.',
  ),
  value(
    'params',
    'any',
    'The values of the script’s `param` lines, picked on the resident card for whoever runs it: `params.name` for `param name: type`; null while none is picked.',
  ),
  value('tick', 'number', 'The world tick this run is for.'),
  value('mapSize', 'number', 'Tiles along each side of the map; its opposite sides join.'),
  value(
    'random',
    'number',
    'A number from 0 up to 1, drawn anew each tick and the same for every script that tick, so residents can agree on a random pick.',
  ),

  list(
    'residents',
    'resident',
    'The residents the Player sees, their own included; those of their own running a script with its `script.memory`, to read but not change.',
  ),
  list(
    'buildings',
    'building',
    'The buildings and construction sites the Player sees, roads included.',
  ),
  list('cities', 'city', 'The cities the Player sees any of.'),
  list('horses', 'horse', 'The horses the Player sees.'),
  list('carriages', 'carriage', 'The carriages the Player sees.'),
  list('piles', 'pile', 'The piles of goods the Player sees.'),
  list('nodes', 'node', 'The resource nodes on terrain the Player has explored.'),
  list(
    'lastSeen',
    'lastSeen',
    'The buildings, construction sites and cities the Player has seen and that are out of their sight now, as they last saw them: each with `is` ("building" or "city") and `seenAt`, the tick they were last seen.',
  ),
  list(
    'directives',
    'directive',
    'The admin directives in force, which every Player sees: target, reason and the price to buy one off (null when it can’t be).',
  ),
  list(
    'withMemory',
    'resident',
    'My realm’s residents running a script whose `memory[key]` is `value`, as `residents()` shows them, with their `script.memory`.',
    ['key', 'value'],
  ),
  {
    name: 'building',
    is: 'query',
    params: ['id'],
    returns: { view: 'building' },
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The building or construction site with that id, if the Player sees it or it is one of my realm’s cities’; else null.',
  },
  {
    name: 'pileAt',
    is: 'query',
    params: ['x', 'y'],
    returns: { view: 'goods' },
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The goods lying on a tile, like {food: 3}, if the Player sees it; null where none lie or it isn’t seen.',
  },
  {
    name: 'outputOf',
    is: 'query',
    params: ['building'],
    returns: { list: 'string' },
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The goods a workplace makes, as a list (at a smithy everything it can make); empty for any other building.',
  },
  {
    name: 'materialsNeeded',
    is: 'query',
    params: ['site'],
    returns: { list: { view: 'material' } },
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The materials a construction site still lacks, as a list like [{good: "wood", units: 12}]; empty once it has them all, and for a finished building.',
  },
  {
    name: 'terrainAt',
    is: 'query',
    params: ['x', 'y'],
    returns: 'string',
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The terrain of a tile ("plains", "forest", "hills", "mountain", "lake" or "sea"), or null where the Player hasn’t explored.',
  },
  {
    name: 'distance',
    is: 'query',
    params: ['a', 'b'],
    returns: 'number',
    cost: SCRIPT_TILE_QUERY_COST,
    description: 'Tiles between two things with `x` and `y`, the short way round the map.',
  },
]

/**
 * What a script's `param` line can hold (`CONTEXT.md`: Script parameter): `param name: type`
 * at the top of a script, read as `params.name`, picked per resident on their card. The same
 * types as `PARAM_TYPES` in `@csp/lang`.
 */
export const SCRIPT_PARAM_TYPES = ['building', 'storage'] as const
export type ScriptParamType = (typeof SCRIPT_PARAM_TYPES)[number]

export function isScriptParamType(value: unknown): value is ScriptParamType {
  return (SCRIPT_PARAM_TYPES as readonly unknown[]).includes(value)
}

/** What each param type accepts, for the Wiki and the editor. */
export const PARAM_DESCRIPTIONS: Readonly<Record<ScriptParamType, string>> = {
  building: 'One of my realm’s buildings or construction sites.',
  storage: 'One of my realm’s storages or stables, or one of its carriages.',
}

/** A script's `param` line. */
export interface ScriptParam {
  name: string
  type: ScriptParamType
}

/** The game API of a resident's script. */
export const SCRIPT_API: readonly ScriptBinding[] = [
  value(
    'me',
    { view: 'resident' },
    'The resident running the script, as the Player sees them, with their `age`.',
  ),
  ...SHARED,
  {
    name: 'fits',
    is: 'query',
    params: ['good'],
    returns: 'number',
    cost: SCRIPT_TILE_QUERY_COST,
    description: 'How many units of a good still fit in my hands.',
  },
  list(
    'storages',
    'building',
    'The finished storages of my realm (of my city, for an NPC city’s resident); with `from`, something with `x` and `y`, nearest first by my `walkTime` from it; with `goods`, a list of goods, only those holding any of them.',
    ['from?', 'goods?'],
  ),
  {
    name: 'walkTime',
    is: 'query',
    params: ['a', 'b'],
    returns: 'number',
    cost: SCRIPT_LIST_QUERY_COST,
    description:
      'About how many ticks I take to walk from one thing with `x` and `y` to another: the straight way across the terrain, diagonally where it slants, roads and walls left out.',
  },

  action('walkTo', ['x', 'y'], 'Walk to a tile.'),
  action('drive', ['carriageId', 'x', 'y'], 'Drive the carriage on my tile to a tile.'),
  action(
    'haul',
    ['carriageId', 'x', 'y', 'goods', 'returnGoods?', 'keepFood?'],
    'Drive a haul route between my tile and (x, y): `goods` there, `returnGoods` back.',
  ),
  action('stop', [], 'Stop what I was ordered to do and stand idle.'),
  action(
    'end',
    [],
    'End this script: once this run is over I stand idle and run it no more, and in a queue its next step starts. It asks for no order.',
  ),
  action(
    'doing',
    ['text'],
    `Say what I’m doing, for my Player’s Doing line: the text (cut to ${DOING_MAX_LENGTH} characters) shows instead of the one the game derives from my task and order, until I call it again; null gives the derived one back. Kept as \`memory.doing\`; it asks for no order.`,
  ),
  action(
    'pickUp',
    ['spot', 'goods'],
    'Take goods from a spot on my tile: {kind: "ground"}, {kind: "storage", storageId}, {kind: "site", siteId} or {kind: "carriage", carriageId}; goods like {food: 3}.',
  ),
  action('drop', ['spot', 'goods'], 'Put carried goods down at a spot on my tile.'),
  action(
    'store',
    ['goods', 'to?'],
    'Walk to `to` (a storage, a stable or a carriage of mine; by default the nearest storage of my realm), put the goods down there and, at a storage with Food, top up my own food. Goods like {wood: 10}, or a list like ["wood"] for all I carry of them (Food beyond my own food). My order is "store" until done; then `me.orderEnded` says how it ended.',
  ),
  action(
    'fetch',
    ['goods', 'from?'],
    'Walk to `from` (a storage, a stable or a carriage of mine; by default the nearest storage or carriage of my realm holding any of the goods) and take the goods there, as much as fits. Goods like {wood: 10}, or a list like ["wood"] for as much as there is. My order is "fetch" until done; then `me.orderEnded` says how it ended.',
  ),
  action('build', ['building'], 'Lay out or join a construction site of that kind on my tile.'),
  action('tearDown', ['buildingId'], 'Tear down the building or site on my tile.'),
  action('workAt', ['makes?'], 'Work the workplace on my tile; at a smithy, say what to make.'),
  action('pair', ['partnerId'], 'Pair with an adult of my city to have children.'),
  action(
    'attack',
    ['targetId'],
    'Go after a resident I see and strike them, or strike a wall or gate of another realm until it falls.',
  ),
  action('climb', ['wallId'], 'Climb over the wall or gate of another realm next to me.'),
  action(
    'pay',
    ['contractId', 'weeks'],
    'On a mercenary contract’s storage, put in the coins for some weeks of it.',
  ),
  action(
    'buyCity',
    ['cityId'],
    'On an NPC city’s town hall, buy it with the coins my realm’s residents there carry.',
  ),
  action(
    'buy',
    ['good', 'units', 'carriageId?', 'cityId?'],
    'On a Trade Org warehouse or an NPC city’s storage, buy up to `units` of a good at its prices with the coins in my hands, or on my carriage there. At a warehouse, with `cityId`, one of my realm’s cities, a caravan delivers them to its storage for a fee.',
  ),
  action(
    'sell',
    ['good', 'units', 'carriageId?', 'cityId?'],
    'On a Trade Org warehouse or an NPC city’s storage, sell up to `units` of a good at its prices from my hands, or from my carriage there. At a warehouse, with `cityId` (and no carriage), a caravan picks them up from that city’s storage and pays there, less a fee.',
  ),
  action(
    'handIn',
    ['good', 'units', 'toCityId', 'carriageId?'],
    'On a Trade Org warehouse, hand in up to `units` of a good (coins too) from my hands, or from my carriage there, with the fee, for a caravan to bring to the storage of `toCityId`, a city of another realm.',
  ),
  action(
    'buyOff',
    ['directiveId', 'carriageId?'],
    'On a Trade Org warehouse, pay the price of an admin directive against my realm with the coins in my hands, or on my carriage there, to end it.',
  ),
  action(
    'handOver',
    ['newLeaderId'],
    'As my realm’s Leader, make another resident its Leader: an adult of my realm serving no one else (no mercenary contract, not in the alliance army), standing in the same city of my realm as I do. Free and at once; I stay on as an ordinary resident.',
  ),
  action(
    'rename',
    ['residentId', 'name', 'realmName?'],
    'Give a resident of my realm, me or my Leader included, a new name: free and at once, from anywhere. Renaming the Leader of a realm with no realm name yet needs `realmName` too, which names the realm; a named realm keeps its name.',
  ),
  action(
    'renameCity',
    ['cityId', 'name'],
    'Give a city of my realm a new name: free and at once, from anywhere. Others go on knowing it by its old name until they see it again.',
  ),
  action(
    'roadLine',
    ['x', 'y'],
    'Build road on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the stone I carry.',
  ),
  action(
    'wallLine',
    ['x', 'y'],
    'Build wall on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the materials I carry; tiles with a wall or gate already are skipped.',
  ),
]

/**
 * The game API of an army's script (`CONTEXT.md`: Army). Its actions ask for the army order of
 * the same meaning (`walkTo` is `armyWalkTo`, and so on), checked exactly as a UI army order is.
 */
export const ARMY_SCRIPT_API: readonly ScriptBinding[] = [
  value(
    'me',
    { view: 'army' },
    'The army running the script: its `name`, `order`, `memberIds`, and its `members` as the Player sees them.',
  ),
  ...SHARED,

  action('walkTo', ['x', 'y'], 'The army walks to a tile together.'),
  action('guard', ['x', 'y'], 'The army walks to a tile together and stays there.'),
  action('attack', ['targetId'], 'The army goes after a resident of another realm in sight.'),
  action('follow', ['targetId'], 'The army keeps in contact with a resident in sight.'),
  action('stop', [], 'The army stops: its order ends.'),
]
