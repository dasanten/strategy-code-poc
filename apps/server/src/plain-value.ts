import { NativeFunction, ScriptFunction, type Value } from '@csp/lang'

/**
 * A script value as the plain data it stands for, in one bounded walk (`CONTEXT.md`: Memory).
 *
 * Script lists and objects are shared by reference, so a value where each level points at the
 * previous one twice is built in a few steps per level but stands for a tree that doubles with
 * each level. Walking it as `JSON.stringify` does expands every shared reference and never
 * finishes; this walk counts the characters of the JSON it would make and gives up as soon as
 * they pass `max`, so it stays as cheap as the limit. Shared references within the limit are
 * fine and come out as separate copies. The objects on the current path are tracked, so a value
 * that holds itself is found instead of overflowing the stack.
 */

export type PlainValue =
  null | boolean | number | string | PlainValue[] | { [key: string]: PlainValue }

/** Why a value can't be plain data: it holds a function, holds itself, or is too large. */
export type NotPlain = 'function' | 'cycle' | 'size'

export type PlainResult =
  { ok: true; value: PlainValue; size: number } | { ok: false; why: NotPlain }

/** `value` as plain data within `max` characters of JSON, or why it can't be. */
export function plainValue(value: Value, max: number): PlainResult {
  const path = new Set<object>()
  let size = 0
  let why: NotPlain | undefined

  const walk = (v: Value): PlainValue => {
    if (v === null) {
      size += 4
      return null
    }
    if (typeof v === 'boolean') {
      size += v ? 4 : 5
      return v
    }
    if (typeof v === 'number') {
      // JSON has no NaN or Infinity; `JSON.stringify` writes null for them.
      if (!Number.isFinite(v)) {
        size += 4
        return null
      }
      size += String(v).length
      return v
    }
    if (typeof v === 'string') {
      size += JSON.stringify(v).length
      return v
    }
    if (v instanceof NativeFunction || v instanceof ScriptFunction) {
      why = 'function'
      return null
    }
    if (path.has(v)) {
      why = 'cycle'
      return null
    }
    path.add(v)
    let out: PlainValue
    if (Array.isArray(v)) {
      size += 2 + Math.max(0, v.length - 1)
      const list: PlainValue[] = []
      for (const item of v) {
        if (size > max) why = 'size'
        if (why !== undefined) break
        list.push(walk(item))
      }
      out = list
    } else {
      const entries = Object.entries(v)
      size += 2 + Math.max(0, entries.length - 1)
      const object: { [key: string]: PlainValue } = {}
      for (const [key, item] of entries) {
        size += JSON.stringify(key).length + 1
        if (size > max) why = 'size'
        if (why !== undefined) break
        object[key] = walk(item)
      }
      out = object
    }
    path.delete(v)
    return out
  }

  const plain = walk(value)
  if (why === undefined && size > max) why = 'size'
  return why === undefined ? { ok: true, value: plain, size } : { ok: false, why }
}
