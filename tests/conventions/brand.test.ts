import { describe, expect, it } from 'vite-plus/test'

import { readText } from '../support/repo.ts'

// Fails when: hollware.com (apps/web), the admin (packages/admin) and the pages the Worker renders
// to sign in (packages/server/src/identity/pages.ts) stop sharing the look of ADR-039: the theme
// blocks of the two stylesheets differ, or lose Schibsted Grotesk, JetBrains Mono, the Carbón ground
// or the flame amber; the Nuxt UI colors of the two configs differ from carbon, flame and carbon;
// either one gets a light theme back (a switch of color mode, or a page without the class `dark`);
// the sign-in pages answer the light of a device, or take another ground or accent than the theme's;
// or the mark of the favicon, the site's logo, the admin's logo and the sign-in pages is not one path
// in flame; or docs/brand.md names a color of the scales that the theme does not have.

const SITE_CSS = 'apps/web/app/assets/css/main.css'
const ADMIN_CSS = 'packages/admin/app/app.css'
const SITE_CONFIG = 'apps/web/app/app.config.ts'
const ADMIN_CONFIG = 'packages/admin/vite.app.config.ts'
const PAGES = 'packages/server/src/identity/pages.ts'
const FAVICON = 'apps/web/public/favicon.svg'

/** The theme block of a stylesheet: what lies between `theme:start` and `theme:end`. */
export function themeOf(css: string): string | null {
  return /\/\* theme:start[\s\S]*?\/\* theme:end \*\//.exec(css)?.[0] ?? null
}

/** The outline of the mark: the `d` of the favicon's one path, the source the others copy. */
export function markOf(svg: string): string | null {
  return /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1] ?? null
}

const COLORS = "colors: { primary: 'carbon', secondary: 'flame', neutral: 'carbon' }"

describe('the look of Hollware', () => {
  it('is one theme block in the site and in the admin: Schibsted Grotesk, Carbón and flame', () => {
    const site = themeOf(readText(SITE_CSS))
    const admin = themeOf(readText(ADMIN_CSS))

    expect(admin).toBe(site)
    expect(site).toContain("'Schibsted Grotesk Variable'")
    expect(site).toContain("--font-mono: 'JetBrains Mono Variable'")
    expect(site).toContain('--color-carbon-950: #0e0c0a;')
    expect(site).toContain('--color-flame-400: #f0a93b;')
    expect(site).toContain('--ui-bg: var(--ui-color-neutral-950);')
    // The font is the package's, imported in both stylesheets: nothing is fetched from another origin.
    for (const css of [readText(SITE_CSS), readText(ADMIN_CSS)]) {
      expect(css).toContain("@import '@fontsource-variable/schibsted-grotesk';")
    }
  })

  it('is one set of Nuxt UI colors, with subtle inputs, in both configs', () => {
    for (const config of [readText(SITE_CONFIG), readText(ADMIN_CONFIG)]) {
      expect(config).toContain(COLORS)
      expect(config).toContain("input: { defaultVariants: { variant: 'subtle' } }")
    }
  })

  it("keeps Nuxt UI's radius and width, which the theme leaves as they are, and no rounded pill", () => {
    for (const css of [readText(SITE_CSS), readText(ADMIN_CSS)]) {
      expect(css).not.toContain('--ui-radius:')
      expect(css).not.toContain('--ui-container:')
    }
    // A button or a label of the site is the shape of the theme, not a pill of its own.
    expect(readText('apps/web/app/pages/index.vue')).not.toContain('rounded-full')
    expect(readText('packages/admin/app/App.vue')).not.toMatch(/rounded-full border/)
  })

  it('gives Nuxt UI the theme and nothing else: no slot of a component restyled', () => {
    for (const config of [readText(SITE_CONFIG), readText(ADMIN_CONFIG)]) {
      expect(config).not.toContain('slots:')
    }
  })

  it('is dark only: no switch of color mode, and the class dark on every page', () => {
    const sources = [
      readText('apps/web/app/components/AppHeader.vue'),
      readText('packages/admin/app/App.vue'),
    ]
    for (const source of sources) expect(source).not.toContain('ColorMode')
    // The language is each page's (apps/web/app/app.vue); the class is the same on all of them.
    expect(readText('apps/web/nuxt.config.ts')).toContain("htmlAttrs: { class: 'dark' }")
    expect(readText('apps/web/nuxt.config.ts')).toContain('ui: { colorMode: false }')
    expect(readText('packages/admin/app/index.html')).toContain('<html lang="en" class="dark">')
    expect(readText(ADMIN_CONFIG)).toContain('colorMode: false')
  })

  it('gives the sign-in pages the Carbón ground and the flame accent of the theme', () => {
    const pages = readText(PAGES)

    expect(pages).toContain(':root{color-scheme:dark;--bg:#0e0c0a;')
    expect(pages).toContain('--accent:#f0a93b;')
    expect(pages).not.toContain('prefers-color-scheme')
  })

  it('draws one mark: the path of the favicon, in both logos and on the sign-in pages', () => {
    const mark = markOf(readText(FAVICON))

    expect(mark).toMatch(/^M109\.3 17\.8 C/)
    for (const file of [
      'apps/web/app/components/AppLogo.vue',
      'packages/admin/app/App.vue',
      PAGES,
    ]) {
      expect(readText(file)).toContain(`d="${mark}"`)
    }
    // The mark is flame, Nuxt UI's secondary, in both logos: the primary is the warm white.
    for (const logo of ['apps/web/app/components/AppLogo.vue', 'packages/admin/app/App.vue']) {
      expect(readText(logo)).toContain('w-auto shrink-0 fill-secondary')
    }
  })

  it('is described by docs/brand.md: each color the brand book names is the one of the theme', () => {
    const theme = themeOf(readText(SITE_CSS)) ?? ''
    const named = [
      ...readText('docs/brand.md').matchAll(/`((?:carbon|flame)-\d+)`\s*\|\s*`(#[0-9a-f]{6})`/g),
    ]

    expect(named.length).toBeGreaterThanOrEqual(9)
    for (const [, token, value] of named) expect(theme).toContain(`--color-${token}: ${value};`)
  })

  it('reads the theme block and the mark, and nothing around them', () => {
    expect(themeOf('a /* theme:start x */ b /* theme:end */ c')).toBe(
      '/* theme:start x */ b /* theme:end */',
    )
    expect(themeOf('no block')).toBeNull()
    expect(markOf('<svg><path fill="#000" d="M1 2 Z"/></svg>')).toBe('M1 2 Z')
    expect(markOf('<svg></svg>')).toBeNull()
  })
})
