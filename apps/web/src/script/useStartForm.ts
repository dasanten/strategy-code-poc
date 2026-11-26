import { useEffect, useRef, useState } from 'react'
import type {
  OrderRequest,
  ScriptParam,
  ScriptParamValues,
  ScriptSummary,
  StartParamValues,
} from '@csp/shared-types'
import { targetParam } from '@csp/lang-wasm'
import {
  canCustomise,
  groupStartValues,
  isWorkTask,
  startedScript,
  startFormOpens,
  startFormParams,
  startValues,
  type StartValues,
} from './start-params.js'
import { paramPickAt } from './script-params-view.js'
import { useWorld } from '../world/useWorld.js'
import { paramWorld } from '../world/seen-world.js'

/**
 * The form shown before a script with params starts (`CONTEXT.md`: Script parameter, Before it
 * starts): the script, the values in the form, the param being picked on the map for it, why the
 * last pick picked nothing, and what Start gives with the values.
 */
export interface Starting {
  script: ScriptSummary
  /** The params the form shows (`startFormParams`). */
  params: ScriptParam[]
  values: StartValues
  /**
   * For Work, what the form started with, the workplace's settings (`CONTEXT.md`: Workplace
   * settings): Start gives only what was changed from it, the resident's overrides.
   */
  base?: StartValues
  picking?: ScriptParam
  error?: string
  start: (params: StartParamValues) => Promise<void>
}

/**
 * The form before a script starts (`CONTEXT.md`: Before it starts): what it shows, and whether
 * Customise asked for it on the next order.
 */
export function useStartForm(
  world: ReturnType<typeof useWorld>['world'],
  scripts: ScriptSummary[],
) {
  const [starting, setStarting] = useState<Starting>()
  /**
   * Customise was tapped (`CONTEXT.md`: Before it starts): the next order opens the form. It waits
   * through what the order picks on the map first, and goes when that is cancelled.
   */
  const customising = useRef(false)
  /**
   * Opens the form before the script `order` starts, if it should (`startFormOpens`), and says
   * whether it did: filled with what `keptBy` keep for the script or the defaults, for Work with
   * the workplace's settings (`CONTEXT.md`: Workplace settings); Start runs `start`. Asking for it
   * with Customise is used up here, whatever the order.
   */
  function opensForm(
    order: OrderRequest,
    keptBy: readonly (ScriptParamValues | undefined)[],
    start: (params: StartParamValues) => Promise<void>,
  ): boolean {
    const customise = customising.current
    customising.current = false
    const settings = world?.workSettings ?? {}
    const script = startedScript(order, scripts, settings)
    const params = script ? startFormParams(order, script) : []
    if (!script || !startFormOpens(order, params, customise)) return false
    const atWork = isWorkTask(order)
    const values = atWork
      ? startValues(params, settings[order.workplaceId as string]?.params)
      : groupStartValues(
          params,
          keptBy.map((kept) => kept?.[script.id]),
          targetParam(script),
        )
    setStarting({ script, params, values, ...(atWork ? { base: values } : {}), start })
    return true
  }
  /** A tile picked for the param the form is picking, which shows again. */
  const formTile = (x: number, y: number) => {
    const param = starting?.picking
    if (!starting || !param || !world) return
    const got = paramPickAt(paramWorld(world), param.type, { x, y })
    setStarting({
      ...starting,
      picking: undefined,
      ...(typeof got === 'string'
        ? { error: got }
        : { error: undefined, values: { ...starting.values, [param.name]: got.id } }),
    })
  }
  /** The pick for the form's param was cancelled: the form shows again as it was. */
  const pickCancelled = () => setStarting((s) => s && { ...s, picking: undefined })
  /** What the Customise buttons ask of the game (`CustomiseContext`). */
  const customise = {
    can: (order: OrderRequest) => canCustomise(order, scripts, world?.workSettings),
    give: (give: () => void) => {
      customising.current = true
      give()
    },
  }
  return { starting, setStarting, customising, opensForm, formTile, pickCancelled, customise }
}

/** Customise lapses once no order is being given or picked any more. */
export function useCustomiseLapse(customising: { current: boolean }, orderPicked: boolean) {
  useEffect(() => {
    if (!orderPicked) customising.current = false
  }, [customising, orderPicked])
}
