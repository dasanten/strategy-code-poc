import {
  BUILD_MATERIALS,
  BUILD_WORK,
  BUILDABLE,
  GOODS,
  NODE_WORKPLACE,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  NODE_GOOD,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
  STAT_NAMES,
  STAT_BASE_MAX,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  TRAINED_CAP_SHARE,
  ageInYears,
  canWork,
  carryCapacity,
  materialsNeeded,
  teardownReturns,
  teardownWork,
  stockWeight,
  trainedCap,
  type Building,
  type BuildingKind,
  type Good,
  type GoodsSpot,
  type KnownNode,
  type Pile,
  type Resident,
  type SkillName,
  type StatName,
  type Stock,
} from '@csp/shared'
import { useState } from 'react'
import { BUILDING_NAMES, NODE_NAMES } from './map/palette.js'

const GOOD_LABELS: Record<Good, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  ironOre: 'Iron ore',
  iron: 'Iron',
  goldOre: 'Gold ore',
  coins: 'Coins',
}

/** A weight in kg, to one decimal (coins weigh little). */
const kg = (weight: number) => `${Math.round(weight * 10) / 10} kg`

/** The goods in a stock that are there, in the usual order. */
const goodsIn = (stock: Stock | undefined) =>
  GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map((g) => [g, stock![g]!] as const)

const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  endurance: 'Endurance',
  agility: 'Agility',
  intellect: 'Intellect',
}

const SKILL_LABELS: Record<SkillName, string> = {
  mining: 'Mining',
  woodcutting: 'Woodcutting',
  construction: 'Construction',
  farming: 'Farming',
  combat: 'Combat',
  driving: 'Driving',
}

/** The longest a stat bar can be: the highest base plus the most training could add to it. */
const STAT_SCALE = STAT_BASE_MAX * (1 + TRAINED_CAP_SHARE)

/** Meter colour by how full it is: low is a warning, half-empty a caution. */
function meterClass(share: number): string {
  return share < 0.25 ? 'low' : share < 0.5 ? 'mid' : 'ok'
}

const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`

/** What a resident is doing, from their order. */
function doing(r: Resident): string {
  const o = r.order
  if (o?.kind === 'walkTo') {
    if (!o.path) return `Finding a way to ${o.target.x}, ${o.target.y}`
    return `Walking to ${o.target.x}, ${o.target.y} · ${o.path.length} tiles to go`
  }
  if (o?.kind === 'pickUp') return 'Picking up goods'
  if (o?.kind === 'drop') return 'Putting down goods'
  if (o?.kind === 'tearDown') return 'Tearing down'
  if (o?.kind === 'build') {
    const what = BUILDING_NAMES[o.building].toLowerCase()
    return o.siteId === null ? `Laying out a ${what}` : `Building a ${what}`
  }
  if (o?.kind === 'workAt') return 'Working'
  if (o?.kind === 'pair') return 'Paired'
  return 'Idle'
}

/** The Player's residents, one row each; click a row to inspect that resident. */
export function ResidentsList({
  residents,
  leaderId,
  tick,
  selectedId,
  onSelect,
}: {
  residents: Resident[]
  leaderId: string
  tick: number
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  return (
    <section className="residents" aria-label="Residents">
      <div className="panel-head">
        <h2>Residents</h2>
        <span>{residents.length} in sight</span>
      </div>
      <div className="residents-scroll">
        <div className="residents-table">
          <div className="residents-row heading" aria-hidden="true">
            <span>Name</span>
            <span>Age</span>
            <span>Doing</span>
            <span>Hunger</span>
            <span>Carrying</span>
          </div>
          {residents.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`residents-row${r.id === selectedId ? ' selected' : ''}`}
              aria-pressed={r.id === selectedId}
              onClick={() => onSelect(r.id)}
            >
              <span className="name">
                {r.name}
                {r.id === leaderId && <span className="leader-mark"> · Leader</span>}
              </span>
              <span className="mono">{Math.floor(ageInYears(r, tick))}</span>
              <span className="doing">{doing(r)}</span>
              <span className="meter" aria-label={`Hunger ${pct(r.hunger / MAX_HUNGER)} fed`}>
                <span
                  className={meterClass(r.hunger / MAX_HUNGER)}
                  style={{ width: pct(r.hunger / MAX_HUNGER) }}
                />
              </span>
              <span className="mono">{kg(stockWeight(r.carried))}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Everything about one resident (`CONTEXT.md`: Resident, Stats, Skill). */
export function ResidentInspector({
  resident,
  leaderId,
  cityName,
  tick,
  picking,
  onWalkTo,
  orderError,
  pile,
  storage,
  onPickUp,
  onDrop,
  building,
  node,
  onBuild,
  workers,
  holders,
  realmId,
  onWork,
  onTearDown,
  residents,
  onPair,
}: {
  resident: Resident | undefined
  leaderId: string
  cityName: string | undefined
  tick: number
  /** The map is waiting for a tile to walk to. */
  picking: boolean
  /** Starts (or cancels) picking a tile to walk to. */
  onWalkTo: () => void
  /** Why the last order was turned down, if it was. */
  orderError: string | undefined
  /** Goods lying on the resident's tile, if any are in sight. */
  pile: Pile | undefined
  /** The storage on the resident's tile, if there is one: a storage, or a stable's. */
  storage: Building | undefined
  /** Orders the resident to take goods from a spot on their tile. */
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  /** Orders the resident to put carried goods at a spot on their tile. */
  onDrop: (to: GoodsSpot, goods: Stock) => void
  /** The building or construction site on the resident's tile, if one is in sight. */
  building: Building | undefined
  /** The resource node on the resident's tile, if the Player knows of one. */
  node: KnownNode | undefined
  /** Orders the resident to build on their tile, or to join the site there. */
  onBuild: (kind: BuildingKind) => void
  /** Residents in sight working the building on the resident's tile. */
  workers: number
  /** Realms whose residents in sight work it: who holds it (`CONTEXT.md`: Holding a workplace). */
  holders: string[]
  /** The Player's realm. */
  realmId: string
  /** Orders the resident to work the workplace on their tile. */
  onWork: () => void
  /** Orders the resident to tear down the building or site on their tile. */
  onTearDown: (buildingId: string) => void
  /** The Player's residents in sight, to pick a partner from. */
  residents: Resident[]
  /** Orders the resident to pair with another of the Player's residents. */
  onPair: (partnerId: string) => void
}) {
  if (!resident) {
    return (
      <aside className="inspector" aria-label="Resident inspector">
        <p className="muted">Pick a resident on the map or in the list.</p>
      </aside>
    )
  }
  const r = resident
  const age = Math.floor(ageInYears(r, tick))
  const skills = (Object.keys(SKILL_LABELS) as SkillName[]).filter((s) => (r.skills[s] ?? 0) > 0)
  const carried = goodsIn(r.carried)
  const ground: GoodsSpot = { kind: 'ground' }
  const inStorage: GoodsSpot = { kind: 'storage', storageId: storage?.id ?? '' }
  const site = building?.site ? building : undefined
  const atSite: GoodsSpot = { kind: 'site', siteId: site?.id ?? '' }
  const needed = site ? materialsNeeded(site) : {}
  return (
    <aside className="inspector" aria-label="Resident inspector">
      <div className="inspector-title">
        <div className="name-line">
          <h2>{r.name}</h2>
          {r.id === leaderId && <span className="badge">Leader</span>}
        </div>
        <div className="muted">
          {canWork(r, tick) ? 'Adult' : 'Child'} · {age} years{cityName ? ` · ${cityName}` : ''}
        </div>
      </div>

      <div className="vitals">
        <Meter
          label="Health"
          value={`${Math.round(r.health)} / ${MAX_HEALTH}`}
          share={r.health / MAX_HEALTH}
        />
        <Meter
          label="Hunger"
          value={r.hunger / MAX_HUNGER < 0.25 ? 'hungry' : `${pct(r.hunger / MAX_HUNGER)} fed`}
          share={r.hunger / MAX_HUNGER}
        />
      </div>

      <section className="inspector-block" aria-label="Order">
        <div className="panel-head">
          <h3>Order</h3>
        </div>
        <div className="doing-now">{doing(r)}</div>
        <div className="order-buttons">
          <button
            type="button"
            className={picking ? 'primary' : ''}
            onClick={onWalkTo}
            aria-pressed={picking}
          >
            {picking ? 'Pick a tile…' : 'Walk to'}
          </button>
        </div>
        <p className="muted small" role="status">
          {orderError
            ? `Order turned down: ${orderError}`
            : picking
              ? 'Tap a tile on the map, or press Walk to again to cancel.'
              : 'Right-click the map to walk there.'}
        </p>
      </section>

      <section className="inspector-block" aria-label="Stats">
        <div className="panel-head">
          <h3>Stats</h3>
          <span className="small muted">base + trained (cap)</span>
        </div>
        {STAT_NAMES.map((s) => {
          const { base, trained } = r.stats[s]
          const cap = trainedCap(base)
          return (
            <div className="stat" key={s}>
              <span>{STAT_LABELS[s]}</span>
              <span className="stat-bar" aria-hidden="true">
                <span className="base" style={{ width: pct(base / STAT_SCALE) }} />
                <span className="trained" style={{ width: pct(trained / STAT_SCALE) }} />
                <span className="cap" style={{ width: pct((cap - trained) / STAT_SCALE) }} />
              </span>
              <span className="mono right">
                {base} + {trained} ({cap})
              </span>
            </div>
          )
        })}
      </section>

      <section className="inspector-block" aria-label="Skills">
        <h3>Skills</h3>
        <div className="chips">
          {skills.length === 0 && <span className="chip">None yet</span>}
          {skills.map((s) => (
            <span className="chip" key={s}>
              {SKILL_LABELS[s]}{' '}
              <span className="mono accent">{Math.floor(r.skills[s]! * 10) / 10}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="inspector-block" aria-label="Carrying">
        <div className="panel-head">
          <h3>Carrying</h3>
          <span className="mono small">
            {kg(stockWeight(r.carried))} / {kg(carryCapacity(r, tick))}
          </span>
        </div>
        {carried.length === 0 && (
          <p className="muted">
            Nothing. Residents eat only what they carry; at home they take meals from storage.
          </p>
        )}
        {carried.map(([good, units]) => (
          <div className="goods-row" key={good}>
            <span>{GOOD_LABELS[good]}</span>
            <span className="mono">{units}</span>
            <span className="buttons">
              <button type="button" onClick={() => onDrop(ground, { [good]: units })}>
                Drop
              </button>
              {storage && (
                <button type="button" onClick={() => onDrop(inStorage, { [good]: units })}>
                  Store
                </button>
              )}
              {(needed[good] ?? 0) > 0 && (
                <button type="button" onClick={() => onDrop(atSite, { [good]: units })}>
                  Deliver
                </button>
              )}
            </span>
          </div>
        ))}
      </section>

      <BuildBlock resident={r} tick={tick} building={building} node={node} onBuild={onBuild} />
      <WorkBlock
        resident={r}
        tick={tick}
        building={building}
        node={node}
        workers={workers}
        holders={holders}
        realmId={realmId}
        onWork={onWork}
      />
      <TearDownBlock resident={r} tick={tick} building={building} onTearDown={onTearDown} />
      <PairBlock resident={r} tick={tick} residents={residents} onPair={onPair} />

      {(pile || storage || site) && (
        <section className="inspector-block" aria-label="On this tile">
          <div className="panel-head">
            <h3>Here</h3>
            <span className="small muted">takes as much as fits</span>
          </div>
          <TileGoods title="On the ground" stock={pile?.goods} spot={ground} onPickUp={onPickUp} />
          {storage && (
            <TileGoods
              title={storage.kind === 'stable' ? 'In the stable' : 'In the storage'}
              stock={storage.stock}
              spot={inStorage}
              onPickUp={onPickUp}
            />
          )}
          {site && (
            <TileGoods
              title="Delivered to the site"
              stock={site.site!.delivered}
              spot={atSite}
              onPickUp={onPickUp}
            />
          )}
        </section>
      )}
    </aside>
  )
}

/**
 * Building on the resident's tile (`CONTEXT.md`: Building): on a resource node with nothing on it,
 * build its workplace; on any other empty tile, a stable (on Plains only);
 * on a construction site, see what it still needs and help build it.
 */
function BuildBlock({
  resident,
  tick,
  building,
  node,
  onBuild,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  node: KnownNode | undefined
  onBuild: (kind: BuildingKind) => void
}) {
  const adult = canWork(resident, tick)
  const o = resident.order
  if (building?.site) {
    const name = BUILDING_NAMES[building.kind]
    const work = BUILD_WORK[building.kind] ?? 0
    const materials = goodsIn(BUILD_MATERIALS[building.kind])
    const joined = o?.kind === 'build' && o.siteId === building.id
    return (
      <section className="inspector-block" aria-label="Build">
        <div className="panel-head">
          <h3>Construction site</h3>
          <span className="small muted">{name}</span>
        </div>
        <Meter
          label="Work"
          value={pct(work > 0 ? building.site.work / work : 1)}
          share={work > 0 ? building.site.work / work : 1}
        />
        {materials.length === 0 && <p className="muted small">Needs no materials.</p>}
        {materials.map(([good, units]) => (
          <div className="goods-row" key={good}>
            <span>{GOOD_LABELS[good]}</span>
            <span className="mono">
              {building.site!.delivered[good] ?? 0} / {units}
            </span>
            <span />
          </div>
        ))}
        <div className="order-buttons">
          <button type="button" disabled={!adult || joined} onClick={() => onBuild(building.kind)}>
            {joined ? 'Building…' : 'Help build'}
          </button>
        </div>
        <p className="muted small">
          It becomes a {name.toLowerCase()} once its materials are delivered and the work is done.
        </p>
      </section>
    )
  }
  if (!building) {
    // On a node its workplace; anywhere else a stable, which the server allows on Plains only.
    const kind = node ? NODE_WORKPLACE[node.kind] : 'stable'
    const name = BUILDING_NAMES[kind]
    const materials = goodsIn(BUILD_MATERIALS[kind])
    const days = (BUILD_WORK[kind] ?? 0) / TICKS_PER_GAME_DAY
    return (
      <section className="inspector-block" aria-label="Build">
        <div className="panel-head">
          <h3>Build</h3>
          <span className="small muted">
            {node ? `${NODE_NAMES[node.kind]} node` : 'on Plains'}
          </span>
        </div>
        <p className="muted small">
          {!node && 'A stable keeps horses and their Food, and breeds them. '}
          Needs{' '}
          {materials.length === 0
            ? 'no materials'
            : materials.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')}{' '}
          and about {days} game days of one resident’s work.
        </p>
        <div className="order-buttons">
          <button type="button" className="primary" disabled={!adult} onClick={() => onBuild(kind)}>
            Build {name.toLowerCase()}
          </button>
        </div>
      </section>
    )
  }
  return null
}

/**
 * Working the workplace on the resident’s tile (`CONTEXT.md`: Workplace): how
 * many work it, who holds it (`CONTEXT.md`: Holding a workplace), and a button to join them.
 * The output goes into the workers’ hands.
 */
function WorkBlock({
  resident,
  tick,
  building,
  node,
  workers,
  holders,
  realmId,
  onWork,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  node: KnownNode | undefined
  workers: number
  holders: string[]
  realmId: string
  onWork: () => void
}) {
  const max = building && !building.site ? MAX_WORKERS[building.kind] : undefined
  const skill = building && WORKPLACE_SKILL[building.kind]
  const good = building?.kind === 'farm' ? 'food' : node && NODE_GOOD[node.kind]
  if (!building || max === undefined || !skill || !good) return null
  const o = resident.order
  const working = o?.kind === 'workAt' && o.buildingId === building.id
  return (
    <section className="inspector-block" aria-label="Work">
      <div className="panel-head">
        <h3>{BUILDING_NAMES[building.kind]}</h3>
        <span className="mono small">
          {workers} / {max} workers
        </span>
      </div>
      <p className="small">{holding(holders, realmId)}</p>
      <div className="order-buttons">
        <button
          type="button"
          className="primary"
          disabled={!canWork(resident, tick) || working || workers >= max}
          onClick={onWork}
        >
          {working ? 'Working…' : 'Work here'}
        </button>
      </div>
      <p className="muted small">
        A worker of average Strength makes about {WORK_OUTPUT_PER_DAY[good] ?? 0}{' '}
        {GOOD_LABELS[good].toLowerCase()} a game day, more with {SKILL_LABELS[skill]} skill. It goes
        into the workers’ hands as far as they can carry; the rest is left on the ground here.
      </p>
    </section>
  )
}

/**
 * Tearing down the building or construction site on the resident's tile (`CONTEXT.md`: Tearing
 * down): how far it has come, what it leaves on the tile, and a button to start or join.
 */
function TearDownBlock({
  resident,
  tick,
  building,
  onTearDown,
}: {
  resident: Resident
  tick: number
  building: Building | undefined
  onTearDown: (buildingId: string) => void
}) {
  if (!building || !BUILDABLE.includes(building.kind)) return null
  const name = BUILDING_NAMES[building.kind].toLowerCase()
  const what = building.site ? `${name} site` : name
  const work = teardownWork(building)
  const share = work > 0 ? (building.teardown ?? 0) / work : 0
  const leaves = goodsIn(teardownReturns(building))
  const o = resident.order
  const joined = o?.kind === 'tearDown' && o.buildingId === building.id
  return (
    <section className="inspector-block" aria-label="Tear down">
      <div className="panel-head">
        <h3>Tear down</h3>
        <span className="small muted">{what}</span>
      </div>
      {building.teardown !== undefined && (
        <Meter label="Torn down" value={pct(share)} share={share} />
      )}
      <p className="muted small">
        Takes about {Math.ceil((work / TICKS_PER_GAME_DAY) * 10) / 10} game days of one resident’s
        work and leaves{' '}
        {leaves.length === 0
          ? 'nothing'
          : leaves.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')}{' '}
        on the tile.
      </p>
      <div className="order-buttons">
        <button
          type="button"
          disabled={!canWork(resident, tick) || joined}
          onClick={() => onTearDown(building.id)}
        >
          {joined ? 'Tearing down…' : `Tear down ${what}`}
        </button>
      </div>
    </section>
  )
}

/**
 * Pairing (`CONTEXT.md`: Pairing): pick another adult of the resident's city to pair with, or see
 * whom they are paired with and when their next child can come.
 */
function PairBlock({
  resident,
  tick,
  residents,
  onPair,
}: {
  resident: Resident
  tick: number
  residents: Resident[]
  onPair: (partnerId: string) => void
}) {
  const [partnerId, setPartnerId] = useState('')
  if (!canWork(resident, tick) || resident.cityId === null) return null
  const o = resident.order
  const partner = o?.kind === 'pair' ? residents.find((x) => x.id === o.partnerId) : undefined
  const choices = residents.filter(
    (x) => x.id !== resident.id && x.cityId === resident.cityId && canWork(x, tick),
  )
  const days =
    o?.kind === 'pair'
      ? Math.max(0, Math.ceil((o.since + TICKS_PER_GAME_YEAR - tick) / TICKS_PER_GAME_DAY))
      : 0
  return (
    <section className="inspector-block" aria-label="Pairing">
      <div className="panel-head">
        <h3>Pairing</h3>
        <span className="small muted">one child a year at most</span>
      </div>
      {o?.kind === 'pair' && (
        <p className="muted small">
          Paired with {partner?.name ?? 'someone out of sight'}.{' '}
          {days > 0 ? `A child can come in about ${days} game days` : 'A child can come now'}, once
          the city has free housing and a food surplus.
        </p>
      )}
      <div className="order-buttons">
        <select
          aria-label="Partner"
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
        >
          <option value="">Pick a partner…</option>
          {choices.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!partnerId} onClick={() => onPair(partnerId)}>
          Pair
        </button>
      </div>
    </section>
  )
}

/** Goods at one spot on the resident's tile, each with a button to pick it up. */
function TileGoods({
  title,
  stock,
  spot,
  onPickUp,
}: {
  title: string
  stock: Stock | undefined
  spot: GoodsSpot
  onPickUp: (from: GoodsSpot, goods: Stock) => void
}) {
  const goods = goodsIn(stock)
  return (
    <>
      <div className="small muted">{title}</div>
      {goods.length === 0 && <p className="muted small">Nothing.</p>}
      {goods.map(([good, units]) => (
        <div className="goods-row" key={good}>
          <span>{GOOD_LABELS[good]}</span>
          <span className="mono">{units}</span>
          <span className="buttons">
            <button type="button" onClick={() => onPickUp(spot, { [good]: units })}>
              Pick up
            </button>
          </span>
        </div>
      ))}
    </>
  )
}

function Meter({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="vital">
      <div className="vital-head">
        <span className="muted">{label}</span>
        <span className="mono">{value}</span>
      </div>
      <span className="meter big">
        <span className={meterClass(share)} style={{ width: pct(share) }} />
      </span>
    </div>
  )
}

/** Who holds a workplace, in the Player's words (`CONTEXT.md`: Holding a workplace). */
function holding(holders: string[], realmId: string): string {
  const others = holders.filter((h) => h !== realmId).length
  if (holders.length === 0) return 'Nobody holds it: whoever works it gets its output.'
  if (others === 0) return 'Held by your realm.'
  if (others === holders.length) return 'Held by another realm: its workers get the output.'
  return 'Held by your realm and another: their workers share the output.'
}
