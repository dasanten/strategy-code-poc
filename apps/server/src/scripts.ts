import { and, asc, eq, max, sql } from 'drizzle-orm'
import { checkScript } from '@csp/lang'
import {
  SCRIPT_MAX_LENGTH,
  SCRIPT_NAME_MAX_LENGTH,
  type ScriptDetail,
  type ScriptSummary,
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
 */

const { scripts, scriptVersions } = schema

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

/** The Player's scripts, by name. */
export function listScripts(db: Db, userId: number): ScriptSummary[] {
  return db
    .select({
      id: scripts.id,
      name: scripts.name,
      activeVersion: scripts.activeVersion,
      latestVersion: sql<number>`coalesce(max(${scriptVersions.version}), 0)`,
    })
    .from(scripts)
    .leftJoin(scriptVersions, eq(scriptVersions.scriptId, scripts.id))
    .where(eq(scripts.userId, userId))
    .groupBy(scripts.id)
    .orderBy(sql`lower(${scripts.name})`)
    .all()
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
  return {
    id: script.id,
    name: script.name,
    activeVersion: script.activeVersion,
    latestVersion: versions.at(-1)?.version ?? 0,
    versions,
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

/** Saves a new version of a script; earlier versions stay. */
export function saveScript(
  db: Db,
  userId: number,
  id: number,
  input: { source: unknown },
): ScriptDetail {
  const source = validateSource(input.source)
  db.transaction((tx) => {
    ownScript(tx as unknown as Db, userId, id)
    addVersion(tx as unknown as Db, id, source)
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
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    ownScript(txDb, userId, id)
    if (nameTaken(txDb, userId, name, id))
      throw new AuthError('name-taken', 'You have a script by that name.')
    tx.update(scripts).set({ name }).where(eq(scripts.id, id)).run()
  })
  return getScript(db, userId, id)
}

/** Makes an earlier (or later) version the one that runs; refused if it has syntax errors. */
export function activateVersion(
  db: Db,
  userId: number,
  id: number,
  input: { version: unknown },
): ScriptDetail {
  db.transaction((tx) => {
    const txDb = tx as unknown as Db
    ownScript(txDb, userId, id)
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
  })
  return getScript(db, userId, id)
}

/** Deletes a script with its whole history. */
export function deleteScript(db: Db, userId: number, id: number): void {
  db.transaction((tx) => {
    ownScript(tx as unknown as Db, userId, id)
    tx.delete(scripts).where(eq(scripts.id, id)).run()
  })
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
 * The script library's invariant (ADR 0004): every active version exists and has no syntax
 * errors.
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
  return violations
}
