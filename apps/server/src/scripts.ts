import { and, asc, eq, isNotNull, max, sql } from 'drizzle-orm'
import { checkScript, scriptParams } from '@csp/lang'
import {
  DEFAULT_SCRIPTS,
  SCRIPT_MAX_LENGTH,
  SCRIPT_NAME_MAX_LENGTH,
  TASKS,
  defaultScriptName,
  isTask,
  type ScriptDetail,
  type ScriptSummary,
  type Task,
} from '@csp/shared'
import { AuthError } from './auth.js'
import { schema, type Db } from './db/index.js'
import type { InvariantViolation } from './invariants.js'

/**
 * A Player's script library (`CONTEXT.md`: Script): named scripts with every saved version kept.
 * Scripts belong to the account, so they outlast the realm and a Leader's death.
 *
 * The active version is the one that runs. Saving a version without syntax errors makes it
 * active, so a saved change is picked up on the next tick; a version with errors is kept in the
 * history but never becomes active.
 *
 * Each Player also has their own version of every default script (`CONTEXT.md`: Default script;
 * ADR 0009), made the first time their library is used. Until they edit it, it takes each new
 * game default as a new version (`ensureDefaultScripts`); once edited it stays theirs until they
 * reset it. Default scripts can't be renamed or deleted.
 */

const { scripts, scriptVersions, users } = schema

function validateName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0 || trimmed.length > SCRIPT_NAME_MAX_LENGTH) {
    throw new AuthError(
      'invalid-input',
      `Script names need 1 to ${SCRIPT_NAME_MAX_LENGTH} characters.`,
    )
  }
  return trimmed
}

function validateSource(source: unknown): string {
  if (typeof source !== 'string') throw new AuthError('invalid-input', 'A script needs source.')
  if (source.length > SCRIPT_MAX_LENGTH) {
    throw new AuthError(
      'invalid-input',
      `Scripts can be at most ${SCRIPT_MAX_LENGTH} characters long.`,
    )
  }
  return source
}

function nameTaken(db: Db, userId: number, name: string, exceptId?: number): boolean {
  const row = db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.userId, userId), sql`lower(${scripts.name}) = lower(${name})`))
    .get()
  return row !== undefined && row.id !== exceptId
}

function ownScript(db: Db, userId: number, id: number) {
  const row = db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, id), eq(scripts.userId, userId)))
    .get()
  if (!row) throw new AuthError('not-found', 'No such script.')
  return row
}

/** A script that isn't a default script; those can't be renamed or deleted. */
function notDefault(row: { task: string | null }, what: string): void {
  if (row.task !== null) {
    throw new AuthError('default-script', `A default script can’t be ${what}.`)
  }
}

function latestVersion(db: Db, scriptId: number): number {
  const row = db
    .select({ v: max(scriptVersions.version) })
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, scriptId))
    .get()
  return row?.v ?? 0
}

/** Adds a version; it becomes active if it has no syntax errors. */
function addVersion(db: Db, scriptId: number, source: string): void {
  const version = latestVersion(db, scriptId) + 1
  db.insert(scriptVersions).values({ scriptId, version, source }).run()
  if (checkScript(source).length === 0) {
    db.update(scripts).set({ activeVersion: version }).where(eq(scripts.id, scriptId)).run()
  }
}

function sourceOf(db: Db, scriptId: number, version: number | null): string | undefined {
  if (version === null) return undefined
  return db
    .select({ source: scriptVersions.source })
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.version, version)))
    .get()?.source
}

/** A default script being edited by its Player stops following the game's default. */
function markEdited(db: Db, row: { id: number; task: string | null; followsDefault: boolean }) {
  if (row.task === null || !row.followsDefault || !isTask(row.task)) return
  db.update(scripts)
    .set({ followsDefault: false, editedFrom: DEFAULT_SCRIPTS[row.task].source })
    .where(eq(scripts.id, row.id))
    .run()
}

/**
 * Makes sure the Player has their version of every default script, and that those they haven't
 * edited run the game's current default: a changed default becomes their newest version. A
 * script of theirs already called by a default script's name gets a number after its name.
 */
export function ensureDefaultScripts(db: Db, userId: number): void {
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    for (const task of TASKS) {
      const { source } = DEFAULT_SCRIPTS[task]
      const row = tx
        .select()
        .from(scripts)
        .where(and(eq(scripts.userId, userId), eq(scripts.task, task)))
        .get()
      if (!row) {
        const name = defaultScriptName(task)
        const clash = tx
          .select({ id: scripts.id })
          .from(scripts)
          .where(and(eq(scripts.userId, userId), sql`lower(${scripts.name}) = lower(${name})`))
          .get()
        if (clash) {
          let n = 2
          while (nameTaken(txDb, userId, `${name} ${n}`)) n++
          tx.update(scripts)
            .set({ name: `${name} ${n}` })
            .where(eq(scripts.id, clash.id))
            .run()
        }
        const { id } = tx
          .insert(scripts)
          .values({ userId, name, task, followsDefault: true })
          .returning({ id: scripts.id })
          .get()
        addVersion(txDb, id, source)
      } else if (row.followsDefault && sourceOf(txDb, row.id, row.activeVersion) !== source) {
        addVersion(txDb, row.id, source)
      }
    }
  })
}

/** `ensureDefaultScripts` for every Player, as the server starts with perhaps new defaults. */
export function syncDefaultScripts(db: Db): void {
  for (const { id } of db.select({ id: users.id }).from(users).all()) {
    ensureDefaultScripts(db, id)
  }
}

/** The id of the Player's version of a task's default script, made if they have none yet. */
export function defaultScriptId(db: Db, userId: number, task: Task): number {
  ensureDefaultScripts(db, userId)
  return db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.userId, userId), eq(scripts.task, task)))
    .get()!.id
}

/** The Player's scripts, by name, their default scripts among them. */
export function listScripts(db: Db, userId: number): ScriptSummary[] {
  ensureDefaultScripts(db, userId)
  return db
    .select({
      id: scripts.id,
      name: scripts.name,
      activeVersion: scripts.activeVersion,
      latestVersion: sql<number>`coalesce(max(${scriptVersions.version}), 0)`,
      task: scripts.task,
      followsDefault: scripts.followsDefault,
    })
    .from(scripts)
    .leftJoin(scriptVersions, eq(scriptVersions.scriptId, scripts.id))
    .where(eq(scripts.userId, userId))
    .groupBy(scripts.id)
    .orderBy(sql`lower(${scripts.name})`)
    .all()
    .map((s) => ({
      ...s,
      task: isTask(s.task) ? s.task : null,
      params: paramsOf(sourceOf(db, s.id, s.activeVersion)),
    }))
}

/** The `param` lines of an active version's source (`CONTEXT.md`: Script parameter). */
function paramsOf(source: string | undefined): ScriptSummary['params'] {
  return source === undefined ? [] : scriptParams(source)
}

/** One of the Player's scripts with its whole history. */
export function getScript(db: Db, userId: number, id: number): ScriptDetail {
  const script = ownScript(db, userId, id)
  const versions = db
    .select()
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, id))
    .orderBy(asc(scriptVersions.version))
    .all()
    .map((v) => ({
      version: v.version,
      source: v.source,
      savedAt: Math.floor(v.createdAt.getTime() / 1000),
      errors: checkScript(v.source),
    }))
  const task = isTask(script.task) ? script.task : null
  return {
    id: script.id,
    name: script.name,
    activeVersion: script.activeVersion,
    latestVersion: versions.at(-1)?.version ?? 0,
    task,
    followsDefault: script.followsDefault,
    params: paramsOf(versions.find((v) => v.version === script.activeVersion)?.source),
    versions,
    ...(task === null
      ? {}
      : {
          gameDefault: {
            source: DEFAULT_SCRIPTS[task].source,
            editedFrom: script.followsDefault ? null : script.editedFrom,
          },
        }),
  }
}

/** Starts a new script with its first version. */
export function createScript(
  db: Db,
  userId: number,
  input: { name: unknown; source: unknown },
): ScriptDetail {
  const name = validateName(input.name)
  const source = validateSource(input.source)
  // So a new script can't take a default script's name.
  ensureDefaultScripts(db, userId)
  const id = db.transaction((tx) => {
    const txDb = tx as unknown as Db
    if (nameTaken(txDb, userId, name))
      throw new AuthError('name-taken', 'You have a script by that name.')
    const { id } = tx.insert(scripts).values({ userId, name }).returning({ id: scripts.id }).get()
    addVersion(txDb, id, source)
    return id
  })
  return getScript(db, userId, id)
}

/**
 * Saves a new version of a script; earlier versions stay. A default script the Player saves is
 * theirs from then on.
 */
export function saveScript(
  db: Db,
  userId: number,
  id: number,
  input: { source: unknown },
): ScriptDetail {
  const source = validateSource(input.source)
  db.transaction((tx) => {
    const row = ownScript(tx as unknown as Db, userId, id)
    addVersion(tx as unknown as Db, id, source)
    markEdited(tx as unknown as Db, row)
  })
  return getScript(db, userId, id)
}

export function renameScript(
  db: Db,
  userId: number,
  id: number,
  input: { name: unknown },
): ScriptDetail {
  const name = validateName(input.name)
  ensureDefaultScripts(db, userId)
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    notDefault(ownScript(txDb, userId, id), 'renamed')
    if (nameTaken(txDb, userId, name, id))
      throw new AuthError('name-taken', 'You have a script by that name.')
    tx.update(scripts).set({ name }).where(eq(scripts.id, id)).run()
  })
  return getScript(db, userId, id)
}

/**
 * Makes an earlier (or later) version the one that runs; refused if it has syntax errors. For a
 * default script that counts as editing it.
 */
export function activateVersion(
  db: Db,
  userId: number,
  id: number,
  input: { version: unknown },
): ScriptDetail {
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    const script = ownScript(txDb, userId, id)
    const row =
      typeof input.version === 'number'
        ? tx
            .select()
            .from(scriptVersions)
            .where(and(eq(scriptVersions.scriptId, id), eq(scriptVersions.version, input.version)))
            .get()
        : undefined
    if (!row) throw new AuthError('not-found', 'No such version.')
    const [error] = checkScript(row.source)
    if (error) {
      throw new AuthError(
        'script-has-errors',
        `Version ${row.version} has a syntax error at ${error.line}:${error.column}: ${error.message}`,
      )
    }
    tx.update(scripts).set({ activeVersion: row.version }).where(eq(scripts.id, id)).run()
    markEdited(txDb, script)
  })
  return getScript(db, userId, id)
}

/**
 * Resets a default script (`CONTEXT.md`: Default script): the game's current default becomes its
 * newest version, and it follows the game's default again until the Player edits it.
 */
export function resetScript(db: Db, userId: number, id: number): ScriptDetail {
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    const row = ownScript(txDb, userId, id)
    if (!isTask(row.task)) {
      throw new AuthError('default-script', 'Only a default script can be reset.')
    }
    addVersion(txDb, id, DEFAULT_SCRIPTS[row.task].source)
    tx.update(scripts)
      .set({ followsDefault: true, editedFrom: null })
      .where(eq(scripts.id, id))
      .run()
  })
  return getScript(db, userId, id)
}

/** Deletes a script with its whole history. */
export function deleteScript(db: Db, userId: number, id: number): void {
  db.transaction((tx) => {
    notDefault(ownScript(tx as unknown as Db, userId, id), 'deleted')
    tx.delete(scripts).where(eq(scripts.id, id)).run()
  })
}

/** What the run-script order needs of a script: whose it is and its active version's source. */
export interface RunnableScript {
  userId: number
  source: string
  /** A default script its Player hasn't edited: running out of steps is the game's fault. */
  followsDefault: boolean
}

/** A script that can run: its Player and active version; undefined if it has none (or is gone). */
export function runnableScript(db: Db, scriptId: number): RunnableScript | undefined {
  return db
    .select({
      userId: scripts.userId,
      source: scriptVersions.source,
      followsDefault: scripts.followsDefault,
    })
    .from(scripts)
    .innerJoin(
      scriptVersions,
      and(
        eq(scriptVersions.scriptId, scripts.id),
        eq(scriptVersions.version, scripts.activeVersion),
      ),
    )
    .where(eq(scripts.id, scriptId))
    .get()
}

/** The source of the script's active version, or undefined if it has none (or is gone). */
export function activeSource(db: Db, scriptId: number): string | undefined {
  return db
    .select({ source: scriptVersions.source })
    .from(scripts)
    .innerJoin(
      scriptVersions,
      and(
        eq(scriptVersions.scriptId, scripts.id),
        eq(scriptVersions.version, scripts.activeVersion),
      ),
    )
    .where(eq(scripts.id, scriptId))
    .get()?.source
}

/**
 * The script library's invariants (ADR 0004): every active version exists and has no syntax
 * errors; every default script is for a task, and one its Player hasn't edited runs the game's
 * current default (checked after `syncDefaultScripts`).
 */
export function checkScriptLibrary(db: Db): InvariantViolation[] {
  const invariant = 'active-scripts-valid'
  const rows = db
    .select({
      id: scripts.id,
      activeVersion: scripts.activeVersion,
      source: scriptVersions.source,
    })
    .from(scripts)
    .leftJoin(
      scriptVersions,
      and(
        eq(scriptVersions.scriptId, scripts.id),
        eq(scriptVersions.version, scripts.activeVersion),
      ),
    )
    .where(sql`${scripts.activeVersion} IS NOT NULL`)
    .all()
  const violations: InvariantViolation[] = []
  for (const r of rows) {
    const entityIds = [`script-${r.id}`]
    if (r.source === null) {
      violations.push({
        invariant,
        message: `script ${r.id} has missing active version ${r.activeVersion}`,
        entityIds,
      })
    } else if (checkScript(r.source).length > 0) {
      violations.push({
        invariant,
        message: `script ${r.id} has syntax errors in its active version ${r.activeVersion}`,
        entityIds,
      })
    }
  }
  const defaults = db
    .select({
      id: scripts.id,
      task: scripts.task,
      followsDefault: scripts.followsDefault,
      activeVersion: scripts.activeVersion,
    })
    .from(scripts)
    .where(isNotNull(scripts.task))
    .all()
  for (const d of defaults) {
    const fail = (message: string) =>
      violations.push({
        invariant: 'default-scripts-follow',
        message: `default script ${d.id} ${message}`,
        entityIds: [`script-${d.id}`],
      })
    if (!isTask(d.task)) fail(`is for no task: ${d.task}`)
    else if (
      d.followsDefault &&
      sourceOf(db, d.id, d.activeVersion) !== DEFAULT_SCRIPTS[d.task].source
    ) {
      fail(`follows the game's default of ${d.task} but doesn't run it`)
    }
  }
  return violations
}
