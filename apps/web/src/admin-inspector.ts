import {
  BUILD_WORK,
  CARRIAGE_CAPACITY,
  GOODS,
  MAX_HEALTH,
  MAX_HUNGER,
  STAT_NAMES,
  stockWeight,
  type AdminInspectTarget,
  type AdminInspection,
  type AdminNamed,
  type AdminOrganization,
  type AdminScript,
  type AdminWorldView,
  type Army,
  type Caravan,
  type Stock,
} from '@csp/shared'
import { buildingCount } from './city-view.js'
import { BUILDING_NAMES } from './map/palette.js'
import { GOOD_LABELS, orderDoing } from './Residents.js'

/*
 * The admin map's read-only inspector (`CONTEXT.md`: admin map): what is clicked on the map,
 * worked out from the loaded view, and what its card says. It shows a script by name, never its
 * source, and offers nothing that acts in the world; the one thing it leads to is giving an admin
 * directive against what holds it.
 */

/**
 * What a click on a tile inspects: a resident on it, else a carriage (its caravan, if it is one),
 * a building (its city, for a town hall), goods on the ground, a horse, a road. Nothing when the
 * tile is open ground or not loaded.
 */
export function pickOnTile(
  view: AdminWorldView | null,
  x: number,
  y: number,
): AdminInspectTarget | undefined {
  const here = (view?.entities ?? []).filter(
    (e) => e.is !== 'city' && e.is !== 'army' && e.is !== 'caravan' && e.x === x && e.y === y,
  )
  const first = (is: string) => here.find((e) => e.is === is)
  const resident = first('resident')
  if (resident) return { kind: 'resident', id: resident.id }
  const carriage = first('carriage')
  if (carriage) {
    const caravan = view!.entities.find((e) => e.is === 'caravan' && e.carriageId === carriage.id)
    return caravan ? { kind: 'caravan', id: caravan.id } : { kind: 'carriage', id: carriage.id }
  }
  const building = here.find((e) => e.is === 'building' && e.kind !== 'road')
  if (building?.is === 'building') {
    if (building.kind === 'townHall' && building.cityId !== null && !building.site)
      return { kind: 'city', id: building.cityId }
    return { kind: 'building', id: building.id }
  }
  const other = first('pile') ?? first('horse') ?? first('building')
  return other && { kind: other.is as AdminInspectTarget['kind'], id: other.id }
}

/** Something on the card that inspects something else when clicked. */
export interface InspectorLink {
  target: AdminInspectTarget
  name: string
}

/** One line of the card: a label and its text, or the things it names. */
export interface InspectorRow {
  label: string
  text?: string
  links?: InspectorLink[]
}

/** What the inspector shows of one thing. */
export interface InspectorCard {
  title: string
  badge?: string
  /** Who it belongs to (`CONTEXT.md`: Organization). */
  owner: string
  rows: InspectorRow[]
  /** The realm or NPC city holding it, which a directive can be given against. */
  directive?: { org: string; name: string }
}

/** Goods in words: "4 iron ore, 2 wood", or "nothing". */
export function goodsText(stock: Stock | undefined): string {
  const parts = GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map(
    (g) => `${stock![g]} ${GOOD_LABELS[g].toLowerCase()}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

/** Who an Organization is, for the owner line. */
export function ownerText(org: AdminOrganization | null): string {
  if (!org) return 'Nobody’s'
  const whose =
    org.is === 'tradeOrg'
      ? org.name
      : org.is === 'city'
        ? `NPC city ${org.name}`
        : `Realm of ${org.name}${org.account ? ` (${org.account})` : ''}`
  return org.alliance ? `${whose} · alliance ${org.alliance.name}` : whose
}

const link = (kind: AdminInspectTarget['kind'], named: AdminNamed): InspectorLink => ({
  target: { kind, id: named.id },
  name: named.name,
})

/** A row naming one thing, or none when there is nothing to name. */
const linkRow = (
  label: string,
  kind: AdminInspectTarget['kind'],
  named: AdminNamed | null,
): InspectorRow[] => (named ? [{ label, links: [link(kind, named)] }] : [])

/** A running script by its name only (`AdminScript`); its source is never on the admin map. */
const scriptRow = (script: AdminScript | undefined): InspectorRow[] =>
  script ? [{ label: 'Script', text: script.name ?? 'a deleted script' }] : []

const tile = (at: { x: number; y: number }): InspectorRow => ({
  label: 'Tile',
  text: `${at.x}, ${at.y}`,
})

/** What an army's order has it doing. */
function armyDoing(order: Army['order']): string {
  if (!order) return 'Idle'
  if (order.kind === 'walkTo') return `Marching to ${order.target.x}, ${order.target.y}`
  if (order.kind === 'guard') return `Guarding ${order.at.x}, ${order.at.y}`
  if (order.kind === 'attack') return 'Attacking a resident'
  return 'Following a resident'
}

/** What a caravan is doing: a delivery, a pick-up or a transfer, or going along its route. */
function caravanDoing(c: Caravan, post: string): string {
  if (c.job) return c.job.kind === 'delivery' ? 'Carrying out a delivery' : 'Carrying out a pick-up'
  if (c.transfer) return 'Carrying out a transfer'
  const to = c.heading === 'hq' ? 'the HQ' : post
  return `On its route to ${to}, for the ${c.stop}`
}

/** A meter in whole points: "80 / 100". */
const meter = (value: number, most: number) => `${Math.round(value)} / ${most}`

const loadText = (load: Stock) =>
  `${Math.round(stockWeight(load))} / ${CARRIAGE_CAPACITY} kg: ${goodsText(load)}`

/** The inspector's card for one thing (`AdminInspection`). */
export function inspectorCard(ins: AdminInspection): InspectorCard {
  const org = ins.org
  const card = (c: Omit<InspectorCard, 'owner' | 'directive'>): InspectorCard => ({
    ...c,
    owner: ownerText(org),
    ...(org && org.is !== 'tradeOrg' ? { directive: { org: org.id, name: org.name } } : {}),
  })
  switch (ins.is) {
    case 'resident': {
      const r = ins.resident
      const stats = STAT_NAMES.map((s) => {
        const { base, trained } = r.stats[s]
        const name = s[0]!.toUpperCase() + s.slice(1)
        return `${name} ${base}${trained > 0 ? ` +${trained}` : ''}`
      })
      return card({
        title: r.name,
        ...(ins.leader ? { badge: 'Leader' } : {}),
        rows: [
          { label: 'Health', text: meter(r.health, MAX_HEALTH) },
          { label: 'Hunger', text: `${meter(r.hunger, MAX_HUNGER)} fed` },
          { label: 'Stats', text: stats.join(', ') },
          { label: 'Carries', text: goodsText(r.carried) },
          { label: 'Doing', text: orderDoing(r) },
          ...scriptRow(r.script),
          ...linkRow('City', 'city', ins.city),
          ...linkRow('Army', 'army', ins.army),
          ...linkRow('Caravan', 'caravan', ins.caravan),
          tile(r),
        ],
      })
    }
    case 'city': {
      const c = ins.city
      const badge =
        c.tradeOrg === 'hq'
          ? 'Trade Org HQ'
          : c.tradeOrg === 'post'
            ? 'Trading post'
            : c.formerPlayer
              ? 'Self-managed'
              : undefined
      const { open, shut } = ins.gates
      return card({
        title: c.name,
        ...(badge ? { badge } : {}),
        rows: [
          {
            label: `Residents (${ins.residents.length})`,
            ...(ins.residents.length > 0
              ? { links: ins.residents.map((r) => link('resident', r)) }
              : { text: 'none' }),
          },
          {
            label: 'Buildings',
            text: ins.buildings.map(([kind, n]) => buildingCount(kind, n)).join(', ') || 'none',
          },
          { label: 'Storage', text: goodsText(ins.storage) },
          { label: 'Gates', text: open + shut === 0 ? 'none' : `${open} open, ${shut} shut` },
          { label: 'Soldiers', text: String(ins.soldiers) },
          { label: 'Town hall', text: `${c.x}, ${c.y}` },
        ],
      })
    }
    case 'building': {
      const b = ins.building
      const name = BUILDING_NAMES[b.kind]
      const work = BUILD_WORK[b.kind] ?? 0
      return card({
        title: b.site ? `${name} site` : name,
        rows: [
          ...linkRow('City', 'city', ins.city),
          ...(b.site
            ? [
                {
                  label: 'Built',
                  text: `${work > 0 ? Math.floor((b.site.work / work) * 100) : 100}% of the work done`,
                },
                { label: 'Delivered', text: goodsText(b.site.delivered) },
              ]
            : []),
          ...(b.stock ? [{ label: 'Holds', text: goodsText(b.stock) }] : []),
          ...(b.kind === 'gate' && !b.site
            ? [{ label: 'Gate', text: b.closed ? 'Shut' : 'Open' }]
            : []),
          tile(b),
        ],
      })
    }
    case 'horse':
      return card({
        title: 'Horse',
        rows: [
          { label: 'Health', text: meter(ins.horse.health, MAX_HEALTH) },
          { label: 'Hunger', text: `${meter(ins.horse.hunger, MAX_HUNGER)} fed` },
          tile(ins.horse),
        ],
      })
    case 'carriage': {
      const k = ins.carriage
      return card({
        title: 'Carriage',
        rows: [
          { label: 'Load', text: loadText(k.load) },
          { label: 'Horse', text: k.horseId ? 'Hitched' : 'None hitched' },
          ...linkRow('Driver', 'resident', ins.driver),
          ...linkRow('Caravan', 'caravan', ins.caravan),
          tile(k),
        ],
      })
    }
    case 'pile':
      return card({
        title: 'Goods on the ground',
        rows: [{ label: 'Goods', text: goodsText(ins.pile.goods) }, tile(ins.pile)],
      })
    case 'army': {
      const a = ins.army
      return card({
        title: a.name,
        badge: 'Army',
        rows: [
          { label: 'Doing', text: armyDoing(a.order) },
          ...scriptRow(a.script),
          {
            label: `Members (${ins.members.length})`,
            links: ins.members.map((m) => link('resident', m)),
          },
        ],
      })
    }
    case 'caravan': {
      const post = ins.post?.name ?? 'a lost post'
      return card({
        title: `Caravan to ${post}`,
        badge: 'Caravan',
        rows: [
          { label: 'Doing', text: caravanDoing(ins.caravan, post) },
          ...linkRow('Trading post', 'city', ins.post),
          ...(ins.carriage
            ? [{ label: 'Load', text: loadText(ins.carriage.load) }, tile(ins.carriage)]
            : []),
          {
            label: `Crew (${ins.crew.length})`,
            links: ins.crew.map((m) => link('resident', m)),
          },
        ],
      })
    }
  }
}
