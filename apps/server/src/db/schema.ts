import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
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

/** The whole world (tiles, units and each unit's memory) as JSON. */
export const worldSnapshots = sqliteTable('world_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tick: integer('tick').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  createdAt: createdAt(),
})
