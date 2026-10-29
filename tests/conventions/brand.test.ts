import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { readText, REPO_ROOT } from '../support/repo.ts'

const SITE_CSS = 'apps/web/app/assets/css/main.css'
const ADMIN_CSS = 'packages/admin/app/app.css'
const SITE_CONFIG = 'apps/web/app/app.config.ts'
const ADMIN_CONFIG = 'packages/admin/vite.app.config.ts'
const PAGES = 'packages/server/src/identity/pages.ts'
const FAVICON = 'apps/web/public/favicon.svg'

export function themeOf(css: string): string | null {
  return /\/\* theme:start[\s\S]*?\/\* theme:end \*\//.exec(css)?.[0] ?? null
}

export function markOf(svg: string): string | null {
  return /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1] ?? null
}

const COLORS = "colors: { primary: 'carbon', secondary: 'flame', neutral: 'carbon' }"
const SCALES: Readonly<Record<string, string>> = { primary: 'carbon', neutral: 'carbon' }
const TEXTS = [
  '--ui-text-dimmed',
  '--ui-text-muted',
  '--ui-text-toned',
  '--ui-text',
  '--ui-text-highlighted',
  '--ui-primary',
]
const GROUNDS = ['--ui-bg', '--ui-bg-muted', '--ui-bg-elevated']

function declarationsOf(css: string, block: RegExp): [string, string][] {
  return [...css.matchAll(block)].flatMap((found) =>
    [...(found[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map(
      ([, name, value]): [string, string] => [name ?? '', (value ?? '').trim()],
    ),
  )
}

function darkTones(): Map<string, string> {
  const theme = themeOf(readText(SITE_CSS)) ?? ''
  const nuxtUi = readFileSync(
    createRequire(join(REPO_ROOT, 'packages/admin/package.json')).resolve(
      '@nuxt/ui/runtime/index.css',
    ),
    'utf8',
  )
  const palette = new Map(declarationsOf(theme, /@theme static \{([^}]*)\}/g))
  const hexOf = (value: string): string => {
    const step = /^var\(--ui-color-(\w+)-(\d+)\)$/.exec(value)
    const hex = step === null ? value : palette.get(`--color-${SCALES[step[1] ?? '']}-${step[2]}`)
    return hex === '#fff' ? '#ffffff' : (hex ?? value)
  }
  return new Map(
    [
      ...declarationsOf(nuxtUi, /\.dark\{([^}]*)\}/g),
      ...declarationsOf(theme, /\.dark \{([^}]*)\}/g),
    ].map(([name, value]) => [name, hexOf(value)]),
  )
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(text: string, ground: string): number {
  const [light = 0, dark = 0] = [luminance(text), luminance(ground)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

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
    expect(readText('apps/web/nuxt.config.ts')).toContain("htmlAttrs: { class: 'dark' }")
    expect(readText('apps/web/nuxt.config.ts')).toContain('ui: { colorMode: false }')
    expect(readText('packages/admin/app/index.html')).toContain('<html lang="en" class="dark">')
    expect(readText(ADMIN_CONFIG)).toContain('colorMode: false')
  })

  it('gives every tone of text 4.5:1 on every ground of the dark theme, as WCAG AA asks', () => {
    const tones = darkTones()
    const measured = TEXTS.flatMap((text) =>
      GROUNDS.map((ground) => ({
        text,
        ground,
        ratio: contrast(tones.get(text) ?? '', tones.get(ground) ?? ''),
      })),
    )

    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect([tones.get('--ui-text-dimmed'), tones.get('--ui-bg-elevated')]).toEqual([
      '#878074',
      '#17140f',
    ])
    expect(measured.filter(({ ratio }) => !(ratio >= 4.5))).toEqual([])
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
    for (const logo of ['apps/web/app/components/AppLogo.vue', 'packages/admin/app/App.vue']) {
      expect(readText(logo)).toContain('w-auto shrink-0 fill-secondary')
    }
  })

  it('gives the site and the admin the same icons, byte for byte', () => {
    for (const icon of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
      const site = readFileSync(join(REPO_ROOT, 'apps/web/public', icon))
      const admin = readFileSync(join(REPO_ROOT, 'packages/admin/app/public', icon))
      expect(admin.equals(site), icon).toBe(true)
    }
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
