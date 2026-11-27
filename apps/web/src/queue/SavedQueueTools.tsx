import { useState, type FormEvent } from 'react'
import { stepCount, type PlanItem } from './plan-blocks.js'
import {
  browserStorage,
  list,
  load as loadQueue,
  readQueues,
  remove as removeQueue,
  save as saveQueue,
  storeQueues,
  type SavedQueues,
} from './saved-queues.js'

/**
 * Save and Load for a queue planner (`CONTEXT.md`: Saved queue): Save keeps `steps` in this
 * browser under a name, asking before it overwrites one saved under the same name; Load lists the
 * saved queues, each with its step count as written and date, to load (`onLoad` gets fresh
 * copies of its steps and blocks) or delete. With no steps, only Load shows.
 */
export function SavedQueueTools({
  realm,
  steps,
  onLoad,
  oneButton = false,
}: {
  realm: string
  steps: readonly PlanItem[]
  onLoad: (steps: PlanItem[]) => void
  /** One "Saved…" button opening both, for the planner's one-row toolbar. */
  oneButton?: boolean
}) {
  const [open, setOpen] = useState<'save' | 'load' | 'both'>()
  const [name, setName] = useState('')
  const [queues, setQueues] = useState(() => readQueues(browserStorage(), realm))
  const keep = (next: SavedQueues) => {
    storeQueues(browserStorage(), realm, next)
    setQueues(next)
  }
  const toggle = (panel: 'save' | 'load' | 'both') => {
    // Read again: another planner may have saved since.
    setQueues(readQueues(browserStorage(), realm))
    setOpen(open === panel ? undefined : panel)
  }
  const saved = list(queues)
  const taken = name.trim() in queues
  const onSave = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    keep(saveQueue(queues, name, steps, Date.now()))
    setName('')
    setOpen(undefined)
  }
  return (
    <div className="saved-queues">
      <div className="order-buttons">
        {oneButton && (
          <button
            type="button"
            className="btn sm"
            title="Save these steps under a name, or load saved ones"
            aria-expanded={open === 'both'}
            onClick={() => toggle('both')}
          >
            Saved…
          </button>
        )}
        {!oneButton && steps.length > 0 && (
          <button
            type="button"
            className="btn sm"
            aria-expanded={open === 'save'}
            onClick={() => toggle('save')}
          >
            Save…
          </button>
        )}
        {!oneButton && (
          <button
            type="button"
            className="btn sm"
            aria-expanded={open === 'load'}
            onClick={() => toggle('load')}
          >
            Load…
          </button>
        )}
      </div>
      {(open === 'save' || (open === 'both' && steps.length > 0)) && (
        <form className="saved-queues-save well" onSubmit={onSave}>
          <input
            aria-label="Name to save the queue under"
            placeholder="Name, such as Mine run"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn sm" disabled={!name.trim()}>
            {taken ? 'Overwrite' : 'Save'}
          </button>
          {taken && (
            <span className="small muted">A queue is saved as “{name.trim()}”: overwrite it?</span>
          )}
        </form>
      )}
      {(open === 'load' || open === 'both') &&
        (saved.length === 0 ? (
          <p className="muted small saved-queues-none">No queues saved in this browser yet.</p>
        ) : (
          <ul className="saved-queues-list well">
            {saved.map((s) => (
              <li key={s.name}>
                <span className="small">
                  {s.name}{' '}
                  <span className="muted">
                    {stepCount(s.steps)} step{stepCount(s.steps) === 1 ? '' : 's'},{' '}
                    {new Date(s.savedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="buttons">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      onLoad(loadQueue(queues, s.name))
                      setOpen(undefined)
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Delete ${s.name}`}
                    onClick={() => keep(removeQueue(queues, s.name))}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
