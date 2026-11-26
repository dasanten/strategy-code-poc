// Ported from packages/shared/src/waypoints.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export { addWaypointProblem, renameWaypointProblem, removeWaypointProblem } from '@csp/lang-wasm'

/*
 * Waypoints (`CONTEXT.md`: Waypoint): named markers a Player puts on tiles, seen only by them and
 * kept with the Player, not their realm. These checks are shared, so the UI can say why before
 * it sends an order and the server says the same when it turns one down.
 */
