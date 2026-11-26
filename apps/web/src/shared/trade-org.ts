// Ported from packages/shared/src/trade-org.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export { inInnerRingAround } from '@csp/lang-wasm'

export { TRADE_ORG, TRADE_ORG_NAME, NO_CARAVANS } from '@csp/shared-types'

/**
 * World queries about the Trade Organization as a side (ADR 0002: the game API orders and scripts
 * share).
 */
