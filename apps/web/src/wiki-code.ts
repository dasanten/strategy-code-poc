import { StringStream } from '@codemirror/language'
import { scriptHighlighting } from './script-editor.js'

/**
 * A piece of a script example as the Wiki shows it, in the script workshop's colours (the kit's
 * `.code` atom): `kind` is the class of its colour, none for names, operators and spaces.
 */
export type CodePiece = { text: string; kind?: 'c' | 'kw' | 's' | 'n' }

/** The editor's token styles as the kit's code classes. */
const KINDS: Record<string, CodePiece['kind']> = {
  comment: 'c',
  keyword: 'kw',
  string: 's',
  number: 'n',
  atom: 'n',
}

/**
 * A script cut into coloured pieces by the editor's own highlighting (`scriptHighlighting`), so a
 * Wiki example reads as it would in the script workshop. Joined, the pieces are the source again.
 */
export function highlightScript(source: string): CodePiece[] {
  const state = scriptHighlighting.startState!(2)
  const pieces: CodePiece[] = []
  const push = (text: string, kind: CodePiece['kind']) => {
    if (!text) return
    const last = pieces[pieces.length - 1]
    if (last && last.kind === kind) last.text += text
    else pieces.push(kind ? { text, kind } : { text })
  }
  source.split('\n').forEach((line, i) => {
    if (i > 0) push('\n', undefined)
    const stream = new StringStream(line, 4, 2)
    while (!stream.eol()) {
      const style = scriptHighlighting.token(stream, state)
      push(line.slice(stream.start, stream.pos), style ? KINDS[style] : undefined)
      stream.start = stream.pos
    }
  })
  return pieces
}
