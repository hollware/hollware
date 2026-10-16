import { describe, expect, it } from 'vite-plus/test'

import { readText } from '../support/repo.ts'

// Fails when: hollware.com (apps/web), the admin (packages/admin) and the pages the Worker renders
// to sign in (packages/server/src/identity/pages.ts) stop sharing one look: the theme blocks of the
// two stylesheets differ, or lose Inter, JetBrains Mono or the dark ground of neutral-950; the
// Nuxt UI colors of the two configs differ from black as primary, emerald and neutral; either
// one gets a light theme back (a switch of color mode, or a page without the class `dark`); or the
// sign-in pages answer the light of a device, or take another ground or primary than the theme's.

const SITE_CSS = 'apps/web/app/assets/css/main.css'
const ADMIN_CSS = 'packages/admin/app/app.css'
const SITE_CONFIG = 'apps/web/app/app.config.ts'
const ADMIN_CONFIG = 'packages/admin/vite.app.config.ts'
const PAGES = 'packages/server/src/identity/pages.ts'

/** The theme block of a stylesheet: what lies between `theme:start` and `theme:end`. */
export function themeOf(css: string): string | null {
  return /\/\* theme:start[\s\S]*?\/\* theme:end \*\//.exec(css)?.[0] ?? null
}

const COLORS = "colors: { primary: 'neutral', secondary: 'emerald', neutral: 'neutral' }"

describe('the look of Hollware', () => {
  it('is one theme block in the site and in the admin: Inter, JetBrains Mono, a neutral-950 ground', () => {
    const site = themeOf(readText(SITE_CSS))
    const admin = themeOf(readText(ADMIN_CSS))

    expect(admin).toBe(site)
    expect(site).toContain("--font-sans: 'Inter Variable'")
    expect(site).toContain("--font-mono: 'JetBrains Mono Variable'")
    expect(site).toContain('--ui-bg: var(--ui-color-neutral-950);')
    expect(site).toContain('--ui-primary: white;')
  })

  it('is one set of Nuxt UI colors, with subtle inputs, in both configs', () => {
    for (const config of [readText(SITE_CONFIG), readText(ADMIN_CONFIG)]) {
      expect(config).toContain(COLORS)
      expect(config).toContain("input: { defaultVariants: { variant: 'subtle' } }")
    }
  })

  it('is dark only: no switch of color mode, and the class dark on every page', () => {
    const sources = [
      readText('apps/web/app/components/AppHeader.vue'),
      readText('packages/admin/app/App.vue'),
    ]
    for (const source of sources) expect(source).not.toContain('ColorMode')
    expect(readText('apps/web/nuxt.config.ts')).toContain(
      "htmlAttrs: { lang: 'en', class: 'dark' }",
    )
    expect(readText('apps/web/nuxt.config.ts')).toContain('ui: { colorMode: false }')
    expect(readText('packages/admin/app/index.html')).toContain('<html lang="en" class="dark">')
    expect(readText(ADMIN_CONFIG)).toContain('colorMode: false')
  })

  it('gives the sign-in pages the dark ground and the white primary of the theme', () => {
    const pages = readText(PAGES)

    expect(pages).toContain(':root{color-scheme:dark;--bg:#0a0a0a;')
    expect(pages).toContain('--accent:#fafafa;')
    expect(pages).not.toContain('prefers-color-scheme')
  })

  it('reads the theme block, and nothing around it', () => {
    expect(themeOf('a /* theme:start x */ b /* theme:end */ c')).toBe(
      '/* theme:start x */ b /* theme:end */',
    )
    expect(themeOf('no block')).toBeNull()
  })
})
