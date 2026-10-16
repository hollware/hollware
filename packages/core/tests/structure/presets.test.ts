import { describe, expect, it } from 'vite-plus/test'

import { compileSites } from '../../src/structure/compile.ts'
import { collectionPreset, routesFor, sitePreset } from '../../src/structure/presets.ts'

// Fails when: a preset (src/structure/presets.ts) stops being a definition the server
// compiles, for one locale and for two; stops routing the default locale at the root and the
// others under their own; or a blog of two locales stops having translations and their rule.

describe('presets', () => {
  it('compile on the server, for one locale and for two', () => {
    for (const preset of ['blog', 'docs', 'empty'] as const) {
      for (const locales of [['en'], ['es', 'en']]) {
        const sites = compileSites({ site: sitePreset(preset, locales, locales[0] ?? 'en') }).sites
        expect(sites.get('site')?.locales).toEqual(locales)
      }
    }
  })

  it('route the default locale at the root and the others under their own', () => {
    expect(routesFor('blog', ['es', 'en'], 'es')).toEqual({
      es: '/blog/:slug/',
      en: '/en/blog/:slug/',
    })
  })

  it('give a blog of two locales its translations, and one of a locale none', () => {
    const two = collectionPreset('blog', 'blog', ['es', 'en'], 'es')
    const one = collectionPreset('blog', 'blog', ['es'], 'es')

    expect([two.translationGroupField, two.rules.map((rule) => rule.rule)]).toEqual([
      'translationGroup',
      ['images-have-alt', 'internal-links-resolve', 'translation-pair'],
    ])
    expect([one.translationGroupField, one.rules.length]).toEqual([null, 2])
  })
})
