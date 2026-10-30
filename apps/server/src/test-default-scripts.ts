import { DEFAULT_SCRIPTS, TASKS, type TerrainMap, type WorldState } from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { orderKinds, type OrderKind, type OrderSender } from './orders.js'
import { ScriptRunner, runScriptOrder, taskOrder } from './script-runner.js'

/**
 * For tests without a script library: tasks given as from the UI, every Player running the
 * game's default scripts unedited (`CONTEXT.md`: Default script). A Player's version of a task's
 * default has the id `userId * 100` plus the task's place in `TASKS`, from 1; Run script runs it
 * by that id.
 */
export function defaultScripts(terrain: TerrainMap, senders: OrderSender[]) {
  const host = {
    script: (id: number) => {
      const task = TASKS[(id % 100) - 1]
      if (!task) return undefined
      const userId = Math.floor(id / 100)
      return {
        userId,
        name: DEFAULT_SCRIPTS[task].name,
        version: 1,
        source: DEFAULT_SCRIPTS[task].source,
        followsDefault: true,
        task,
      }
    },
    sender: (userId: number) => senders.find((s) => s.userId === userId),
    explored: () => true,
  }
  const kinds: Record<string, OrderKind> = {
    ...orderKinds,
    runScript: runScriptOrder(host),
    task: taskOrder({
      defaultScript: (userId, task) => userId * 100 + TASKS.indexOf(task) + 1,
      script: host.script,
    }),
  }
  const runner = new ScriptRunner(terrain, host)
  return {
    /** The order kinds with the run-script and task orders. */
    kinds,
    /** Runs every running script once, as the game does before the world steps. */
    runAll: (world: WorldState): InvariantViolation[] => runner.runAll(world, true),
  }
}
