import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.7' },
  '.cm-content': { caretColor: 'var(--ui-primary)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ui-bg-elevated)',
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

const markdownColors = HighlightStyle.define([
  {
    tag: [tags.meta, tags.processingInstruction, tags.contentSeparator],
    color: 'var(--ui-text-muted)',
  },
  { tag: tags.heading, color: 'var(--ui-text-highlighted)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--ui-text-highlighted)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--ui-primary)' },
  { tag: tags.monospace, color: 'var(--ui-primary)' },
  { tag: [tags.quote, tags.comment], color: 'var(--ui-text-muted)' },
])

export const theme: Extension = [chrome, syntaxHighlighting(markdownColors)]
