import { describe, expect, it } from 'vite-plus/test'

import { compileSites } from '../../src/structure/compile.ts'
import { collectionPreset, routesFor, sitePreset } from '../../src/structure/presets.ts'

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

  it('give docs a navigation by section, then by order', () => {
    const sites = compileSites({ site: sitePreset('docs', ['en'], 'en') }).sites

    expect(sites.get('site')?.collections.get('docs')?.navigation).toEqual({
      groupBy: 'section',
      groups: null,
      orderBy: 'order',
    })
  })
})
