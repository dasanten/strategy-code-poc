import { useEffect, useRef } from 'react'

/**
 * Saved groups (`CONTEXT.md`: Group): Ctrl+1–9 saves the residents picked on the map under that
 * number, 1–9 picks them again, and pressing the number twice quickly centres the map on them.
 * They are kept per browser, not in the world, so they cost the server nothing.
 */

/** The numbers a group can be saved under. */
export const GROUP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
export type GroupSlot = (typeof GROUP_SLOTS)[number]

/** The saved groups: each number's residents, by id, in the order they were picked. */
export type SavedGroups = Partial<Record<GroupSlot, string[]>>

/** How soon a second press of the same number counts as a double press, in milliseconds. */
export const DOUBLE_PRESS_MS = 400

/** What a key press asks for: save the picked residents as a group, or pick a group again. */
export type GroupKey = { save: boolean; slot: GroupSlot }

/**
 * The group key a key press is, if any: a number key 1–9 (top row or keypad, read by its place so
 * every keyboard layout works) alone, or with Ctrl to save. Other modifiers leave it to the
 * browser, such as Cmd+1 for tabs on a Mac.
 */
export function groupKey(e: {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): GroupKey | undefined {
  if (e.metaKey || e.altKey || e.shiftKey) return undefined
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (!m) return undefined
  return { save: e.ctrlKey, slot: Number(m[1]) as GroupSlot }
}

/** The groups with `ids` saved under `slot`; saving nobody forgets the group. */
export function saveGroup(
  groups: SavedGroups,
  slot: GroupSlot,
  ids: readonly string[],
): SavedGroups {
  const next = { ...groups }
  if (ids.length) next[slot] = [...new Set(ids)]
  else delete next[slot]
  return next
}

/**
 * A group picked again: those of its residents the Player still gives orders to (`own`), and the
 * groups with the others dropped out, as dead residents and ones no longer theirs leave it.
 * `ids` is undefined when nothing was saved under the number.
 */
export function recallGroup(
  groups: SavedGroups,
  slot: GroupSlot,
  own: ReadonlySet<string>,
): { ids: string[] | undefined; groups: SavedGroups } {
  const saved = groups[slot]
  if (!saved) return { ids: undefined, groups }
  const ids = saved.filter((id) => own.has(id))
  if (ids.length === saved.length) return { ids, groups }
  return { ids, groups: saveGroup(groups, slot, ids) }
}

/** Whether a press of `slot` at `now` is the second of a double press after `last`. */
export function isDoublePress(
  last: { slot: GroupSlot; at: number } | undefined,
  slot: GroupSlot,
  now: number,
): boolean {
  return !!last && last.slot === slot && now - last.at <= DOUBLE_PRESS_MS
}

/** Where the browser keeps a realm's saved groups. */
export const groupsKey = (realm: string) => `csp.groups.${realm}`

/** The saved groups read back from storage; none when it holds nothing usable. */
export function parseGroups(text: string | null): SavedGroups {
  if (!text) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const groups: SavedGroups = {}
  for (const slot of GROUP_SLOTS) {
    const ids = (raw as Record<string, unknown>)[slot]
    if (!Array.isArray(ids)) continue
    const kept = ids.filter((id): id is string => typeof id === 'string')
    if (kept.length) groups[slot] = kept
  }
  return groups
}

/** The saved groups this browser remembers for a realm; none without storage. */
export function loadGroups(storage: Pick<Storage, 'getItem'> | undefined, realm: string) {
  try {
    return parseGroups(storage?.getItem(groupsKey(realm)) ?? null)
  } catch {
    return {}
  }
}

/** Remembers a realm's saved groups in this browser; without storage they last until reload. */
export function storeGroups(
  storage: Pick<Storage, 'setItem'> | undefined,
  realm: string,
  groups: SavedGroups,
) {
  try {
    storage?.setItem(groupsKey(realm), JSON.stringify(groups))
  } catch {
    // Without storage they just aren't remembered.
  }
}

/** The browser's storage, if the page may use it. */
function browserStorage(): Storage | undefined {
  try {
    return localStorage
  } catch {
    return undefined
  }
}

/**
 * Listens for the group keys while the game shows: Ctrl+1–9 saves `picked` under the number, 1–9
 * picks that group again through `select` (with those gone dropped out), and a second quick press
 * also `centre`s the map on its first resident. Keys typed into a field are left alone.
 */
export function useSavedGroups(
  realm: string | undefined,
  picked: readonly string[],
  own: readonly { id: string; x: number; y: number }[],
  select: (ids: string[]) => void,
  centre: (x: number, y: number) => void,
) {
  const latest = useRef({ realm, picked, own, select, centre })
  latest.current = { realm, picked, own, select, centre }
  useEffect(() => {
    let last: { slot: GroupSlot; at: number } | undefined
    const onKey = (e: KeyboardEvent) => {
      const { realm, picked, own, select, centre } = latest.current
      const key = groupKey(e)
      if (!key || !realm || e.repeat) return
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (typing) return
      e.preventDefault()
      const groups = loadGroups(browserStorage(), realm)
      if (key.save) {
        storeGroups(browserStorage(), realm, saveGroup(groups, key.slot, picked))
        last = undefined
        return
      }
      const ownById = new Map(own.map((r) => [r.id, r]))
      const recalled = recallGroup(groups, key.slot, new Set(ownById.keys()))
      if (!recalled.ids) return
      if (recalled.groups !== groups) storeGroups(browserStorage(), realm, recalled.groups)
      select(recalled.ids)
      const now = e.timeStamp
      const first = recalled.ids[0] && ownById.get(recalled.ids[0])
      if (first && isDoublePress(last, key.slot, now))
        centre(Math.floor(first.x), Math.floor(first.y))
      last = { slot: key.slot, at: now }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
