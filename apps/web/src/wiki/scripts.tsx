import {
  SCRIPT_ACTION_COST,
  SCRIPT_LIBRARY_MAX_SCRIPTS,
  SCRIPT_LIST_QUERY_COST,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_MAX_VERSIONS,
  SCRIPT_MAX_LIST_LENGTH,
  SCRIPT_MAX_OBJECT_KEYS,
  SCRIPT_MAX_STRING_LENGTH,
  SCRIPT_LOG_LINES,
  SCRIPT_ACTION_VALUE_MAX,
  SCRIPT_MEMORY_MAX,
  SCRIPT_STEP_BUDGET,
  SCRIPT_TILE_QUERY_COST,
} from '@csp/balance'
import { num } from './wiki-view.js'

export function ScriptsSection() {
  return (
    <>
      <p>
        Scripts run once a tick (a real second) for each resident or army running them. Each
        evaluated step costs one; asking for a list of things costs {num(SCRIPT_LIST_QUERY_COST)}{' '}
        more, a question about a tile {num(SCRIPT_TILE_QUERY_COST)} more, and requesting an action{' '}
        {num(SCRIPT_ACTION_COST)} more. Declaring a function costs nothing; calling it costs the
        steps of the call and of what the function does.
      </p>
      <ul>
        <li>Each resident's or army's script: {num(SCRIPT_STEP_BUDGET)} steps a tick.</li>
        <li>Function calls nest at most {num(SCRIPT_MAX_CALL_DEPTH)} deep.</li>
        <li>A script's memory holds at most {num(SCRIPT_MEMORY_MAX)} characters of JSON.</li>
        <li>
          A value passed to an action or <code>withMemory</code> holds at most{' '}
          {num(SCRIPT_ACTION_VALUE_MAX)} characters of JSON.
        </li>
        <li>
          One value a script builds is bounded: a string holds at most{' '}
          {num(SCRIPT_MAX_STRING_LENGTH)} characters, a list {num(SCRIPT_MAX_LIST_LENGTH)} items and
          an object {num(SCRIPT_MAX_OBJECT_KEYS)} keys. Past that the script stops with a runtime
          error, like a call too deep.
        </li>
      </ul>
      <p>
        Your script library has its caps too: it holds at most {num(SCRIPT_LIBRARY_MAX_SCRIPTS)}{' '}
        scripts, your default scripts among them, and each script keeps at most{' '}
        {num(SCRIPT_MAX_VERSIONS)} versions. A save past either is refused and says so next to the
        Save button: delete old versions, or whole scripts, to make room. The versions the game adds
        to a default script you haven’t edited don’t count against you.
      </p>
      <p>
        To debug a script, open the Script tab of a resident or army running it: it shows the
        script's memory and params as they are now, changing every tick. You can't change memory
        there. Only you see the memory of your scripts; a large one is shown cut.
      </p>
      <p>
        The Script tab also shows the steps the script used last tick out of its{' '}
        {num(SCRIPT_STEP_BUDGET)}, marked when it ran out, and its last runtime error with the line
        and how long ago. The error stays until the script ends or you save a new version; click it
        to open that line in the script workshop. Errors still go into the realm log as well. Should
        the game itself hit an error running a script, that script ends as if it had called{' '}
        <code>end()</code>, your realm log says so once, and everything else goes on.
      </p>
      <p>
        The Script tab of your resident also shows their script log, newest first: the lines their
        scripts gave <code>log(text)</code> and the reasons they gave <code>end(reason)</code>, each
        with its game time. A resident keeps their last {num(SCRIPT_LOG_LINES)} lines across
        scripts, so it still shows why the last one ended after it did; once full, the oldest line
        goes. Only you see it: it never goes in the realm log, to other Players or to scripts. The
        game’s default scripts log their decisions and turns, never every tick, like “pile full:
        carrying 10 stone to the storage at 12,6” or “low on Food (2): fetching 6 at the storage at
        12,6”.
      </p>
    </>
  )
}
