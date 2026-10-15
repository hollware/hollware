import { describe, expect, it } from 'vite-plus/test'

import { readText } from '../support/repo.ts'

// Fails when: hollware.com (apps/web), the admin (packages/admin) and the pages the Worker renders
// to sign in (packages/server/src/identity/pages.ts) stop sharing one look: the mint and ink
// palettes of the two stylesheets differ in a shade or lose one, or the accent of the sign-in
// pages is no shade of mint.

const SITE = 'apps/web/app/assets/css/main.css'
const ADMIN = 'packages/admin/app/app.css'
const PAGES = 'packages/server/src/identity/pages.ts'

/** The `--color-mint-*` and `--color-ink-*` tokens of a stylesheet, by name. */
export function paletteOf(css: string): Record<string, string> {
  return Object.fromEntries(
    [...css.matchAll(/(--color-(?:mint|ink)-\d+):\s*(#[0-9a-f]{6})/gi)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').toLowerCase(),
    ]),
  )
}

describe('the look of Hollware', () => {
  it('is one palette in the site and in the admin, eleven shades of mint and of ink', () => {
    const site = paletteOf(readText(SITE))
    const admin = paletteOf(readText(ADMIN))

    expect(Object.keys(site)).toHaveLength(22)
    expect(admin).toEqual(site)
    expect(site['--color-mint-400']).toBe('#3ee6a8')
  })

  it('gives the sign-in pages an accent that is a shade of mint, in each theme', () => {
    const mint = Object.entries(paletteOf(readText(SITE)))
      .filter(([name]) => name.startsWith('--color-mint-'))
      .map(([, value]) => value)
    const accents = [...readText(PAGES).matchAll(/--accent:(#[0-9a-f]{6})/gi)].map((match) =>
      (match[1] ?? '').toLowerCase(),
    )

    expect(accents).toHaveLength(2)
    for (const accent of accents) expect(mint).toContain(accent)
  })

  it('reads a palette, and nothing else, from a stylesheet', () => {
    expect(
      paletteOf('--color-mint-50: #EDFDF7;\n--color-blue-50: #000000;\n--color-ink-9: #111111;'),
    ).toEqual({
      '--color-mint-50': '#edfdf7',
      '--color-ink-9': '#111111',
    })
  })
})
