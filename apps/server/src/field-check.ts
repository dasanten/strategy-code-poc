import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { checkNames } from '@csp/lang'
import { scriptCheckEnv } from '@csp/shared'
import { schema, type Db } from './db/index.js'

const { scripts, scriptVersions, users } = schema

/** A field a Player's active script reads that its script view doesn't declare. */
export interface UndeclaredRead {
  /** The view as the checker names it: `resident`, `building`, `residentOrArmy`, … */
  view: string
  field: string
  scriptId: number
  script: string
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
      .reads.filter((read) => !read.declared)
      .map((read) => ({
        view: read.shape,
        field: read.field,
        scriptId: r.scriptId,
        script: r.script,
        player: r.player,
        line: read.line,
        column: read.column,
      })),
  )
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
