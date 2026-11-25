import { withCode, ScriptCode } from './parts.js'
import { SCRIPT_LANGUAGE } from './wiki-scripting.js'

export function LanguageSection() {
  return (
    <>
      <p>
        Scripts are written in the game's own small language. It reads much like JavaScript, with
        less of it.
      </p>
      {SCRIPT_LANGUAGE.map((rule) => (
        <div key={rule.title}>
          <h3>{rule.title}</h3>
          <p>{withCode(rule.text)}</p>
          {rule.example && <ScriptCode source={rule.example} />}
        </div>
      ))}
    </>
  )
}
