import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export type Db = BetterSQLite3Database<typeof schema>

export function openDb(dbPath: string): { db: Db; close: () => void } {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return { db, close: () => sqlite.close() }
}

export { schema }
