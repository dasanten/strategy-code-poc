import { createElement, type FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScriptLibrary } from './ScriptLibrary.js'

const Workshop = ScriptLibrary as FC<{ open?: boolean }>
const html = (open: boolean) => renderToStaticMarkup(createElement(Workshop, { open }))

describe('the script workshop', () => {
  it('is a screen with Back to the map, the Wiki’s help, the library, editor and side', () => {
    const page = html(true)
    expect(page).toContain('aria-label="Script workshop"')
    expect(page).not.toMatch(/<section[^>]*hidden/)
    expect(page).toContain('Back to the map')
    expect(page).toContain('Script language')
    expect(page).toContain('Game API')
    expect(page).toContain('aria-label="Script library"')
    expect(page).toContain('class="editor"')
    // Before a script is picked, the right side is the New script form.
    expect(page).toContain('Start from')
    expect(page).toContain('aria-label="Script name"')
  })

  it('stays mounted while closed, hidden', () => {
    expect(html(false)).toMatch(/<section[^>]*hidden/)
  })

  it('opens on the library step, for a phone', () => {
    expect(html(true)).toContain('data-step="library"')
  })
})
