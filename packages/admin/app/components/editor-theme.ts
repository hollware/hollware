import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** The colors of Nuxt UI's theme, light or dark, through its CSS variables. */
export const theme: Extension = EditorView.theme({
  '&': { backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)' },
  '.cm-content': { caretColor: 'var(--ui-text-highlighted)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ui-bg-elevated)',
    // Toned, not muted: the line numbers pass a contrast of 4.5:1 on both themes.
    color: 'var(--ui-text-toned)',
    borderRight: '1px solid var(--ui-border)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--ui-bg-accented)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--ui-bg-elevated)',
    color: 'var(--ui-text-highlighted)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--ui-bg-accented)',
  },
  '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', color: 'var(--ui-text)' },
})
