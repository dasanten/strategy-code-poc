import type {
  Building,
  City,
  Compare,
  Condition,
  Good,
  HourSide,
  LoadState,
  NeedName,
  Side,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './city-view.js'
import { GOOD_LABELS } from './goods-grid.js'

/**
 * Conditions as the planner shows and edits them (`CONTEXT.md`: Condition, Wait until): a label
 * for each, and the condition editor's draft, which keeps every kind's fields so switching kinds
 * loses nothing.
 */

/** Each kind of condition as the editor names it. */
export const CONDITION_KIND_LABELS: Record<Condition['kind'], string> = {
  carries: 'Carrying',
  load: 'Full or empty',
  stock: 'Stock at a place',
  need: 'Hunger or health',
  mounted: 'Mounted',
  aboard: 'Aboard',
  hour: 'Game hour',
}

/** What the condition editor holds: a kind, and the fields of every kind. */
export interface ConditionDraft {
  kind: Condition['kind']
  /** Asks about the carriage or vessel they drive rather than them. */
  vehicle: boolean
  good: Good
  compare: Compare
  amount: number
  load: LoadState
  /** The building picked on the map, for stock. */
  placeId?: string
  need: NeedName
  needSide: Side
  /** A share from 0 to 1. */
  share: number
  is: boolean
  hourSide: HourSide
  hour: number
}

/** A fresh draft: what the editor starts with. */
export const NEW_DRAFT: ConditionDraft = {
  kind: 'stock',
  vehicle: false,
  good: 'wood',
  compare: 'atLeast',
  amount: 20,
  load: 'full',
  need: 'hunger',
  needSide: 'below',
  share: 0.5,
  is: true,
  hourSide: 'after',
  hour: 8,
}

/** The condition a draft makes; undefined for stock while no place is picked. */
export function conditionOf(d: ConditionDraft): Condition | undefined {
  const vehicle = d.vehicle ? { vehicle: true } : {}
  switch (d.kind) {
    case 'carries':
      return { kind: 'carries', ...vehicle, good: d.good, compare: d.compare, amount: d.amount }
    case 'load':
      return { kind: 'load', ...vehicle, load: d.load }
    case 'stock':
      if (!d.placeId) return undefined
      return {
        kind: 'stock',
        placeId: d.placeId,
        good: d.good,
        compare: d.compare,
        amount: d.amount,
      }
    case 'need':
      return { kind: 'need', need: d.need, side: d.needSide, share: d.share }
    case 'mounted':
      return { kind: 'mounted', is: d.is }
    case 'aboard':
      return { kind: 'aboard', is: d.is }
    case 'hour':
      return { kind: 'hour', side: d.hourSide, hour: d.hour }
  }
}

/** A building as a condition names it, by kind and city. */
type NamedPlace = Pick<Building, 'id' | 'kind'> & Partial<Pick<Building, 'cityId'>>

/** What condition labels name: the buildings in sight or last seen, and the cities known. */
export interface ConditionNames {
  buildings?: readonly NamedPlace[]
  lastSeen?: readonly NamedPlace[]
  cities?: readonly Pick<City, 'id' | 'name'>[]
}

const amountOf = (compare: Compare, amount: number, good: Good) =>
  `${compare === 'atLeast' ? 'at least' : 'less than'} ${amount} ${GOOD_LABELS[good].toLowerCase()}`

const hourOf = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/**
 * A condition in words, to follow "Wait until": "the storage in Ashford holds at least 20 wood",
 * "they carry less than 5 stone", "their hunger meter is below 50%", "it is 08:00 or later".
 */
export function conditionLabel(c: Condition, names: ConditionNames = {}): string {
  const who = 'vehicle' in c && c.vehicle ? 'their carriage or boat' : 'they'
  switch (c.kind) {
    case 'carries':
      return `${who} ${who === 'they' ? 'carry' : 'carries'} ${amountOf(c.compare, c.amount, c.good)}`
    case 'load':
      return `${who} ${who === 'they' ? 'are' : 'is'} ${c.load}`
    case 'stock':
      return `${placeName(c.placeId, names)} holds ${amountOf(c.compare, c.amount, c.good)}`
    case 'need':
      return `their ${c.need === 'hunger' ? 'hunger meter' : 'health'} is ${c.side} ${Math.round(c.share * 100)}%`
    case 'mounted':
      return c.is ? 'they are mounted' : 'they are not mounted'
    case 'aboard':
      return c.is ? 'they are aboard' : 'they are not aboard'
    case 'hour':
      return c.side === 'before'
        ? `it is before ${hourOf(c.hour)}`
        : `it is ${hourOf(c.hour)} or later`
  }
}

/** A place a condition names: "the storage in Ashford", as last seen when out of sight. */
export function placeName(
  id: string,
  { buildings = [], lastSeen = [], cities = [] }: ConditionNames,
): string {
  const seen = buildings.find((b) => b.id === id)
  const b = seen ?? lastSeen.find((l) => l.id === id)
  if (!b) return 'the place'
  const city = cities.find((c) => c.id === b.cityId)?.name
  return `the ${BUILDING_NAMES[b.kind]}${city ? ` in ${city}` : ''}${seen ? '' : ' (as last seen)'}`
}

/** The draft the editor starts from to change a condition: its fields over a fresh draft's. */
export function draftOf(c: Condition): ConditionDraft {
  const d: ConditionDraft = { ...NEW_DRAFT, kind: c.kind }
  switch (c.kind) {
    case 'carries':
      return {
        ...d,
        vehicle: c.vehicle ?? false,
        good: c.good,
        compare: c.compare,
        amount: c.amount,
      }
    case 'load':
      return { ...d, vehicle: c.vehicle ?? false, load: c.load }
    case 'stock':
      return { ...d, placeId: c.placeId, good: c.good, compare: c.compare, amount: c.amount }
    case 'need':
      return { ...d, need: c.need, needSide: c.side, share: c.share }
    case 'mounted':
    case 'aboard':
      return { ...d, is: c.is }
    case 'hour':
      return { ...d, hourSide: c.side, hour: c.hour }
  }
}
