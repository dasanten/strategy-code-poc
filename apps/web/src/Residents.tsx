import {
  GOODS,
  MAX_HEALTH,
  MAX_HUNGER,
  STAT_NAMES,
  STAT_BASE_MAX,
  TRAINED_CAP_SHARE,
  ageInYears,
  canWork,
  carryCapacity,
  stockWeight,
  trainedCap,
  type Building,
  type Good,
  type GoodsSpot,
  type Pile,
  type Resident,
  type SkillName,
  type StatName,
  type Stock,
} from '@csp/shared'

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
  construction: 'Construction',
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
  /** The storage on the resident's tile, if there is one. */
  storage: Building | undefined
  /** Orders the resident to take goods from a spot on their tile. */
  onPickUp: (from: GoodsSpot, goods: Stock) => void
  /** Orders the resident to put carried goods at a spot on their tile. */
  onDrop: (to: GoodsSpot, goods: Stock) => void
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
              {SKILL_LABELS[s]} <span className="mono accent">{r.skills[s]}</span>
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
            Nothing.{cityName ? ` Eats from ${cityName} storage while at home.` : ''}
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
            </span>
          </div>
        ))}
      </section>

      {(pile || storage) && (
        <section className="inspector-block" aria-label="On this tile">
          <div className="panel-head">
            <h3>Here</h3>
            <span className="small muted">takes as much as fits</span>
          </div>
          <TileGoods title="On the ground" stock={pile?.goods} spot={ground} onPickUp={onPickUp} />
          {storage && (
            <TileGoods
              title="In the storage"
              stock={storage.stock}
              spot={inStorage}
              onPickUp={onPickUp}
            />
          )}
        </section>
      )}
    </aside>
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
