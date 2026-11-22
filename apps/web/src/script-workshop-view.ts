import type { ScriptSummary } from '@csp/shared-types'

/**
 * The script workshop's view logic (ADR 0044; `CONTEXT.md`: Screen): the library on the left in
 * its two groups, the editor in the middle, History (or the New script form) on the right. On a
 * phone the three are steps, one at a time.
 */

/** The library's groups, in the list's order: the Player's default scripts, then their own. */
export type LibraryGroup<S> = { label: 'Default scripts' | 'Your scripts'; scripts: S[] }

/**
 * The library's scripts in their groups (`CONTEXT.md`: Default script), each group in the order
 * the server lists them; a group with none is left out.
 */
export function libraryGroups<S extends Pick<ScriptSummary, 'task'>>(
  scripts: readonly S[],
): LibraryGroup<S>[] {
  const groups: LibraryGroup<S>[] = [
    { label: 'Default scripts', scripts: scripts.filter((s) => s.task !== null) },
    { label: 'Your scripts', scripts: scripts.filter((s) => s.task === null) },
  ]
  return groups.filter((g) => g.scripts.length > 0)
}

/**
 * A script's state line under its name in the library: for a default script whether it follows
 * the game's default, then the version that runs, or that none does.
 */
export function libraryLine(
  s: Pick<ScriptSummary, 'task' | 'followsDefault' | 'activeVersion'>,
): string {
  const whose = s.task === null ? '' : s.followsDefault ? 'game’s · ' : 'edited · '
  return whose + (s.activeVersion === null ? 'none active' : `v${s.activeVersion}`)
}

export type WorkshopStep = 'library' | 'editor' | 'side'

/**
 * The workshop's steps on a phone, in order: the library, the editor, and on the right History
 * for an open script or the New script form for a new one.
 */
export function workshopSteps(scriptOpen: boolean): { id: WorkshopStep; label: string }[] {
  return [
    { id: 'library', label: 'Library' },
    { id: 'editor', label: 'Editor' },
    { id: 'side', label: scriptOpen ? 'History' : 'New script' },
  ]
}
