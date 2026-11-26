import { loadLang, WorldMirror } from '@csp/lang-wasm'

/**
 * The client's world in the rules module (ADR 0045, T122.4): `useWorld` hands every `welcome` and
 * `tick` message's text here as it arrives, once, and the rules read the mirror by ids and
 * coordinates (`docs/wasm-rules.md`). Until the module has loaded, the latest `welcome` and the
 * ticks after it wait, then go in in order.
 */

let mirror: WorldMirror | undefined
/** What came before the module loaded: the latest welcome and every tick after it. */
let waiting: string[] = []
let loading: Promise<void> | undefined
/** Whether a welcome went into the mirror. */
let welcomed = false

/** Takes in a message from the server, by its `type`, as the text the socket brought. */
export function feedMirror(type: string, text: string): void {
  if (type !== 'welcome' && type !== 'tick') return
  if (!mirror) {
    // A tick before any welcome has nothing to apply to.
    if (type === 'welcome') waiting = [text]
    else if (waiting.length > 0) waiting.push(text)
    loading ??= loadLang().then(start, (e: unknown) => console.error('rules module', e))
    return
  }
  apply(mirror, type, text)
}

function start(): void {
  mirror = new WorldMirror()
  for (const text of waiting)
    apply(mirror, text.startsWith('{"type":"welcome"') ? 'welcome' : 'tick', text)
  waiting = []
}

function apply(m: WorldMirror, type: 'welcome' | 'tick', text: string): void {
  try {
    if (type === 'welcome') {
      m.welcome(text)
      welcomed = true
    } else m.tick(text)
  } catch (e) {
    // A message the mirror can't read changes nothing; the next welcome starts it over.
    console.error(`rules module: the ${type} message`, e)
  }
}

/**
 * Starts the mirror over from a `welcome` message's text at once, for a test (`test-mirror.ts`);
 * the module must have loaded, as it has in Node. Without text, the mirror is gone.
 */
export function mirrorWelcome(text?: string): void {
  waiting = []
  welcomed = false
  if (text === undefined) return
  // The same mirror starts over, as from the server's next welcome: its lookups are built again.
  mirror ??= new WorldMirror()
  mirror.welcome(text)
  welcomed = true
}

/** The mirror, once the module has loaded and a welcome went in. */
export function worldMirror(): WorldMirror | undefined {
  return mirror && welcomed ? mirror : undefined
}
