import { useCallback, useEffect, useState } from 'react'
import { closeOpenPanel, panelOpen } from './SelectionCard.js'
import { escapeStep } from './selection-view.js'
import {
  flipped,
  flipsControlMode,
  modeAfterPick,
  rememberControlMode,
  rememberedControlMode,
  type ControlMode,
} from '../realm/control-mode.js'

type Tile = { x: number; y: number }

/**
 * What the Player has picked (`CONTEXT.md`: Control mode, Group, Army): one state for the
 * control mode and what is picked in it, so a pick of one kind can let go of another.
 */
export interface Selection {
  /** Unit or realm control mode (`CONTEXT.md`: Control mode), kept per browser. */
  mode: ControlMode
  /** The residents picked on the map or in the list: one shows their card, several a group card. */
  residents: string[]
  /**
   * A tile picked on the map with no resident of the Player's on it; its card shows in the dock
   * beside the resident's (on a phone over it), who stays picked to be sent there.
   */
  tile?: Tile
  /**
   * The map's tile menu (`CONTEXT.md`: Waypoint): the tile right-clicked or long-pressed with
   * nothing else to do there, and where in the window it was pressed.
   */
  tileMenu?: Tile & { at: Tile }
  /** The army whose card is in the command bar, opened from the Armies tab (`CONTEXT.md`: Army). */
  army?: string
  /** The horse last picked in the Horses tab, to mark its row among others on the same tile. */
  horse?: string
}

/** What is picked, and the setters of each part (`Selection`). */
export function useSelection() {
  const [selection, setSelection] = useState<Selection>(() => ({
    mode: rememberedControlMode(),
    residents: [],
  }))
  const part = useCallback(
    <K extends keyof Selection>(key: K) =>
      (value: Selection[K]) =>
        setSelection((s) => (s[key] === value ? s : { ...s, [key]: value })),
    [],
  )
  const setters = useState(() => ({
    setSelectedIds: part('residents'),
    setSelectedTile: part('tile'),
    setTileMenu: part('tileMenu'),
    setOpenArmyId: part('army'),
    setPickedHorseId: part('horse'),
  }))[0]
  const setControlMode = useCallback((mode: ControlMode) => {
    setSelection((s) => (s.mode === mode ? s : { ...s, mode }))
    rememberControlMode(mode)
  }, [])
  const closeTileMenu = useCallback(() => setters.setTileMenu(undefined), [setters])
  // One card in the command bar at a time: a resident or group picked closes the army's.
  const picked = selection.residents.length
  useEffect(() => {
    if (picked > 0) setters.setOpenArmyId(undefined)
  }, [picked, setters])
  return {
    selectedIds: selection.residents,
    selectedTile: selection.tile,
    tileMenu: selection.tileMenu,
    openArmyId: selection.army,
    pickedHorseId: selection.horse,
    controlMode: selection.mode,
    setControlMode,
    closeTileMenu,
    ...setters,
  }
}

/**
 * Picking a resident, a group or an army some other way than a map click (the Residents list,
 * a saved group's key, the Armies tab, a notice) switches to unit control mode.
 */
export function useModeAfterPick(
  s: Pick<ReturnType<typeof useSelection>, 'controlMode' | 'selectedIds' | 'setControlMode'>,
  pickedArmy: boolean,
) {
  const { controlMode, setControlMode } = s
  const residents = s.selectedIds.length
  useEffect(() => {
    const next = modeAfterPick(controlMode, { residents, army: pickedArmy })
    if (next !== controlMode) setControlMode(next)
  }, [controlMode, residents, pickedArmy, setControlMode])
}

/**
 * Tab flips the control mode, unless the Player is typing or in a dialog, where it moves on
 * as ever (`CONTEXT.md`: Control mode).
 */
export function useControlModeKey(controlMode: ControlMode, switchTo: (mode: ControlMode) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element &&
        e.target.closest('input, textarea, select, .cm-editor, [aria-modal="true"]') !== null
      const { key, ctrlKey, metaKey, altKey, shiftKey } = e
      if (!flipsControlMode({ key, ctrlKey, metaKey, altKey, shiftKey, typing })) return
      e.preventDefault()
      switchTo(flipped(controlMode))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controlMode, switchTo])
}

/** What is open, top-most first, as Escape goes through it (`useEscapeOrder`). */
interface EscapeOpen {
  picked: boolean
  formOpen: boolean
  /** The card is in front, not hidden behind the script workshop or the full list. */
  shownCard: boolean
  tileOpen: boolean
  anySelected: boolean
  /** The realm order's Build menu or who-list, which Escape closes as it does a card. */
  realmCard: boolean
  armyOpen: boolean
}

/**
 * Escape leaves the top-most thing first: pick mode, an open panel (the form before a script
 * starts among them), the tile card, the resident or group card, then the open sidebar tab. A card
 * hidden behind the script workshop or the full list is passed over, so Escape closes what is
 * in front of it.
 */
export function useEscapeOrder(
  open: EscapeOpen,
  close: { pick: () => void; form: () => void; tile: () => void; cards: () => void },
) {
  const { picked, formOpen, shownCard, tileOpen, anySelected, realmCard, armyOpen } = open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof Element && e.target.closest('input, textarea, select, .cm-editor')
      if (e.key !== 'Escape' || typing) return
      const step = escapeStep({
        pick: picked,
        panel: formOpen || (shownCard && panelOpen()),
        tile: shownCard && tileOpen,
        card: shownCard && (anySelected || realmCard || armyOpen),
      })
      // With nothing else open, the sidebar's own Escape closes it.
      if (!step) return
      // Ahead of the sidebar's own Escape, which would close it too.
      e.stopImmediatePropagation()
      if (step === 'pick') return close.pick()
      if (step === 'panel') {
        if (formOpen) return close.form()
        return closeOpenPanel()
      }
      if (step === 'tile') return close.tile()
      close.cards()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
    // As before the move: the handler is set anew when what is open changes.
  }, [anySelected, realmCard, armyOpen, picked, formOpen, tileOpen, shownCard, close.pick])
}
