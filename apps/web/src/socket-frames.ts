// What arrives on the game's WebSocket (ADR 0034): large messages come as binary frames of
// gzipped JSON, small ones as text; and what a close code means for the tab.
import {
  WS_CLOSE_LOGGED_OUT,
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_CLOSE_UPDATED,
} from './shared/protocol.js'

/** A data frame as the browser hands it over (`binaryType` 'arraybuffer', or a Blob). */
export type Frame = string | ArrayBuffer | Blob

/** The JSON a frame holds: a text frame's own, a binary frame's gunzipped. */
export async function frameText(data: Frame): Promise<string> {
  if (typeof data === 'string') return data
  const blob = data instanceof Blob ? data : new Blob([data])
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

/**
 * Hands each frame's JSON to `apply` in the order the frames arrived. Gunzipping is asynchronous
 * and starts at once, so a text frame that came after a binary one waits for it: a tick is never
 * applied before the welcome ahead of it. A frame that cannot be read is reported and skipped.
 */
export function inArrivalOrder(
  apply: (text: string) => void,
  decode: (data: Frame) => Promise<string> = frameText,
  onError: (err: unknown) => void = (err) => console.error('unreadable message', err),
): (data: Frame) => void {
  let last: Promise<void> = Promise.resolve()
  return (data) => {
    const text = decode(data)
    // `last` never rejects: a failure is reported here, so it never stalls the frames after it.
    last = last
      .then(() => text)
      .then(apply)
      .catch(onError)
  }
}

/** What the client does when its socket closes. */
export type OnClose =
  /** The game was updated since the tab loaded: show the Reload dialog, do not reconnect. */
  | 'updated'
  /** The session ended: the login screen. */
  | 'loggedOut'
  /** It sent too much: reconnect after a wait. */
  | 'throttled'
  /** Anything else: check the session and reconnect. */
  | 'reconnect'

export function onClose(code: number): OnClose {
  if (code === WS_CLOSE_UPDATED) return 'updated'
  if (code === WS_CLOSE_LOGGED_OUT) return 'loggedOut'
  if (code === WS_CLOSE_TOO_MANY_REQUESTS) return 'throttled'
  return 'reconnect'
}
