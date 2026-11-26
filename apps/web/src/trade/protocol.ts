// What the client is sent of a price line.

/**
 * A price line as a Player sees it: what is held only when they see inside (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type Shown<P extends { stock: number }> = Omit<P, 'stock'> & { stock?: number }
