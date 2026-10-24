/**
 * Lists the fields Players' active scripts read that the script views don't declare (ADR 0011),
 * with the script and the Player, before scripts see exactly their views:
 *
 *   check-fields
 *
 * Read only; safe to run while the server is up.
 */
import { config } from '../config.js'
import { openDb } from '../db/index.js'
import { describeUndeclaredReads, undeclaredFieldReads } from '../field-check.js'

const { db, close } = await openDb(config.dbPath)
try {
  console.log(describeUndeclaredReads(undeclaredFieldReads(db)))
} finally {
  close()
}
