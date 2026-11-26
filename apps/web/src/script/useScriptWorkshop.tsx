import { useState } from 'react'
import type { ScriptSummary } from '@csp/shared-types'
import { type ScriptToOpen } from './ScriptLibrary.js'
import { ScriptMemoryTree } from './ScriptMemory.js'
import { ScriptRunInfo } from './ScriptRun.js'
import { useWorld } from '../world/useWorld.js'

/**
 * The script workshop's part of the game (ADR 0044): the script library's list, which the cards
 * and the realm orders run scripts from, the script to open in it, and the live view of a script
 * a resident or army runs (`CONTEXT.md`: Debugging a script).
 */
export function useScriptWorkshop(
  {
    world,
    runs,
    memories,
    watchScript,
  }: Pick<ReturnType<typeof useWorld>, 'world' | 'runs' | 'memories' | 'watchScript'>,
  setOpenTab: (tab: 'scripts') => void,
) {
  // The script library's list, shared with the resident inspector's run-script order.
  const [scripts, setScripts] = useState<ScriptSummary[]>([])
  // A script to open in the library, such as the one a resident's task runs; `at` reopens it.
  const [scriptToOpen, setScriptToOpen] = useState<ScriptToOpen>()
  /** Opens a script in the script workshop, at a version and line when given. */
  const openScript = (id: number, where?: Omit<ScriptToOpen, 'id' | 'at'>) => {
    setScriptToOpen({ id, at: Date.now(), ...where })
    setOpenTab('scripts')
  }
  /**
   * The Script tab's live view of the script a resident or army runs (`CONTEXT.md`: Debugging a
   * script): how it last ran, and its memory.
   */
  const scriptRunInfo = (id: string, scriptId: number) => (
    <ScriptRunInfo
      run={runs.get(id)}
      tick={world?.tick ?? 0}
      onOpenError={({ version, line, column }) => openScript(scriptId, { version, line, column })}
    />
  )
  const scriptMemoryTree = (id: string) => (
    <ScriptMemoryTree id={id} memory={memories.get(id)} watch={watchScript} />
  )
  const scriptDebug = (id: string, scriptId: number) => (
    <>
      {scriptRunInfo(id, scriptId)}
      {scriptMemoryTree(id)}
    </>
  )
  return {
    scripts,
    setScripts,
    scriptToOpen,
    openScript,
    scriptRunInfo,
    scriptMemoryTree,
    scriptDebug,
  }
}
