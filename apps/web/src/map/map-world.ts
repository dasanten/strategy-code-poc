import type {
  Army,
  Building,
  Carriage,
  Horse,
  Pile,
  Resident,
  SeenCaravan,
  SeenCity,
} from '@csp/shared'
import type { CityEmblem, FarMarker } from './far.js'
import type { RegionState } from './region.js'

/**
 * What the map draws (`MapView`): what a Player sees (`ClientWorld`), or on the admin map the
 * whole world (`admin-map.ts`).
 */
export interface MapWorld {
  map: { size: number }
  /** Chunks whose terrain may be loaded; any copy of `grownChunks` loaded before is stale. */
  exploredChunks: ReadonlySet<number>
  grownChunks: readonly number[]
  /** Whose realm is "own", its Leader, and where the view centres. */
  home: { realmId: string; leaderId: string | null; x: number; y: number }
  residents: Resident[]
  cities: SeenCity[]
  buildings: Building[]
  horses: Horse[]
  carriages: Carriage[]
  piles: Pile[]
  armies: Pick<Army, 'id' | 'realmId' | 'memberIds'>[]
  caravans: SeenCaravan[]
  diplomacy: { alliance?: { members: readonly { realmId: string }[] } | null }
  region: RegionState | null
  /** Set on the admin map, which looks at the world as nobody's (`CONTEXT.md`: admin map). */
  admin?: AdminLook
}

/** How the admin map differs from a Player's: colours, crowns and the far tier. */
export interface AdminLook {
  /** Each realm's colour on its tokens, instead of how the viewer stands to it. */
  realmColour: (realmId: string) => number
  /** Every Leader wears the crown. */
  leaders: ReadonlySet<string>
  /** The far tier's cities and markers, for the whole world. */
  emblems: readonly CityEmblem[]
  markers: readonly FarMarker[]
  /** The whole map's terrain, drawn in the far tier (`map/overview.ts`); null until loaded. */
  overview: Uint8Array | null
}
