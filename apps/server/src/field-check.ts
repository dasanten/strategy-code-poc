import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { checkNames, PARAMS_SHAPE } from '@csp/lang'
import { RESIDENT_OR_ARMY, SCRIPT_VIEW_CHANGES, scriptCheckEnv, type WorldState } from '@csp/shared'
import { schema, type Db } from './db/index.js'
import { recordPlayerEvent } from './events.js'

const { scripts, scriptVersions, users } = schema

/** A field a Player's active script reads that its script view doesn't declare. */
export interface UndeclaredRead {
  /** The view as the checker names it: `resident`, `building`, `residentOrArmy`, … */
  view: string
  field: string
  scriptId: number
  script: string
  userId: number
  player: string
  line: number
  column: number
}

/**
 * The live-world check before scripts see exactly their script views (ADR 0011): the checker
 * run over the active version of every Player's script, listing each field it reads that the
 * views don't declare, with the script and the Player. Only reads from values the checker is
 * sure of count (`me`, a query's result, …); one through `memory` or a function's parameters
 * isn't found. Read only.
 */
export function undeclaredFieldReads(db: Db): UndeclaredRead[] {
  const rows = db
    .select({
      scriptId: scripts.id,
      script: scripts.name,
      task: scripts.task,
      userId: users.id,
      player: users.name,
      source: scriptVersions.source,
    })
    .from(scripts)
    .innerJoin(users, eq(users.id, scripts.userId))
    .innerJoin(
      scriptVersions,
      and(
        eq(scriptVersions.scriptId, scripts.id),
        eq(scriptVersions.version, scripts.activeVersion),
      ),
    )
    .where(isNotNull(scripts.activeVersion))
    .orderBy(asc(users.name), asc(scripts.name))
    .all()
  const envs = [false, true].map((defaultScript) => scriptCheckEnv({ defaultScript }))
  return rows.flatMap((r) =>
    checkNames(r.source, envs[r.task === null ? 0 : 1]!)
      // A script's own params are no field of the game's.
      .reads.filter((read) => !read.declared && read.shape !== PARAMS_SHAPE)
      .map((read) => ({
        view: read.shape,
        field: read.field,
        scriptId: r.scriptId,
        script: r.script,
        userId: r.userId,
        player: r.player,
        line: read.line,
        column: read.column,
      })),
  )
}

/**
 * Tells the Players of the breaking changes to the script views they weren't told of yet
 * (`SCRIPT_VIEW_CHANGES`, ADR 0011): one realm-log note for each dropped field a Player's active
 * scripts read, naming the field and the scripts. Run at start, as the views change only with a
 * deploy. Whether it wrote down anything, so the world is worth saving.
 */
export function noteScriptViewChanges(
  db: Db,
  world: WorldState,
  changes: typeof SCRIPT_VIEW_CHANGES = SCRIPT_VIEW_CHANGES,
): boolean {
  const pending = changes.slice(world.scriptViewChanges)
  if (pending.length === 0) return false
  world.scriptViewChanges = changes.length
  // A Player's own script's `me` may be a resident's or an army's: the note calls it `me`.
  const views = (r: UndeclaredRead) =>
    r.view === RESIDENT_OR_ARMY ? ['resident', 'army'] : [r.view]
  const dropped = (r: UndeclaredRead) =>
    pending.some(
      (c) =>
        c.dropped === 'undeclared' || views(r).some((v) => c.dropped.includes(`${v}.${r.field}`)),
    )
  const notes = new Map<string, { userId: number; field: string; scripts: Map<number, string> }>()
  for (const r of undeclaredFieldReads(db).filter(dropped)) {
    const field = `${r.view === RESIDENT_OR_ARMY ? 'me' : r.view}.${r.field}`
    const key = `${r.userId} ${field}`
    const note = notes.get(key) ?? { userId: r.userId, field, scripts: new Map() }
    note.scripts.set(r.scriptId, r.script)
    notes.set(key, note)
  }
  for (const { userId, field, scripts } of notes.values()) {
    recordPlayerEvent(world, userId, {
      kind: 'scriptFieldDropped',
      field,
      scripts: [...scripts].map(([scriptId, name]) => ({ scriptId, name })),
    })
  }
  return true
}

/** The check's report: one line per field read, grouped by view and field. */
export function describeUndeclaredReads(reads: UndeclaredRead[]): string {
  if (reads.length === 0) return 'No active script reads a field the script views don’t declare.'
  const byField = new Map<string, UndeclaredRead[]>()
  for (const r of reads) {
    const key = `${r.view}.${r.field}`
    byField.set(key, [...(byField.get(key) ?? []), r])
  }
  const lines = [...byField.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, rs]) => [
      key,
      ...rs.map(
        (r) => `  ${r.player} · script "${r.script}" (${r.scriptId}) · ${r.line}:${r.column}`,
      ),
    ])
  const players = new Set(reads.map((r) => r.player)).size
  return [
    ...lines,
    `${byField.size} undeclared field${byField.size === 1 ? '' : 's'} read by ${players} Player${players === 1 ? '' : 's'}.`,
  ].join('\n')
}
