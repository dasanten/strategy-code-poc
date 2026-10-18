/**
 * Admin commands that work without logging in (ADR 0005):
 *
 *   admin create <name>   creates an admin account (or makes one admin); the password comes from
 *                         ADMIN_PASSWORD or is asked for
 *   admin invite          prints a new invite code
 *
 * Safe to run while the server is up: SQLite lets both write.
 */
import { createInterface } from 'node:readline/promises'
import { config } from '../config.js'
import { AuthError, createAdmin, createInviteCode } from '../auth.js'
import { openDb } from '../db/index.js'

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

const [command, name] = process.argv.slice(2)
const { db, close } = await openDb(config.dbPath)
try {
  if (command === 'create' && name) {
    const password = process.env.ADMIN_PASSWORD ?? (await ask(`Password for ${name}: `))
    await createAdmin(db, name, password)
    console.log(`${name} is an admin.`)
  } else if (command === 'invite') {
    console.log(createInviteCode(db, null))
  } else {
    console.error('usage: admin create <name> | admin invite')
    process.exitCode = 1
  }
} catch (err) {
  if (!(err instanceof AuthError)) throw err
  console.error(err.message)
  process.exitCode = 1
} finally {
  close()
}
