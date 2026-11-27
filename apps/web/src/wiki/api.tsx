import type { ReactNode } from 'react'
import { DOING_MAX_LENGTH } from '@csp/balance'
import { SCRIPT_VIEWS } from '@csp/lang-wasm'
import type { ScriptType, ScriptViewName } from '@csp/shared-types'
import { apiNames } from '../script/script-editor.js'
import type { ApiName } from '../script/script-editor.js'
import { withCode, Table } from './parts.js'
import { num } from './wiki-view.js'

/** A script value's kind, a script view linking to where the Game API lists its fields. */
function typeNode(type: ScriptType): ReactNode {
  if (typeof type === 'string') return type
  if ('list' in type) return <>list of {typeNode(type.list)}</>
  return <a href={`#view-${type.view}`}>{type.view}</a>
}

/** How an API name is written: `me`, `walkTo(x, y)`. */
const callOf = (n: ApiName) => {
  const b = (n.resident ?? n.army)!
  return b.is === 'value' ? b.name : `${b.name}(${b.params.join(', ')})`
}

/** An API name's description, both where a resident's and an army's differ, and its mark. */
function apiDescription(n: ApiName): ReactNode {
  const r = n.resident
  const a = n.army
  const text =
    r && a && r.description !== a.description ? (
      <>
        Resident: {withCode(r.description)} Army: {withCode(a.description)}
      </>
    ) : (
      withCode((r ?? a)!.description)
    )
  return n.mark ? (
    <>
      <em>{n.mark}.</em> {text}
    </>
  ) : (
    text
  )
}

/** A table of the Game API's names of one kind: values, queries or actions. */
function ApiTable({ is }: { is: ApiName['is'] }) {
  const names = apiNames(false).filter((n) => n.is === is)
  return (
    <Table>
      <thead>
        <tr>
          <th>{is === 'value' ? 'Name' : 'Call'}</th>
          {is !== 'value' && <th>Cost</th>}
          <th>{is === 'value' ? 'Holds' : 'Answers'}</th>
          <th>What it does</th>
        </tr>
      </thead>
      <tbody>
        {names.map((n) => {
          const b = (n.resident ?? n.army)!
          // `me` holds a resident in a resident's script, an army in an army's.
          const holds =
            n.resident && n.army && n.is === 'value' && n.name === 'me' ? (
              <>
                {typeNode(n.resident.returns)} or {typeNode(n.army.returns)}
              </>
            ) : is === 'action' ? (
              'null, or why not'
            ) : (
              typeNode(b.returns)
            )
          return (
            <tr key={n.name}>
              <td>
                <code>{callOf(n)}</code>
              </td>
              {is !== 'value' && <td>+{num(b.cost)}</td>}
              <td>{holds}</td>
              <td>{apiDescription(n)}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export function ApiSection() {
  return (
    <>
      <p>
        What a script gets from the game. Values are read like names; queries and actions are
        called. Every call costs one step, and its cost here on top. Queries answer from what you
        see and have explored, nothing more; the helpers <code>floor</code> and{' '}
        <code>pickRandom</code> work only on what you give them. An action asks for the order of its
        name for <code>me</code>, checked exactly as one from the map, and answers <code>null</code>{' '}
        when asked for, or why not. Four actions ask for no order. <code>doing</code>: its text, at
        most {num(DOING_MAX_LENGTH)} characters, is what the resident card and list say the resident
        is doing, until the script says something else; only you see it. Without it they show what
        the task and its current order have the resident doing, such as “Building a house: fetching
        10 wood from the storage”. <code>end</code>: once this run is over the script ends and the
        resident stands idle; in a queue, its next step starts; a defence script hands back to what
        it interrupted. Given a reason, <code>end(reason)</code> also notes it in your realm log,
        like “Ana stopped Work: no workplace on her tile”: short text, cut like <code>doing</code>
        ’s, that only you see, for every end. <code>log</code>: adds a short line, cut like{' '}
        <code>doing</code>’s, to the resident's script log, with the game time. <code>wait</code>:
        once this run is over the script is not run again until the resident's order ends or is
        replaced, or they are struck; then it runs every tick again. With no order it does nothing.
        The defaults wait after every walk, store and fetch, and Breed horses while it tends, so a
        resident on the move costs no step; the resident card says “script waiting”, and an edited
        copy of a default waits just the same. The Build and Tear down defaults end once the site is
        finished or the building is gone; a script that never calls <code>end</code> runs until
        another order ends it. A script runs as a resident's or as an army's: names marked resident
        only or army only are only there for one of them, and a default script runs as a resident's.
      </p>
      <h3>Values</h3>
      <ApiTable is="value" />
      <h3>Queries</h3>
      <ApiTable is="query" />
      <h3>Actions</h3>
      <ApiTable is="action" />
      <h3>Script views</h3>
      <p>
        What a script gets of each kind of thing. Every field listed is always there; one you aren't
        allowed to see, or that doesn't apply, is <code>null</code>, as its last column says. A
        script sees no other fields. The game may add fields at any time; when one is renamed or
        removed, each Player whose scripts read it is told in their realm log, with the field and
        the scripts.
      </p>
      {(
        Object.entries(SCRIPT_VIEWS) as [ScriptViewName, (typeof SCRIPT_VIEWS)[ScriptViewName]][]
      ).map(([name, view]) => (
        <div key={name} id={`view-${name}`} className="wiki-section">
          <h4>
            <code>{name}</code>
          </h4>
          <p>{withCode(view.description)}</p>
          <Table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Holds</th>
                <th>What it is</th>
                <th>null</th>
              </tr>
            </thead>
            <tbody>
              {view.fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    <code>{f.name}</code>
                  </td>
                  <td>{typeNode(f.type)}</td>
                  <td>{withCode(f.description)}</td>
                  <td>{f.nullWhen ? withCode(f.nullWhen) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
    </>
  )
}
