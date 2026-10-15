import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** The colors of Nuxt UI's theme, light or dark, through its CSS variables. */
export const theme: Extension = EditorView.theme({
  '&': { backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)' },
  '.cm-content': { caretColor: 'var(--ui-text-highlighted)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ui-bg-elevated)',
    color: 'var(--ui-text-muted)',
    borderRight: '1px solid var(--ui-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--ui-bg-accented)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--ui-bg-accented)',
  },
  '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', color: 'var(--ui-text)' },
})
