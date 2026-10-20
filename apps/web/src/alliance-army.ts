import type { Diplomacy } from '@csp/shared'

/**
 * Whether the Player of `realmId` gives orders to a resident or carriage they see (`CONTEXT.md`:
 * Alliance army): one handed over to their alliance's army takes orders only from its alliance
 * leader; a mercenary only from their hirer (`CONTEXT.md`: Mercenary contract); anything else
 * from its own realm. `owner` is the resident's `owner` or the carriage's
 * `realmId`.
 */
export function commandsSeen(
  diplomacy: Diplomacy,
  realmId: string,
  thing: { id: string; owner: string | null },
): boolean {
  const alliance = diplomacy.alliance
  if (alliance?.army.some((p) => p.id === thing.id)) return alliance.leaderId === realmId
  const hired = diplomacy.contracts.find(
    (c) => c.startedAt !== null && c.residents.some((r) => r.id === thing.id),
  )
  if (hired) return hired.hirer.realmId === realmId
  return thing.owner === realmId
}
