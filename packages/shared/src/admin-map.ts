import type {
  Army,
  Building,
  Caravan,
  Carriage,
  City,
  Horse,
  Pile,
  Resident,
  ScriptMemory,
} from './world.js'

/*
 * What the admin map gets from the server (`CONTEXT.md`: Admin, admin map): the whole world, for
 * admins only, read between ticks. Script sources are never in it.
 */

/** Where an admin loads the map they draw: its seed and size (`MapInfo`). */
export const ADMIN_MAP_INFO_PATH = '/api/admin/map'
/** Where an admin loads every entity in a rectangle of tiles (`adminWorldPath`). */
export const ADMIN_WORLD_PATH = '/api/admin/world'
/** Where an admin loads the jump list's places, for the whole world (`AdminPlaces`). */
export const ADMIN_PLACES_PATH = '/api/admin/places'
/** Where an admin loads the territory of the whole map, as a `RegionMap` of all of it. */
export const ADMIN_TERRITORY_PATH = '/api/admin/territory'

/**
 * The widest and tallest rectangle `ADMIN_WORLD_PATH` gives every entity in, in tiles; the far
 * zoom asks for cities only, which may span the whole map.
 */
export const ADMIN_VIEW_MAX_SIDE = 256

/**
 * The rectangle of tiles whose entities an admin loads: `w` × `h` tiles from (x, y), wrapping
 * around the map's edges like the map does. With `citiesOnly`, just the cities whose town hall
 * stands in it.
 */
export interface AdminViewRequest {
  x: number
  y: number
  w: number
  h: number
  citiesOnly?: boolean
}

export function adminWorldPath(view: AdminViewRequest): string {
  const { x, y, w, h, citiesOnly } = view
  return `${ADMIN_WORLD_PATH}?x=${x}&y=${y}&w=${w}&h=${h}${citiesOnly ? '&citiesOnly=1' : ''}`
}

/**
 * An Organization as the admin map colours and names it (`CONTEXT.md`: Organization): a realm
 * (with its Player's account), an NPC city, or the Trade Organization (`TRADE_ORGANIZATION`).
 */
export interface AdminOrganization {
  id: string
  is: 'realm' | 'city' | 'tradeOrg'
  /** A realm by its Leader's name, an NPC city by its own, the Trade Organization by its. */
  name: string
  /** A realm's Player's account name. */
  account?: string
  /** The alliance a realm or NPC city is a member of. */
  alliance: { id: string; name: string } | null
}

/** A running script as admins see it: which one, by name, and its memory; never its source. */
export interface AdminScript {
  scriptId: number
  /** The script's name in its Player's library; null once it was deleted. */
  name: string | null
  memory: ScriptMemory
}

/**
 * Something on the admin map, tagged with what it is and the Organization it belongs to (`org`,
 * one of `AdminWorldView.orgs`; null for what belongs to none, such as a pile or a workplace). A
 * city carries its town hall's position and how many houses it has, which size its far emblem.
 */
export type AdminEntity = { org: string | null } & (
  | ({ is: 'resident' } & Omit<Resident, 'script'> & { script?: AdminScript })
  | ({ is: 'building' } & Building)
  | ({ is: 'city' } & City & { x: number; y: number; houses: number })
  | ({ is: 'horse' } & Horse)
  | ({ is: 'carriage' } & Carriage)
  | ({ is: 'pile' } & Pile)
  | ({ is: 'army' } & Omit<Army, 'script'> & { script?: AdminScript })
  | ({ is: 'caravan' } & Caravan)
)

/** Every entity in an admin's rectangle (`AdminViewRequest`), and the Organizations they name. */
export interface AdminWorldView {
  tick: number
  orgs: AdminOrganization[]
  entities: AdminEntity[]
}

/** A spot on the jump list: something by name and where it is. */
export interface AdminPlace {
  id: string
  name: string
  x: number
  y: number
}

/**
 * The jump list (`CONTEXT.md`: admin map), for the whole world: realms with their Leader and
 * cities, NPC cities (self-managed ones included), the Trade Organization's HQ, trading posts and
 * caravans, and armies.
 */
export interface AdminPlaces {
  tick: number
  realms: {
    id: string
    /** The Player's account name; null if the account is gone. */
    account: string | null
    /** The realm by its Leader's name. */
    name: string
    alliance: { id: string; name: string } | null
    /** Where its Leader stands; null while it has none. */
    leader: AdminPlace | null
    cities: AdminPlace[]
  }[]
  npcCities: (AdminPlace & {
    /** Once a Player's, left without a Leader (`CONTEXT.md`: Self-managed city). */
    selfManaged: boolean
    alliance: { id: string; name: string } | null
  })[]
  tradeOrg: {
    hq: AdminPlace | null
    posts: AdminPlace[]
    /** Each where its carriage is, named after its trading post. */
    caravans: (AdminPlace & { postId: string; heading: Caravan['heading'] })[]
  }
  /** Each where one of its members stands; an army with none left is not listed. */
  armies: (AdminPlace & { realmId: string; realm: string })[]
}
