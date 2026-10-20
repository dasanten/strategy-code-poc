import { SCRIPT_ACTION_COST, SCRIPT_LIST_QUERY_COST, SCRIPT_TILE_QUERY_COST } from './balance.js'

/**
 * The game API as a script sees it (`CONTEXT.md`: Script, Memory, Step budget; ADR 0002): the
 * built-in names a running script gets, as plain data, so the server binds them and the editor
 * can list them. Values are read like variables; queries and actions are called.
 *
 * - A **value** is set before the run: `me` (the resident running the script), `memory`, `tick`,
 *   `mapSize`.
 * - A **query** answers from what the Player sees and has explored, nothing more.
 * - An **action** asks for the order of the same name for `me`, checked exactly as a UI order
 *   is. It answers `null` when requested, or why not as a string; a script can request nothing
 *   an order couldn't.
 *
 * `cost` is the steps one call costs on top of the 1 every evaluated node costs.
 */
export interface ScriptBinding {
  name: string
  is: 'value' | 'query' | 'action'
  /** The arguments, by name; a `?` marks one that may be left out. */
  params: readonly string[]
  cost: number
  description: string
}

const value = (name: string, description: string): ScriptBinding => ({
  name,
  is: 'value',
  params: [],
  cost: 0,
  description,
})

const list = (name: string, description: string): ScriptBinding => ({
  name,
  is: 'query',
  params: [],
  cost: SCRIPT_LIST_QUERY_COST,
  description,
})

const action = (name: string, params: string[], description: string): ScriptBinding => ({
  name,
  is: 'action',
  params,
  cost: SCRIPT_ACTION_COST,
  description,
})

export const SCRIPT_API: readonly ScriptBinding[] = [
  value('me', 'The resident running the script, as the Player sees them, with their `age`.'),
  value('memory', 'An object kept between ticks for this resident; whatever is set on it stays.'),
  value('tick', 'The world tick this run is for.'),
  value('mapSize', 'Tiles along each side of the map; its opposite sides join.'),

  list('residents', 'The residents the Player sees, their own included.'),
  list('buildings', 'The buildings and construction sites the Player sees, roads included.'),
  list('cities', 'The cities the Player sees any of.'),
  list('horses', 'The horses the Player sees.'),
  list('carriages', 'The carriages the Player sees.'),
  list('piles', 'The piles of goods the Player sees.'),
  list('nodes', 'The resource nodes on terrain the Player has explored.'),
  {
    name: 'terrainAt',
    is: 'query',
    params: ['x', 'y'],
    cost: SCRIPT_TILE_QUERY_COST,
    description:
      'The terrain of a tile ("plains", "forest", "hills", "mountain", "lake" or "sea"), or null where the Player hasn’t explored.',
  },
  {
    name: 'distance',
    is: 'query',
    params: ['a', 'b'],
    cost: SCRIPT_TILE_QUERY_COST,
    description: 'Tiles between two things with `x` and `y`, the short way round the map.',
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
    'pickUp',
    ['spot', 'goods'],
    'Take goods from a spot on my tile: {kind: "ground"}, {kind: "storage", storageId}, {kind: "site", siteId} or {kind: "carriage", carriageId}; goods like {food: 3}.',
  ),
  action('drop', ['spot', 'goods'], 'Put carried goods down at a spot on my tile.'),
  action('build', ['building'], 'Lay out or join a construction site of that kind on my tile.'),
  action('tearDown', ['buildingId'], 'Tear down the building or site on my tile.'),
  action('workAt', ['makes?'], 'Work the workplace on my tile; at a smithy, say what to make.'),
  action('pair', ['partnerId'], 'Pair with an adult of my city to have children.'),
  action('attack', ['targetId'], 'Go after a resident I see and strike them.'),
  action(
    'pay',
    ['contractId', 'weeks'],
    'On a mercenary contract’s storage, put in the coins for some weeks of it.',
  ),
  action(
    'roadLine',
    ['x', 'y'],
    'Build road on each tile of the line from my tile to (x, y), one after another, with the stone I carry.',
  ),
]
