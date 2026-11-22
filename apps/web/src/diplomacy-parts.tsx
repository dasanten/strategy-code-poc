import type { ReactNode } from 'react'

/** A group's head in a Diplomacy tab: its label and how many are in it ("Sent to you · 1"). */
export function GroupHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="rw grp">
      <span className="lb grow">{children}</span>
      {count !== undefined && <span className="mono">{count}</span>}
    </div>
  )
}

/**
 * One of a few choices as a row of pressed buttons (the kit's radio look), for a form's "What"
 * (`aria-label`): each option's label, and which one is picked.
 */
export function Choice<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="fx dip-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'btn sm grow on' : 'btn sm grow'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
