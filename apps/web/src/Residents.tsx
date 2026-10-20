import {
  BUILD_MATERIALS,
  ROAD_LINE_MAX_TILES,
  BUILD_WORK,
  BUILDABLE,
  BATCHES_PER_DAY,
  CARRIAGE_CAPACITY,
  GOODS,
  HAUL_KEEP_FOOD,
  NODE_WORKPLACE,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  NODE_GOOD,
  PROCESSING,
  RECIPES,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_SKILL,
  STAT_NAMES,
  STAT_BASE_MAX,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  TRAINED_CAP_SHARE,
  ageInYears,
  bestWeapon,
  canWork,
  wrapDistance,
  carryCapacity,
  materialsNeeded,
  recipeGood,
  teardownReturns,
  teardownWork,
  stockWeight,
  trainedCap,
  type Building,
  type Carriage,
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
  spear: 'Spear',
  sword: 'Sword',
  shield: 'Shield',
  armour: 'Armour',
}

/** What a building off any node is for, shown before what it needs. */
const BUILD_BLURBS: Partial<Record<BuildingKind, string>> = {
  road: 'A road: residents walk and carriages drive faster on it, on any land but Mountain, and it can run through a gate. Nobody owns it. ',
  stable: 'A stable keeps horses and their Food, and breeds them; on Plains only. ',
  smelter: 'A smelter turns iron ore into iron; not on Mountain. ',
  mint: 'A mint turns gold ore into coins; not on Mountain. ',
  smithy: 'A smithy turns iron and wood into spears, swords, shields and armour; not on Mountain. ',
  townHall: 'A town hall founds a new city of your realm; tearing it down dissolves the city. ',
  wall: 'A stretch of wall; walls grow the city they stand by, like houses. ',
  gate: 'A gate in a wall; it grows the city like a wall does. ',
}

/** A weight in kg, to one decimal (coins weigh little). */
const kg = (weight: number) => `${Math.round(weight * 10) / 10} kg`

/** The goods in a stock that are there, in the usual order. */
const goodsIn = (stock: Stock | undefined) =>
  GOODS.filter((g) => (stock?.[g] ?? 0) > 0).map((g) => [g, stock![g]!] as const)

/** Some goods in words, each times `times`: "4 iron ore". */
const stockText = (stock: Stock, times = 1) =>
  goodsIn(stock)
    .map(([g, n]) => `${n * times} ${GOOD_LABELS[g].toLowerCase()}`)
    .join(', ')

const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  endurance: 'Endurance',
  agility: 'Agility',
  intellect: 'Intellect',
}

const SKILL_LABELS: Record<SkillName, string> = {
  mining: 'Mining',
  woodcutting: 'Woodcutting',
  smelting: 'Smelting',
  smithing: 'Smithing',
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

/**
 * What the map is waiting for a tile for: to walk or drive there, a haul route's other stop, or
 * the far end of a road along a line.
 */
export type Picking = false | 'walk' | 'drive' | 'haul' | 'road'

/** What a haul route carries, picked before its other stop (`CONTEXT.md`: Haul route). */
export interface HaulSetup {
  goods: Good[]
  returnGoods: Good[]
  keepFood: number
}

/** What a resident is doing, from their order. */
function doing(r: Resident): string {
  const o = r.order
  if (o?.kind === 'walkTo') {
    if (!o.path) return `Finding a way to ${o.target.x}, ${o.target.y}`
    return `Walking to ${o.target.x}, ${o.target.y} · ${o.path.length} tiles to go`
  }
  if (o?.kind === 'drive') {
    if (!o.path) return `Finding a way for the carriage to ${o.target.x}, ${o.target.y}`
    return `Driving to ${o.target.x}, ${o.target.y} · ${o.path.length} tiles to go`
  }
  if (o?.kind === 'haul') {
    const what = o.goods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const { x, y } = o[o.stop]
    if (o.phase === 'loading') {
      return o.stop === 'from' ? `Loading ${what} at ${x}, ${y}` : `Unloading ${what} at ${x}, ${y}`
    }
    const back = o.returnGoods.map((g) => GOOD_LABELS[g].toLowerCase()).join(', ')
    const leg =
      o.stop === 'to' ? `Hauling ${what} to` : back ? `Hauling ${back} back to` : 'Driving back to'
    return o.path ? `${leg} ${x}, ${y} · ${o.path.length} tiles to go` : `${leg} ${x}, ${y}`
  }
  if (o?.kind === 'pickUp') return 'Picking up goods'
  if (o?.kind === 'drop') return 'Putting down goods'
  if (o?.kind === 'tearDown') return 'Tearing down'
  if (o?.kind === 'build') {
    const what = BUILDING_NAMES[o.building].toLowerCase()
    return o.siteId === null ? `Laying out a ${what}` : `Building a ${what}`
  }
  if (o?.kind === 'workAt')
    return o.makes ? `Making ${GOOD_LABELS[o.makes].toLowerCase()}` : 'Working'
  if (o?.kind === 'pair') return 'Paired'
  if (o?.kind === 'attack') return o.path ? 'Going after their target' : 'Fighting'
  if (o?.kind === 'roadLine') {
    const [x, y] = o.tiles[0]!
    const left = `${o.tiles.length} road tile${o.tiles.length === 1 ? '' : 's'} to go`
    return o.phase === 'walking'
      ? `Walking to lay road at ${x}, ${y} · ${left}`
      : `Building road at ${x}, ${y} · ${left}`
  }
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
  road,
  node,
  onBuild,
  workers,
  holders,
  realmId,
  onWork,
  onTearDown,
  residents,
  onPair,
  others,
  mapSize,
  onAttack,
  carriage,
  onDriveTo,
  onHaulTo,
  onRoadTo,
  onStop,
}: {
  resident: Resident | undefined
  leaderId: string
  cityName: string | undefined
  tick: number
  /** The map is waiting for a tile to walk or drive to, or for a haul route's other stop. */
  picking: Picking
  /** Starts (or cancels) picking a tile to walk to. */
  onWalkTo: () => void
  /** A carriage on the resident's tile, if one is in sight. */
  carriage: Carriage | undefined
  /** Starts (or cancels) picking a tile to drive the carriage to. */
  onDriveTo: () => void
  /** Starts (or cancels) picking the other stop of a haul route carrying these goods. */
  onHaulTo: (setup: HaulSetup) => void
  /** Starts (or cancels) picking the far end of a road to build along a line from here. */
  onRoadTo: () => void
  /** Orders the resident to stop what they are doing. */
  onStop: () => void
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
  /** The road or road site on the resident's tile, if one is in sight; it may share the tile. */
  road: Building | undefined
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
  /** Orders the resident to work the workplace on their tile, making `makes` at a smithy. */
  onWork: (makes?: Good) => void
  /** Orders the resident to tear down the building or site on their tile. */
  onTearDown: (buildingId: string) => void
  /** The Player's residents in sight, to pick a partner from. */
  residents: Resident[]
  /** Orders the resident to pair with another of the Player's residents. */
  onPair: (partnerId: string) => void
  /** Residents of other realms, or of none, in sight: whom the resident can attack. */
  others: Resident[]
  /** Tiles along each side of the map, to tell who is nearest. */
  mapSize: number
  /** Orders the resident to attack another realm's resident. */
  onAttack: (targetId: string) => void
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
  // Children can't pick up or put down goods (`CONTEXT.md`: Child).
  const child = !canWork(r, tick)
  const ground: GoodsSpot = { kind: 'ground' }
  const inStorage: GoodsSpot = { kind: 'storage', storageId: storage?.id ?? '' }
  const site = building?.site ? building : undefined
  const atSite: GoodsSpot = { kind: 'site', siteId: site?.id ?? '' }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage?.id ?? '' }
  const needed = site ? materialsNeeded(site) : {}
  const roadSite = road?.site ? road : undefined
  const atRoadSite: GoodsSpot = { kind: 'site', siteId: roadSite?.id ?? '' }
  const roadNeeded = roadSite ? materialsNeeded(roadSite) : {}
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
            className={picking === 'walk' ? 'primary' : ''}
            onClick={onWalkTo}
            aria-pressed={picking === 'walk'}
          >
            {picking === 'walk' ? 'Pick a tile…' : 'Walk to'}
          </button>
          {carriage && (
            <button
              type="button"
              className={picking === 'drive' ? 'primary' : ''}
              onClick={onDriveTo}
              aria-pressed={picking === 'drive'}
              disabled={!canWork(r, tick)}
            >
              {picking === 'drive' ? 'Pick a tile…' : 'Drive carriage to'}
            </button>
          )}
          {r.order && (
            <button type="button" onClick={onStop}>
              Stop
            </button>
          )}
        </div>
        <p className="muted small" role="status">
          {orderError
            ? `Order turned down: ${orderError}`
            : picking
              ? `Tap a tile on the map, or press ${PICKING_BUTTONS[picking]} again to cancel.`
              : 'Right-click the map to walk there.'}
        </p>
      </section>

      {carriage && (
        <HaulBlock resident={r} tick={tick} picking={picking === 'haul'} onHaulTo={onHaulTo} />
      )}

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
              <button
                type="button"
                disabled={child}
                onClick={() => onDrop(ground, { [good]: units })}
              >
                Drop
              </button>
              {storage && (
                <button
                  type="button"
                  disabled={child}
                  onClick={() => onDrop(inStorage, { [good]: units })}
                >
                  Store
                </button>
              )}
              {(needed[good] ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={child}
                  onClick={() => onDrop(atSite, { [good]: units })}
                >
                  Deliver
                </button>
              )}
              {(roadNeeded[good] ?? 0) > 0 && (
                <button
                  type="button"
                  disabled={child}
                  onClick={() => onDrop(atRoadSite, { [good]: units })}
                >
                  Deliver to road
                </button>
              )}
              {carriage && (
                <button
                  type="button"
                  disabled={child}
                  onClick={() => onDrop(onCarriage, { [good]: units })}
                >
                  Load
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
      <RoadBlock resident={r} tick={tick} road={road} onBuild={onBuild} />
      <RoadLineBlock resident={r} tick={tick} picking={picking === 'road'} onRoadTo={onRoadTo} />
      <TearDownBlock resident={r} tick={tick} building={road} onTearDown={onTearDown} />
      <PairBlock resident={r} tick={tick} residents={residents} onPair={onPair} />
      <AttackBlock resident={r} others={others} mapSize={mapSize} onAttack={onAttack} />

      {(pile || storage || site || roadSite || carriage) && (
        <section className="inspector-block" aria-label="On this tile">
          <div className="panel-head">
            <h3>Here</h3>
            <span className="small muted">takes as much as fits</span>
          </div>
          <TileGoods
            title="On the ground"
            stock={pile?.goods}
            spot={ground}
            onPickUp={onPickUp}
            disabled={child}
          />
          {storage && (
            <TileGoods
              title={storage.kind === 'stable' ? 'In the stable' : 'In the storage'}
              stock={storage.stock}
              spot={inStorage}
              onPickUp={onPickUp}
              disabled={child}
            />
          )}
          {site && (
            <TileGoods
              title="Delivered to the site"
              stock={site.site!.delivered}
              spot={atSite}
              onPickUp={onPickUp}
              disabled={child}
            />
          )}
          {roadSite && (
            <TileGoods
              title="Delivered to the road site"
              stock={roadSite.site!.delivered}
              spot={atRoadSite}
              onPickUp={onPickUp}
              disabled={child}
            />
          )}
          {carriage && (
            <TileGoods
              title={`On the carriage · ${kg(stockWeight(carriage.load))} / ${kg(CARRIAGE_CAPACITY)}${carriage.horseId ? '' : ' · no horse hitched'}`}
              stock={carriage.load}
              spot={onCarriage}
              onPickUp={onPickUp}
              disabled={child}
            />
          )}
        </section>
      )}
    </aside>
  )
}

/** The button that started picking a tile, to name in the hint for cancelling. */
const PICKING_BUTTONS: Record<Exclude<Picking, false>, string> = {
  walk: 'Walk to',
  drive: 'Drive carriage to',
  haul: 'Pick the other stop',
  road: 'Build road to',
}

/**
 * Setting up a haul route with the carriage on the resident's tile (`CONTEXT.md`: Haul route):
 * which goods go from here to the other stop, which come back, and how much Food stays on board
 * for the horse, then the other stop on the map.
 */
function HaulBlock({
  resident,
  tick,
  picking,
  onHaulTo,
}: {
  resident: Resident
  tick: number
  /** The map is waiting for the route's other stop. */
  picking: boolean
  onHaulTo: (setup: HaulSetup) => void
}) {
  const [goods, setGoods] = useState<Good[]>([])
  const [returnGoods, setReturnGoods] = useState<Good[]>([])
  const [keepFood, setKeepFood] = useState(HAUL_KEEP_FOOD)
  // A good goes one way or the other, never both.
  const toggle = (g: Good, back: boolean) => {
    const [set, other] = back ? [setReturnGoods, setGoods] : [setGoods, setReturnGoods]
    set((now) => (now.includes(g) ? now.filter((x) => x !== g) : [...now, g]))
    other((now) => now.filter((x) => x !== g))
  }
  const o = resident.order
  return (
    <section className="inspector-block" aria-label="Haul route">
      <div className="panel-head">
        <h3>Haul route</h3>
        {o?.kind === 'haul' && <span className="small muted">on a route</span>}
      </div>
      {([false, true] as const).map((back) => (
        <div key={String(back)}>
          <span className="small muted">{back ? 'Back from there' : 'To the other stop'}</span>
          <div className="chips">
            {GOODS.map((g) => (
              <label className="chip" key={g}>
                <input
                  type="checkbox"
                  checked={(back ? returnGoods : goods).includes(g)}
                  onChange={() => toggle(g, back)}
                />{' '}
                {GOOD_LABELS[g]}
              </label>
            ))}
          </div>
        </div>
      ))}
      <label className="small">
        Food kept for the horse{' '}
        <input
          type="number"
          min={0}
          step={1}
          value={keepFood}
          onChange={(e) => setKeepFood(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          style={{ width: '4em' }}
        />
      </label>
      <div className="order-buttons">
        <button
          type="button"
          className={picking ? 'primary' : ''}
          aria-pressed={picking}
          disabled={!canWork(resident, tick) || goods.length === 0}
          onClick={() => onHaulTo({ goods, returnGoods, keepFood })}
        >
          {picking ? 'Pick a tile…' : PICKING_BUTTONS.haul}
        </button>
      </div>
      <p className="muted small">
        The driver loads the picked goods here, drives them to the other stop and unloads them,
        brings the goods picked to come back, again and again until stopped. A stop with a storage
        loads and unloads there, else on the ground. The horse eats from the carriage’s load; its
        Food is topped up wherever there is some.
      </p>
    </section>
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
    // On a node its workplace; anywhere else a stable (the server allows it on Plains only), a
    // smelter, a mint or a smithy (not on Mountain).
    const kinds: BuildingKind[] = node ? [NODE_WORKPLACE[node.kind]] : ['stable', ...PROCESSING]
    return (
      <section className="inspector-block" aria-label="Build">
        <div className="panel-head">
          <h3>Build</h3>
          <span className="small muted">
            {node ? `${NODE_NAMES[node.kind]} node` : 'off any node'}
          </span>
        </div>
        {kinds.map((kind) => {
          const materials = goodsIn(BUILD_MATERIALS[kind])
          const days = (BUILD_WORK[kind] ?? 0) / TICKS_PER_GAME_DAY
          return (
            <div key={kind}>
              <p className="muted small">
                {BUILD_BLURBS[kind]}
                Needs{' '}
                {materials.length === 0
                  ? 'no materials'
                  : materials
                      .map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`)
                      .join(', ')}{' '}
                and about {days} game days of one resident’s work.
              </p>
              <div className="order-buttons">
                <button
                  type="button"
                  className="primary"
                  disabled={!adult}
                  onClick={() => onBuild(kind)}
                >
                  Build {BUILDING_NAMES[kind].toLowerCase()}
                </button>
              </div>
            </div>
          )
        })}
      </section>
    )
  }
  return null
}

/**
 * A road on the resident's tile (`CONTEXT.md`: Road): with none, lay one out, next to any
 * building there; on a road site, see what it still needs and help build it.
 */
function RoadBlock({
  resident,
  tick,
  road,
  onBuild,
}: {
  resident: Resident
  tick: number
  road: Building | undefined
  onBuild: (kind: BuildingKind) => void
}) {
  if (road?.site) {
    return (
      <BuildBlock
        resident={resident}
        tick={tick}
        building={road}
        node={undefined}
        onBuild={onBuild}
      />
    )
  }
  if (road) return null
  const materials = goodsIn(BUILD_MATERIALS.road)
  const days = (BUILD_WORK.road ?? 0) / TICKS_PER_GAME_DAY
  return (
    <section className="inspector-block" aria-label="Road">
      <div className="panel-head">
        <h3>Road</h3>
      </div>
      <p className="muted small">
        {BUILD_BLURBS.road}
        Needs {materials.map(([g, n]) => `${n} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')} and
        about {days} game days of one resident’s work.
      </p>
      <div className="order-buttons">
        <button type="button" disabled={!canWork(resident, tick)} onClick={() => onBuild('road')}>
          Build road
        </button>
      </div>
    </section>
  )
}

/**
 * A road along a line (`CONTEXT.md`: Road): the resident builds a road on each tile of the
 * straight line from their tile to one picked on the map, one tile after another, putting in the
 * stone they carry. Tiles that have a road already are skipped.
 */
function RoadLineBlock({
  resident,
  tick,
  picking,
  onRoadTo,
}: {
  resident: Resident
  tick: number
  /** The map is waiting for the line's far end. */
  picking: boolean
  onRoadTo: () => void
}) {
  const stone = BUILD_MATERIALS.road?.stone ?? 0
  const carried = resident.carried.stone ?? 0
  const tiles = stone > 0 ? Math.floor(carried / stone) : ROAD_LINE_MAX_TILES
  return (
    <section className="inspector-block" aria-label="Road along a line">
      <div className="panel-head">
        <h3>Road along a line</h3>
      </div>
      <p className="muted small">
        Builds road from here to a tile you pick, at most {ROAD_LINE_MAX_TILES} tiles, one after
        another. The stone carried covers {tiles} tile{tiles === 1 ? '' : 's'}; without more, the
        resident waits on the next site until someone delivers it.
      </p>
      <div className="order-buttons">
        <button
          type="button"
          className={picking ? 'primary' : ''}
          onClick={onRoadTo}
          aria-pressed={picking}
          disabled={!canWork(resident, tick)}
        >
          {picking ? 'Pick a tile…' : PICKING_BUTTONS.road}
        </button>
      </div>
    </section>
  )
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
  onWork: (makes?: Good) => void
}) {
  const max = building && !building.site ? MAX_WORKERS[building.kind] : undefined
  const skill = building && WORKPLACE_SKILL[building.kind]
  const recipes = (building && RECIPES[building.kind]) ?? []
  const recipe = recipes.length === 1 ? recipes[0] : undefined
  const good = building?.kind === 'farm' ? 'food' : node && NODE_GOOD[node.kind]
  if (!building || max === undefined || !skill || (!good && recipes.length === 0)) return null
  const batches = BATCHES_PER_DAY[building.kind] ?? 0
  const o = resident.order
  const working = o?.kind === 'workAt' && o.buildingId === building.id
  const blocked = !canWork(resident, tick) || (!working && workers >= max)
  return (
    <section className="inspector-block" aria-label="Work">
      <div className="panel-head">
        <h3>{BUILDING_NAMES[building.kind]}</h3>
        <span className="mono small">
          {workers} / {max} workers
        </span>
      </div>
      <p className="small">{holding(holders, realmId)}</p>
      {recipes.length > 1 ? (
        // A smithy: each worker says what they make (`CONTEXT.md`: Smithy).
        recipes.map((r) => {
          const made = recipeGood(r)
          const making = working && o.makes === made
          return (
            <div key={made} className="goods-row">
              <span>{GOOD_LABELS[made]}</span>
              <span className="muted small">{stockText(r.input)}</span>
              <button type="button" disabled={blocked || making} onClick={() => onWork(made)}>
                {making ? 'Making…' : working ? 'Make instead' : 'Make'}
              </button>
            </div>
          )
        })
      ) : (
        <div className="order-buttons">
          <button
            type="button"
            className="primary"
            disabled={blocked || working}
            onClick={() => onWork()}
          >
            {working ? 'Working…' : 'Work here'}
          </button>
        </div>
      )}
      <p className="muted small">
        {recipes.length > 1 ? (
          <>
            A worker of average Strength makes about {batches} of them a game day, more with{' '}
            {SKILL_LABELS[skill]} skill. They use what the workers carry, then what lies on the
            ground here; without it they stand idle. The output goes
          </>
        ) : recipe ? (
          <>
            A worker of average Strength turns about {stockText(recipe.input, batches)} into{' '}
            {stockText(recipe.output, batches)} a game day, more with {SKILL_LABELS[skill]} skill.
            It uses what the workers carry, then what lies on the ground here; without it they stand
            idle. The output goes
          </>
        ) : (
          <>
            A worker of average Strength makes about {WORK_OUTPUT_PER_DAY[good!] ?? 0}{' '}
            {GOOD_LABELS[good!].toLowerCase()} a game day, more with {SKILL_LABELS[skill]} skill. It
            goes
          </>
        )}{' '}
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

/** Most residents of other realms the attack list offers, nearest first. */
const ATTACK_CHOICES = 12

/**
 * Attacking (`CONTEXT.md`: Combat): pick a resident of another realm in sight, nearest first, to
 * go after and strike; see whom the resident is fighting.
 */
function AttackBlock({
  resident,
  others,
  mapSize,
  onAttack,
}: {
  resident: Resident
  others: Resident[]
  mapSize: number
  onAttack: (targetId: string) => void
}) {
  const [targetId, setTargetId] = useState('')
  const o = resident.order
  const target = o?.kind === 'attack' ? others.find((x) => x.id === o.targetId) : undefined
  const weapon = bestWeapon(resident)
  const choices = others
    .map((x) => ({ x, d: wrapDistance(mapSize, resident, x) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, ATTACK_CHOICES)
  return (
    <section className="inspector-block" aria-label="Attack">
      <div className="panel-head">
        <h3>Attack</h3>
        <span className="small muted">
          {weapon ? `fights with a ${GOOD_LABELS[weapon].toLowerCase()}` : 'unarmed'}
        </span>
      </div>
      {o?.kind === 'attack' && (
        <p className="muted small">Attacking {target?.name ?? 'someone out of sight'}.</p>
      )}
      {choices.length === 0 ? (
        <p className="muted small">Nobody of another realm in sight.</p>
      ) : (
        <div className="order-buttons">
          <select
            aria-label="Target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Pick someone to attack…</option>
            {choices.map(({ x, d }) => (
              <option key={x.id} value={x.id}>
                {x.name} · {Math.round(d)} tiles{bestWeapon(x) ? ' · armed' : ''}
              </option>
            ))}
          </select>
          <button type="button" disabled={!targetId} onClick={() => onAttack(targetId)}>
            Attack
          </button>
        </div>
      )}
    </section>
  )
}

/** Goods at one spot on the resident's tile, each with a button to pick it up. */
function TileGoods({
  title,
  stock,
  spot,
  onPickUp,
  disabled,
}: {
  title: string
  stock: Stock | undefined
  spot: GoodsSpot
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  disabled: boolean
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPickUp(spot, { [good]: units })}
            >
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
