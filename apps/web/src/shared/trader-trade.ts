// Ported from packages/shared/src/trader-trade.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export { quoteTraderTrade } from '@csp/lang-wasm'

export { traderStock } from '@csp/lang-wasm'

export { traderPriceFor } from '@csp/lang-wasm'

/*
 * Trading with a wandering trader at a stop (`CONTEXT.md`: Trader stop). Queries here are the game
 * API that orders, scripts and the game's own NPC behaviour share (ADR 0002); nothing moves.
 */
