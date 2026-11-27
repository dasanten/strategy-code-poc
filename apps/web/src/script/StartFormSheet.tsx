import { targetParam } from '@csp/lang-wasm'
import { StartParamsForm } from './ScriptParams.js'
import { overrideParamValues, startParamValues, startValuesValid } from './start-params.js'
import { paramValueLabel } from './script-params-view.js'
import { paramWorld } from '../world/seen-world.js'

import type { ClientWorld } from '../world/useWorld.js'
import type { Starting } from './useStartForm.js'
import { type Picker, type StartForm } from '../screen/game-wiring.js'

/** The form before a script starts (`CONTEXT.md`: Starting at once), its values and its picks. */
export function StartFormSheet({
  world,
  starting,
  setStarting,
  picker,
}: {
  world: ClientWorld
  starting: Starting
  setStarting: StartForm['setStarting']
  picker: Pick<Picker, 'formPicking'>
}) {
  return (
    <StartParamsForm
      picking={starting.picking !== undefined}
      script={starting.script.name}
      params={starting.params}
      target={targetParam(starting.script)}
      values={starting.values}
      fromWorkplace={starting.base !== undefined}
      label={(id) => paramValueLabel(paramWorld(world), id)}
      waypoints={world.waypoints}
      canStart={startValuesValid(starting.params, starting.values)}
      error={starting.error}
      onPick={(p) => {
        picker.formPicking()
        setStarting({ ...starting, picking: p, error: undefined })
      }}
      onChange={(name, value) =>
        setStarting({ ...starting, values: { ...starting.values, [name]: value } })
      }
      onStart={() => {
        setStarting(undefined)
        const { params, values, base } = starting
        void starting.start(
          base ? overrideParamValues(params, base, values) : startParamValues(params, values),
        )
      }}
      onCancel={() => setStarting(undefined)}
    />
  )
}
