// Ported from packages/shared/src/walls.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types. Who may step onto a wall walk or pass a gate (`wallMap`,
// `shutOut`) is the server's: no view asks it, and the route preview's blocked tiles are the
// client's guess (`App.tsx`), as the server finds the way again (T122.8).

import type { Building } from '@csp/shared-types'

export { brokenReturns, wallStrength, wallStrengthLeft } from '@csp/lang-wasm'

/** Whether a building is a finished wall or gate. */
export function isWallOrGate(b: Building): boolean {
  return (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'tower') && !b.site
}

/** Whether a gate is closed; a gate is open until its city's realm closes it. */
export function isClosed(b: Building): boolean {
  return b.kind === 'gate' && b.closed === true
}
