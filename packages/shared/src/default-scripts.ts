/**
 * The game's default scripts (`CONTEXT.md`: Default script; ADR 0009): the script behind each
 * task the UI can give, written in the game's own language. Each Player has their own version
 * of every one in their library, which follows the game's default until they edit it.
 *
 * Giving a resident a task from the UI runs its default script with the task's target written
 * into `memory`, as `TaskMemory` lists. Defaults use the step budget like any script; a test
 * keeps each at most a quarter of `SCRIPT_STEP_BUDGET`.
 */

/** The tasks that run a default script. */
export const TASKS = ['work', 'haul', 'tearDown'] as const
export type Task = (typeof TASKS)[number]

/** What giving a task from the UI writes into the script's memory. */
export interface TaskMemory {
  /** Work: the workplace to work, the one the resident stands on; `makes` at a smithy. */
  work: { workplaceId: string; makes?: string }
  /**
   * Haul: the carriage, the route's stops (`from` the tile the resident stood on when given it),
   * the goods going to `to` and those coming back, and the Food kept on board for the horse.
   */
  haul: {
    carriageId: string
    from: { x: number; y: number }
    to: { x: number; y: number }
    goods: string[]
    returnGoods: string[]
    keepFood: number
  }
  /** Tear down: the building or construction site on the resident's tile. */
  tearDown: { buildingId: string }
}

export interface DefaultScript {
  /** The task's name, as the UI shows it. */
  name: string
  source: string
}

/**
 * The game's current default of each task. Changing a source here reaches every Player still
 * following it on the next start; those who edited theirs are told it changed.
 */
export const DEFAULT_SCRIPTS: Readonly<Record<Task, DefaultScript>> = {
  work: {
    name: 'Work',
    source: `// Work (default): work the workplace I stand on, memory.workplaceId.
// At a smithy, memory.makes says what to make. Meals come from the
// workplace's pile on their own, without an order.
if (me.order == null || me.order.kind != "workAt") {
  workAt(memory.makes)
}
`,
  },
  haul: {
    name: 'Haul',
    source: `// Haul (default): drive carriage memory.carriageId on a haul route between
// memory.from and memory.to: memory.goods there, memory.returnGoods back,
// memory.keepFood Food kept on board for the horse. The built-in haul order
// loads, drives and unloads, again and again; this starts it at memory.from.
if (me.order == null || me.order.kind != "haul") {
  if (me.x == memory.from.x && me.y == memory.from.y) {
    haul(memory.carriageId, memory.to.x, memory.to.y, memory.goods, memory.returnGoods, memory.keepFood)
  }
}
`,
  },
  tearDown: {
    name: 'Tear down',
    source: `// Tear down (default): tear down memory.buildingId, the building or site
// I stand on, until it is gone; then stand idle.
if (memory.done != true && (me.order == null || me.order.kind != "tearDown")) {
  // Turned down, such as with the building gone, tearDown says why: done.
  if (tearDown(memory.buildingId) != null) {
    memory.done = true
  }
}
`,
  },
}

/** The name of a Player's version of a task's default script in their library. */
export function defaultScriptName(task: Task): string {
  return `${DEFAULT_SCRIPTS[task].name} (default)`
}

export function isTask(value: unknown): value is Task {
  return (TASKS as readonly unknown[]).includes(value)
}
