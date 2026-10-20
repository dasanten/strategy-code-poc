import type { Diplomacy } from '@csp/shared'

/**
 * Whether the Player of `realmId` gives orders to a resident or carriage they see (`CONTEXT.md`:
 * Alliance army): one handed over to their alliance's army takes orders only from its alliance
 * leader; anything else from its own realm. `owner` is the resident's `owner` or the carriage's
 * `realmId`.
 */
export function commandsSeen(
  diplomacy: Diplomacy,
  realmId: string,
  thing: { id: string; owner: string | null },
): boolean {
  const alliance = diplomacy.alliance
  if (alliance?.army.some((p) => p.id === thing.id)) return alliance.leaderId === realmId
  return thing.owner === realmId
}
