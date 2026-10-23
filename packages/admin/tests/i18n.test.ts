import { describe, expect, it } from 'vite-plus/test'

import { initialLocale } from '../app/i18n/index.ts'

describe('the language the admin starts in', () => {
  it('is the one chosen, whatever the browser asks for', () => {
    expect(initialLocale('es', ['en-US'])).toBe('es')
    expect(initialLocale('en', ['es-CL', 'es'])).toBe('en')
  })

  it('is else the first language of the browser that the admin speaks, or English', () => {
    expect(initialLocale(null, ['es-MX', 'en'])).toBe('es')
    expect(initialLocale(null, ['en-US', 'es'])).toBe('en')
    expect(initialLocale(null, ['fr-FR', 'es-AR', 'en'])).toBe('es')
    expect(initialLocale('fr', ['de-DE', 'ja'])).toBe('en')
  })
})
