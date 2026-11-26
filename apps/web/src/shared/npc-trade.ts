// Ported from packages/shared/src/npc-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export { npcPriceFor, npcSoldierTarget, npcFullDays, npcFoundingPartySize } from '@csp/lang-wasm'

export { NPC_SMITHY_WEAPON } from '@csp/shared-types'

/*
 * Trading with and hiring from an NPC city (`CONTEXT.md`: Trading with an NPC city, Hiring from
 * an NPC city). Queries here are the game API that orders, scripts and the game's own NPC
 * behaviour share (ADR 0002); nothing moves.
 */

// What an NPC city would lend (`spareResidents`, `npcHireProblem`) is the server's alone since
// T96.3 (ADR 0033): it reads the city's plan and threats. The client shows `hire.spare` as seen.
