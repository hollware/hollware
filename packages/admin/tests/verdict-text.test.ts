import { describe, expect, it } from 'vite-plus/test'

import { en } from '../app/i18n/en.ts'
import { es } from '../app/i18n/es.ts'
import { explain } from '../app/lib/verdict-text.ts'

const tooShort = {
  contract: 'schema',
  code: 'schema.too_small',
  params: { field: 'description', minimum: 1, origin: 'string', length: 0 },
  message: 'Too small: expected string to have >=1 characters',
  fix: 'Set the field "description" to a string of 1 to 160 characters.',
}

describe('a problem the contracts find', () => {
  it('reads in Spanish from its code and params', () => {
    expect(explain(tooShort, es.verdictTexts)).toEqual({
      message: '«description» tiene 0 caracteres; el mínimo es 1.',
      fix: 'Escribe al menos 1 carácter en «description».',
    })
    expect(
      explain(
        {
          contract: 'raw-html',
          params: { tag: 'span', components: '' },
          message: 'Raw HTML is not allowed: the body has a <span> tag.',
          fix: 'Remove the HTML and use Markdown.',
        },
        es.verdictTexts,
      ),
    ).toEqual({
      message: 'No se permite HTML: el cuerpo tiene una etiqueta <span>.',
      fix: 'Quita el HTML y usa Markdown.',
    })
  })

  it('takes the words of its contract for a kind it has no words for', () => {
    expect(
      explain(
        { ...tooShort, code: 'schema.not_multiple_of', params: { field: 'order' } },
        es.verdictTexts,
      ),
    ).toEqual({
      message: '«order» no es válido.',
      fix: 'Revísalo según el esquema de la colección.',
    })
  })

  it('keeps the English of the server when there is nothing to say it with', () => {
    expect(explain(tooShort, en.verdictTexts)).toEqual({
      message: tooShort.message,
      fix: tooShort.fix,
    })
    expect(
      explain(
        { contract: 'my-own-rule', message: 'Too long.', fix: 'Shorten it.' },
        es.verdictTexts,
      ),
    ).toEqual({ message: 'Too long.', fix: 'Shorten it.' })
  })
})
