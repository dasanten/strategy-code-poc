import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)

/** One row per Player account (ADR 0005). */
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    /** `scrypt$<salt>$<hash>`; empty means the account cannot log in. */
    passwordHash: text('password_hash').notNull().default(''),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  // Names are unique regardless of case, so "Mara" and "mara" can't both exist.
  (t) => [uniqueIndex('users_name_lower').on(sql`lower(${t.name})`)],
)

/** A logged-in browser. Only a hash of the cookie token is stored. */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: createdAt(),
})

/** Single-use codes an admin hands out; signing up needs one. */
export const inviteCodes = sqliteTable('invite_codes', {
  code: text('code').primaryKey(),
  createdBy: integer('created_by').references(() => users.id),
  usedBy: integer('used_by').references(() => users.id),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
})

/** Every save of a script is a new row, so the history is kept. */
export const scripts = sqliteTable(
  'scripts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('scripts_user_name_version').on(t.userId, t.name, t.version)],
)

/**
 * Rolling saves of the world's entities as gzipped JSON (ADR 0006). `version` is the world
 * format the state was written in; loading migrates it to the current one.
 */
export const worldSaves = sqliteTable('world_saves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tick: integer('tick').notNull(),
  version: integer('version').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: createdAt(),
})
