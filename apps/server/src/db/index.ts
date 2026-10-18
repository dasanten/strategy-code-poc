import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenDb {
  db: Db
  sqlite: Database.Database
  close: () => void
}

/**
 * Opens the database. With `beforeMigrate`, an existing database file is handed to it first
 * (used to back it up before migrations run, ADR 0007).
 */
export async function openDb(
  dbPath: string,
  opts: { beforeMigrate?: (sqlite: Database.Database) => Promise<void> } = {},
): Promise<OpenDb> {
  const inMemory = dbPath === ':memory:'
  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const existed = !inMemory && fs.existsSync(dbPath)
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // Admin commands write while the server runs; wait for the other writer instead of failing.
  sqlite.pragma('busy_timeout = 5000')
  if (existed && opts.beforeMigrate) await opts.beforeMigrate(sqlite)
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return { db, sqlite, close: () => sqlite.close() }
}

export { schema }
