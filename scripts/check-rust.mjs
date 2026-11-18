// `pnpm check:rust` (ADR 0030, ADR 0040): cargo fmt --check, clippy with warnings as errors, and
// the nextest suite, sharing the machine with other sessions' checks.
//
// Builds run side by side; the suite runs one check at a time, machine-wide. T111.2 measured four
// checks at once this way against all four at full speed, cargo and nextest capped to 8 or 12
// threads, and whole checks one at a time: the first check finished in about half the time, the
// last no later than the others, and the fewest tests ran over 5 s. A check alone waits for
// nothing and takes as long as before. CI runs the steps directly.
//
// The lock is a TCP port on 127.0.0.1: the OS frees it when its holder dies, however it dies.
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import net from 'node:net'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const LOCK_PORT = 47_419

const started = Date.now()
const since = () => `${((Date.now() - started) / 1000).toFixed(0)} s`

/** Holds the port while the returned server is open; null while another process holds it. */
function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.end(JSON.stringify({ pid: process.pid, cwd: process.cwd() }))
    })
    server.once('error', (error) => (error.code === 'EADDRINUSE' ? resolve(null) : reject(error)))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.unref()
      resolve(server)
    })
  })
}

/** Who holds the port, as the holder says (best effort). */
function holder(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    let data = ''
    socket.setTimeout(1000, () => socket.destroy())
    socket.on('data', (chunk) => (data += chunk))
    socket.on('close', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(null)
      }
    })
    socket.on('error', () => resolve(null))
  })
}

async function acquire(port) {
  let told = false
  for (;;) {
    const server = await tryListen(port)
    if (server) {
      if (told) console.log(`pnpm check:rust: the suite's turn after ${since()}`)
      return server
    }
    if (!told) {
      const other = await holder(port)
      console.log(
        `pnpm check:rust: waiting for another check's suite` +
          (other ? ` (pid ${other.pid} in ${other.cwd})` : ''),
      )
      told = true
    }
    await sleep(1000)
  }
}

function run(args) {
  const result = spawnSync('cargo', args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.log(`pnpm check:rust: \`cargo ${args.join(' ')}\` failed after ${since()}`)
    process.exit(result.status ?? 1)
  }
}

run(['fmt', '--all', '--check'])
run(['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'])
run(['nextest', 'run', '--workspace', '--no-run'])
const lock = await acquire(LOCK_PORT)
run(['nextest', 'run', '--workspace'])
lock.close()
console.log(`pnpm check:rust: passed in ${since()}`)
