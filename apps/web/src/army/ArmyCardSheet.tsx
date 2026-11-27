import { ArmyCard } from './Armies.js'
import { CardSheet } from '../screen/SelectionCard.js'
import { barBesideTile } from '../screen/dock-view.js'

import type { ClientWorld } from '../world/useWorld.js'
import { type ResidentOrders } from '../residents/useResidentOrders.js'
import {
  type GameSeen,
  type Sheet,
  type Live,
  type Picker,
  type SelectionState,
  type Workshop,
} from '../screen/game-wiring.js'

interface ArmyCardSheetProps {
  seen: GameSeen
  /** The army opened in the Armies tab. */
  openArmy: ClientWorld['armies'][number]
  /** The command bar beside an open tile card (`barBesideTile`). */
  besideTile: ReturnType<typeof barBesideTile>
  sheet: Sheet
  picker: Picker
  orders: Pick<ResidentOrders, 'armyError' | 'setArmyError'>
  sendOrder: Live['sendOrder']
  scriptDebug: Workshop['scriptDebug']
  setOpenArmyId: SelectionState['setOpenArmyId']
}

/** The army opened in the Armies tab, its card in the command bar as a resident's is. */
export function ArmyCardSheet(props: ArmyCardSheetProps) {
  const { world, own, scripts, phone } = props.seen
  const { openArmy, besideTile, picker, sendOrder, scriptDebug, setOpenArmyId } = props
  const { armyError, setArmyError } = props.orders
  const { hidden: hideCard } = props.sheet
  return (
    <CardSheet
      phone={phone}
      pinnedPeek={picker.army.pick !== undefined}
      bar
      keysOff={!besideTile.keys}
      hidden={hideCard}
    >
      <ArmyCard
        key={openArmy.id}
        army={openArmy}
        own={own}
        inSight={world.residents}
        carriages={world.carriages}
        realmId={world.home.realmId}
        picking={picker.army.pick}
        onPick={(p) => {
          picker.army.set(p)
          setArmyError(undefined)
        }}
        pickError={armyError}
        scripts={scripts}
        sendOrder={sendOrder}
        scriptMemory={openArmy.script && scriptDebug(openArmy.id, openArmy.script.scriptId ?? 0)}
        onClose={() => {
          setOpenArmyId(undefined)
          picker.army.clear()
        }}
      />
    </CardSheet>
  )
}
