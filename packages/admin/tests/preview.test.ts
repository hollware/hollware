import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { previewDocument } from '../app/lib/preview.ts'

// Fails when: the preview of a draft (T-60) stops being a page of its own in a frame with an empty
// sandbox (Entry.vue), so the rendered HTML runs in the admin's page again, or stops sending no
// referrer, or stops taking the entry's locale as its language and nothing else.

const ENTRY = readFileSync(join(import.meta.dirname, '..', 'app', 'pages', 'Entry.vue'), 'utf8')

describe('the preview of a draft', () => {
  it('is the rendered HTML, as it is, in a page that sends no referrer, in the entry locale', () => {
    const page = previewDocument('<p>Hola <img src="https://img.example/a.png"></p>', 'es-CL')

    expect(
      page.startsWith(
        '<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>',
      ),
    ).toBe(true)
    expect(
      page.endsWith(
        '</style></head><body><p>Hola <img src="https://img.example/a.png"></p></body></html>',
      ),
    ).toBe(true)
  })

  it('says nothing it was not given as its language', () => {
    expect(previewDocument('', 'en" onload="x')).toContain('<html lang="und">')
  })

  it('is shown in a frame with an empty sandbox, and the admin prints no HTML of its own', () => {
    expect(ENTRY).toMatch(/<iframe\s+sandbox=""\s+referrerpolicy="no-referrer"/)
    expect(ENTRY).not.toContain('v-html')
  })
})
