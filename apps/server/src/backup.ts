import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

export const KEEP_BACKUPS_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Writes a consistent copy of the live database into `dir` (SQLite's online backup, safe while
 * the world is running) and deletes backups older than 14 days (ADR 0007).
 */
export async function backupDb(
  sqlite: Database.Database,
  dir: string,
  reason: 'start' | 'daily',
  now = new Date(),
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `world-${stamp}-${reason}.db`)
  await sqlite.backup(file)
  pruneBackups(dir, now.getTime())
  return file
}

export function pruneBackups(dir: string, nowMs = Date.now()): void {
  for (const name of fs.readdirSync(dir)) {
    if (!/^world-.*\.db$/.test(name)) continue
    const file = path.join(dir, name)
    if (nowMs - fs.statSync(file).mtimeMs > KEEP_BACKUPS_DAYS * DAY_MS) fs.rmSync(file)
  }
}
