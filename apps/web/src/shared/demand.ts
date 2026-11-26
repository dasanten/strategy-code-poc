// Ported from packages/shared/src/demand.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export { transferLoads, transferLoadsFee, goodsToHandOver, demandNoteProblem } from '@csp/lang-wasm'

/** World queries about demands (`CONTEXT.md`: Demand; ADR 0002: the API orders and scripts share). */
