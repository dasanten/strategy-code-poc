// Writes ts-made.db: a database the TypeScript server's own code path makes (better-sqlite3, the
// Drizzle migrator on migrations/ (a copy of apps/server/drizzle, pinned to LF), the pragmas of db/index.ts) with one row per table.
// Never hand-edited, never a copy of a real database (those hold accounts). Run from the repo root:
//   node crates/csp-server/tests/data/make-ts-db.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = path.resolve(here, '../../../../apps/server')
const require = createRequire(path.join(server, 'package.json'))
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const { migrate } = require('drizzle-orm/better-sqlite3/migrator')

const out = path.join(here, 'ts-made.db')
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(out + suffix, { force: true })
const sqlite = new Database(out)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')
migrate(drizzle(sqlite), { migrationsFolder: path.join(here, '../../migrations') })

sqlite.exec(`
INSERT INTO users (id, name, password_hash, is_admin) VALUES (1, 'Mara', 'scrypt$salt$hash', 1);
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('tok', 1, 2000000000);
INSERT INTO invite_codes (code, created_by) VALUES ('CODE1', 1);
INSERT INTO scripts (id, user_id, name, active_version, latest_version) VALUES (1, 1, 'farm', 1, 1);
INSERT INTO script_versions (script_id, version, source) VALUES (1, 1, 'harvest()');
INSERT INTO terrain (id, seed, diameter, data) VALUES (1, 7, 2, x'00010203');
INSERT INTO explored (user_id, data, updated_at) VALUES (1, x'ff', 1700000000);
INSERT INTO world_saves (tick, version, data) VALUES (30, 1, x'1f8b');
`)
sqlite.pragma('wal_checkpoint(TRUNCATE)')
sqlite.close()
for (const suffix of ['-wal', '-shm']) fs.rmSync(out + suffix, { force: true })
console.log('wrote', out)
