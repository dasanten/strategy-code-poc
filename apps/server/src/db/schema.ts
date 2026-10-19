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

/**
 * A Player's named scripts (`CONTEXT.md`: Script). They belong to the account, not the realm, so
 * they outlast a Leader's death. `activeVersion` is the version that runs: always one without
 * syntax errors, or null while there is none.
 */
export const scripts = sqliteTable(
  'scripts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    activeVersion: integer('active_version'),
    createdAt: createdAt(),
  },
  // Names are unique per Player regardless of case.
  (t) => [uniqueIndex('scripts_user_name_lower').on(t.userId, sql`lower(${t.name})`)],
)

/** Every save of a script is a new row, so the history is kept. */
export const scriptVersions = sqliteTable(
  'script_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scriptId: integer('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('script_versions_script_version').on(t.scriptId, t.version)],
)

/**
 * The world's terrain (ADR 0006): generated once from `seed` when the world is created, one byte
 * per tile in a `size` × `size` grid whose opposite sides join. One row per world. (The size
 * column kept its first name, `diameter`, from when the map was a disc.)
 */
export const terrain = sqliteTable('terrain', {
  id: integer('id').primaryKey(),
  seed: integer('seed').notNull(),
  size: integer('diameter').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: createdAt(),
})

/**
 * Each Player's explored terrain (`CONTEXT.md`: Explored terrain): one bit per tile of the
 * terrain grid, row-major. Saved together with the world.
 */
export const explored = sqliteTable('explored', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: blob('data', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

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
