import { expect, it, vi } from 'vitest'

/**
 * `packages/lang`'s own tests, run with its `checkScript`, `checkNames`, `scriptParams` and
 * `tokenize` swapped for the WebAssembly checker's (T88.3): what they assert of the TypeScript
 * holds of the build the editor runs. `parse` and `run` stay the TypeScript's. Goes with
 * `packages/lang` at the cutover.
 */
vi.mock('../../lang/src/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lang/src/index.js')>()
  const wasm = await import('./index.js')
  await wasm.loadLang()
  return {
    ...original,
    checkScript: wasm.checkScript,
    checkNames: wasm.checkNames,
    scriptParams: wasm.scriptParams,
    tokenize: (source: string) => {
      try {
        return wasm.tokenize(source)
      } catch (error) {
        if (!(error instanceof wasm.ScriptSyntaxError)) throw error
        throw new original.ScriptSyntaxError(error.message, error.line, error.column)
      }
    },
  }
})

await import('../../lang/src/checker.test.js')
await import('../../lang/src/params.test.js')
await import('../../lang/src/index.test.js')

it('runs them through the WebAssembly checker', async () => {
  const lang = await import('../../lang/src/index.js')
  const wasm = await import('./index.js')
  expect(lang.checkNames).toBe(wasm.checkNames)
  expect(lang.checkScript).toBe(wasm.checkScript)
})
