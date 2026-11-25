import type { ReactNode } from 'react'
import { highlightScript } from './wiki-code.js'

/** A topic's panel, with its own anchor (`/wiki#food`). */
export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="wiki-section pn">
      <h2 className="hd">
        <a className="grow" href={`#${id}`}>
          {title}
        </a>
        <span className="mono small" aria-hidden="true">
          #{id}
        </span>
      </h2>
      <div className="wiki-text">{children}</div>
    </section>
  )
}

/** A table in the kit's style; on a narrow screen it scrolls sideways instead of squeezing. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="wiki-table">
      <table className="tb">{children}</table>
    </div>
  )
}

/** A script example in the script workshop's colours. */
export function ScriptCode({ source }: { source: string }) {
  return (
    <pre className="code wiki-code">
      <code>
        {highlightScript(source).map((p, i) =>
          p.kind ? (
            <span key={i} className={p.kind}>
              {p.text}
            </span>
          ) : (
            p.text
          ),
        )}
      </code>
    </pre>
  )
}

/** Plain words with `backticks` around code, as the scripting topics write them. */
export function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}
