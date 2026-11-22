import { useState } from 'react'
import type { Building, SeenHorse } from '@csp/shared-types'
import { ActionRows } from './SelectionCard.js'
import { CustomiseButton, taskStart } from './Customise.js'
import { GroupBreed, SubjectPicker } from './Residents.js'
import { GROUP_KEYS } from './group-orders.js'
import {
  buildingOrder,
  type BuildingGroupOrder,
  type BuildingOrderId,
  type BuildingOrderRow,
} from './building-orders.js'
import type { CardAction } from './selection-view.js'

/** Each row's key, as the group card's same order has it. */
const KEYS: Record<BuildingOrderId, string> = {
  work: GROUP_KEYS.work,
  buildSite: GROUP_KEYS.build,
  tearDown: GROUP_KEYS.tearDown,
  feedStable: GROUP_KEYS.feedStable,
  breed: GROUP_KEYS.breed,
  teach: GROUP_KEYS.teach,
  train: GROUP_KEYS.train,
}

/** The rows that open a panel with what the order needs: the pair to breed, the subject. */
const PANELS: readonly BuildingOrderId[] = ['breed', 'teach']

/** The task each row starts, for its Customise button (`CONTEXT.md`: Before it starts). */
const TASKS: Partial<Record<BuildingOrderId, string>> = {
  work: 'work',
  buildSite: 'build',
  tearDown: 'tearDown',
  feedStable: 'feedStable',
  train: 'train',
}

/**
 * The realm orders on a picked building's card in realm control mode (`CONTEXT.md`: Realm
 * order): Work here, Build this site, Tear down, Feed the stable, Breed horses, Teach, Train,
 * those that apply to it (`buildingOrderRows`), each greyed with why while it can't be given.
 * Each goes on to the who-list (`onOrder`), with Customise's form first where it has one.
 */
export function BuildingOrders({
  building,
  name,
  rows,
  horses,
  tick,
  onOrder,
}: {
  building: Building
  /** The building's name as the group card says it: "farm". */
  name: string
  rows: readonly BuildingOrderRow[]
  /** The realm's horses in it, to pick two to breed. */
  horses: SeenHorse[]
  tick: number
  onOrder: (order: BuildingGroupOrder) => void
}) {
  const [open, setOpen] = useState<BuildingOrderId>()
  const actions: CardAction<BuildingOrderId>[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    key: KEYS[r.id],
    ...(PANELS.includes(r.id) ? { opens: true as const } : {}),
    ...(r.reason ? { disabled: true as const, reason: r.reason } : {}),
  }))
  const give = (id: BuildingOrderId, more?: Parameters<typeof buildingOrder>[3]) => {
    const order = buildingOrder(id, building, name, more)
    if (order) onOrder(order)
  }
  const act = (a: CardAction<BuildingOrderId>) => {
    if (a.opens) return setOpen(open === a.id ? undefined : a.id)
    give(a.id)
  }
  const panel =
    open === 'teach' ? (
      <section className="inspector-block" aria-label="Teach">
        <SubjectPicker action="Teach" onPick={(subject) => give('teach', { subject })} />
        <p className="muted small">One teacher per ground: the first of those ticked teaches.</p>
      </section>
    ) : open === 'breed' ? (
      <section className="inspector-block" aria-label="Breed horses">
        <GroupBreed
          stable={building}
          horses={horses}
          tick={tick}
          onBreed={(horseIds) => give('breed', { horseIds })}
        />
      </section>
    ) : undefined
  if (actions.length === 0) return null
  return (
    <section className="inspector-block realm-orders" aria-label="Realm orders">
      <div className="panel-head">
        <h3>Orders</h3>
        <span className="small muted">then who does it</span>
      </div>
      <ActionRows
        actions={actions}
        open={open}
        onAction={act}
        label="Realm orders"
        // Two to a row, as the command bar's orders (artboard Card-New-Orders).
        grid={{ wide: true }}
        panel={panel}
        beside={(a) => {
          const task = TASKS[a.id]
          return (
            task && (
              <CustomiseButton
                order={taskStart(task, a.id === 'work' ? building.id : undefined)}
                of={a.label}
                disabled={a.disabled}
                give={() => give(a.id)}
                small
              />
            )
          )
        }}
      />
    </section>
  )
}
