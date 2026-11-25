import { describe, expect, it } from 'vite-plus/test'
import { visibleDocument } from '../app/lib/visible-document.ts'

describe('visibleDocument', () => {
  it('turns a component and its named slots into blocks a reader can see, with its name and props', () => {
    const document = {
      nodes: [
        [
          'hero',
          { tone: 'dark', ':columns': 3 },
          ['template', { name: 'title' }, 'Tu matriz, ', ['strong', {}, 'viva']],
          ['template', { name: 'default' }, 'Evalúa el riesgo.'],
        ],
      ],
      frontmatter: { title: 'Gestión de riesgos' },
      meta: {},
    }

    expect(visibleDocument(document)).toEqual({
      nodes: [
        [
          'section',
          { class: 'hw-preview-block', 'data-component': 'hero' },
          ['p', { class: 'hw-preview-name' }, 'hero tone=dark columns=3'],
          [
            'div',
            { class: 'hw-preview-slot', 'data-slot': 'title' },
            ['p', { class: 'hw-preview-slot-name' }, '#title'],
            'Tu matriz, ',
            ['strong', {}, 'viva'],
          ],
          ['div', { class: 'hw-preview-slot', 'data-slot': 'default' }, 'Evalúa el riesgo.'],
        ],
      ],
      frontmatter: { title: 'Gestión de riesgos' },
      meta: {},
    })
  })

  it('keeps HTML elements as they are and reaches the components nested in them', () => {
    const document = {
      nodes: [
        ['p', {}, 'Antes ', ['badge', {}, 'nuevo']],
        ['cards', {}, ['card', { icon: 'bot' }, ['p', {}, 'Agentes']]],
      ],
    }

    expect(visibleDocument(document)).toEqual({
      nodes: [
        [
          'p',
          {},
          'Antes ',
          ['span', { class: 'hw-preview-inline', 'data-component': 'badge' }, 'nuevo'],
        ],
        [
          'section',
          { class: 'hw-preview-block', 'data-component': 'cards' },
          ['p', { class: 'hw-preview-name' }, 'cards'],
          [
            'section',
            { class: 'hw-preview-block', 'data-component': 'card' },
            ['p', { class: 'hw-preview-name' }, 'card icon=bot'],
            ['p', {}, 'Agentes'],
          ],
        ],
      ],
    })
  })

  it('answers what is not a document unchanged', () => {
    expect(visibleDocument(null)).toBe(null)
  })
})
