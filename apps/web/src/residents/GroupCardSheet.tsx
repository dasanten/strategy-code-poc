import type { Account, Resident } from '@csp/shared-types'
import { showsCreativeBar } from '../creative/creative-bar.js'
import { CreativeGroupMove } from '../creative/CreativeResidents.js'
import { useShiftHeld } from '../queue/queue-view.js'
import { InsertPointContext } from '../queue/step-palette-view.js'
import { GroupPlanner } from '../queue/GroupPlanner.js'
import { nextPick } from '../queue/plan-step.js'
import { GroupCard } from './Residents.js'
import { CardSheet } from '../screen/SelectionCard.js'
import { barBesideTile } from '../screen/dock-view.js'
import { groupRelocateActionProblem, groupRelocateChoices } from './relocate-view.js'

import { type GroupOrders } from './useGroupOrders.js'
import {
  type GameSeen,
  type Sheet,
  type Picker,
  type Ground,
  type StartForm,
  type Planning,
} from '../screen/game-wiring.js'

interface GroupCardSheetProps {
  seen: GameSeen
  account: Account
  /** The residents picked together (`CONTEXT.md`: Group). */
  group: Resident[]
  selectedIds: string[]
  /** Picks residents: one shows their card, several a group card (`Game`). */
  select: (ids: string[]) => void
  /** The command bar beside an open tile card (`barBesideTile`). */
  besideTile: ReturnType<typeof barBesideTile>
  sheet: Sheet
  picker: Picker
  arrivesIn: Ground['arrivesIn']
  groupOrders: GroupOrders
  planning: Planning
  /** Set to show a task's form even with nothing to fill in (`useStartForm`). */
  customising: StartForm['customising']
  /** Shift held: the order goes in each one's queue (`useShiftHeld`). */
  shift: ReturnType<typeof useShiftHeld>
}

/** The group card in the command bar (`CONTEXT.md`: Group), with its orders and planner. */
export function GroupCardSheet(props: GroupCardSheetProps) {
  const { world, scripts, knownCities, knownBuildings, phone } = props.seen
  const { account, group, selectedIds, select, besideTile, picker, arrivesIn } = props
  const { customising, shift } = props
  const { hidden: hideCard } = props.sheet
  const { groupSeen, groupCarriages, groupBoats, groupBuildTile, sendGroup, groupError } =
    props.groupOrders
  const { insertFor, groupPlan, setGroupPlan, giveGroupPlan, addStep } = props.planning
  const pick = picker.target
  const plan = picker.plan.plan
  // A step picking a city keeps the card open: it lists the realm's cities to pick from too.
  const picksCity = plan !== undefined && nextPick(plan)?.pick === 'city'
  /** The cities to relocate them all to, or why not (`CONTEXT.md`: Group, Relocate). */
  function relocateForGroup(rs: Resident[]) {
    const seen = { cities: knownCities, buildings: knownBuildings, residents: world.residents }
    const choices = groupRelocateChoices(seen, world.home.realmId, rs)
    return { choices, problem: groupRelocateActionProblem(rs, choices) }
  }
  return (
    <CardSheet
      phone={phone}
      pinnedPeek={pick?.kind === 'group' || pick?.kind === 'plan'}
      bar
      keysOff={!besideTile.keys}
      hidden={hideCard}
    >
      <GroupCard
        // Another group picked starts a card sorted afresh (ADR 0019).
        key={selectedIds.join()}
        residents={group}
        seen={groupSeen}
        mapSize={world.map.size}
        creative={
          showsCreativeBar(account) && (
            <CreativeGroupMove
              move={{
                picking: picker.group.mode === 'creativeMove',
                onPick: picker.group.toggleCreativeMove,
              }}
            />
          )
        }
        relocate={relocateForGroup(group)}
        cities={knownCities}
        scripts={scripts}
        buildings={world.buildings}
        carriages={groupCarriages}
        boats={groupBoats}
        inSight={world.residents}
        arrivesIn={arrivesIn || undefined}
        horses={world.horses}
        realmId={world.home.realmId}
        tick={world.tick}
        picking={picker.group.mode}
        onPicking={picker.group.start}
        buildAt={groupBuildTile(world, picker.group.buildAt)}
        // Picking a defence or Alarm script is never queued: it leaves what they do as it is.
        // Gather shows its form first, for the good (`CONTEXT.md`: Gather).
        onOrder={(order) => {
          if (order.kind === 'gather') customising.current = true
          void sendGroup(
            order,
            order.kind !== 'setDefenceScript' && order.kind !== 'setAlarmScript' && shift.current,
          )
        }}
        orderError={groupError}
        onPick={(id) => select([id])}
        onClose={() => select([])}
        planner={
          <InsertPointContext.Provider value={insertFor('group')}>
            <GroupPlanner
              plan={groupPlan}
              onPlan={setGroupPlan}
              onGive={() => void giveGroupPlan()}
              addStep={addStep(world)}
              scripts={scripts}
              buildings={world.buildings}
              lastSeen={world.lastSeen.buildings}
              waypoints={world.waypoints}
              realm={world.home.realmId}
            />
          </InsertPointContext.Provider>
        }
        collapsed={pick?.kind === 'group' || (pick?.kind === 'plan' && !picksCity)}
      />
    </CardSheet>
  )
}
