// Walls and gates on the client. Who may step onto a wall walk or pass a gate (`wallMap`,
// `shutOut`) is the server's: no view asks it, and the route preview's blocked tiles are the
// client's guess (`App.tsx`), as the server finds the way again (T122.8). Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import type { Building } from '@csp/shared-types'

/** Whether a building is a finished wall or gate. */
export function isWallOrGate(b: Building): boolean {
  return (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'tower') && !b.site
}

/** Whether a gate is closed; a gate is open until its city's realm closes it. */
export function isClosed(b: Building): boolean {
  return b.kind === 'gate' && b.closed === true
}
