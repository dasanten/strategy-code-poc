import { DEFAULT_SCRIPTS } from '@csp/lang-wasm'
import { ScriptCode } from './parts.js'

export function ExamplesSection() {
  return (
    <>
      <p>
        The game's default scripts, as they are now: what residents run for a task you give them on
        the map, and Defend, which they run when struck. Each Player has their own copy to edit in
        the script editor; here they are to read.
      </p>
      {Object.entries(DEFAULT_SCRIPTS).map(([task, s]) => (
        <div key={task}>
          <h3>{s.name}</h3>
          <ScriptCode source={s.source} />
        </div>
      ))}
    </>
  )
}
