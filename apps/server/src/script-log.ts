import { DOING_MAX_LENGTH, SCRIPT_LOG_LINES, type Resident } from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/**
 * Adds lines a script logged this tick to its resident's script log (`CONTEXT.md`: Script log),
 * each with the tick; once it holds `SCRIPT_LOG_LINES`, the oldest go.
 */
export function addToScriptLog(r: Resident, tick: number, texts: readonly string[]): void {
  if (texts.length === 0) return
  const log = [...(r.scriptLog ?? []), ...texts.map((text) => ({ tick, text }))]
  r.scriptLog = log.slice(-SCRIPT_LOG_LINES)
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Script log): a resident's script log holds at most
 * `SCRIPT_LOG_LINES` lines of short, non-empty text, oldest first and none from the future.
 */
export const scriptLogsSound: Invariant = {
  name: 'script-logs-sound',
  check: (world) => {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const log = r.scriptLog
      if (!log) continue
      const fail = (message: string) =>
        out.push({
          invariant: 'script-logs-sound',
          message: `${r.id}'s script log ${message}`,
          entityIds: [r.id],
        })
      if (log.length === 0 || log.length > SCRIPT_LOG_LINES) fail(`holds ${log.length} lines`)
      let last = -Infinity
      for (const { tick, text } of log) {
        if (text.length === 0 || text.length > DOING_MAX_LENGTH)
          fail(`has a line of ${text.length}`)
        if (tick < last) fail(`goes back from tick ${last} to ${tick}`)
        if (tick > world.tick) fail(`has a line at tick ${tick}, after ${world.tick}`)
        last = tick
      }
    }
    return out
  },
}
