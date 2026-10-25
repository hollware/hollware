import { describe, expect, it } from 'vite-plus/test'

import { contracts, type Phase } from '../../src/contracts/index.ts'
import type { ImageRef } from '../../src/markdown/types.ts'
import { collectionOf, markdownOf, run } from './support.ts'

const PHASES: Phase[] = ['write', 'publish']

function runImages(images: readonly ImageRef[], phase: Phase, severity?: 'warning') {
  return run({
    phase,
    collection: collectionOf({
      contracts: [contracts.imagesHaveAlt(severity === undefined ? {} : { severity })],
    }),
    markdown: markdownOf({ images }),
  })
}

describe('the images-have-alt contract', () => {
  it('passes images that have alt text', async () => {
    for (const phase of PHASES) {
      const verdict = await runImages([{ src: '/a.png', alt: 'A cat on a sofa', line: 3 }], phase)
      expect(verdict.errors).toStrictEqual([])
      expect(verdict.ok).toBe(true)
    }
  })

  it('reports an image whose alt is empty or only spaces, in both phases', async () => {
    for (const phase of PHASES) {
      const verdict = await runImages(
        [
          { src: '/a.png', alt: '', line: 9 },
          { src: '/b.png', alt: '   ', line: 4 },
          { src: '/c.png', alt: 'Fine', line: 6 },
        ],
        phase,
      )
      expect(verdict.errors).toStrictEqual([
        {
          contract: 'images-have-alt',
          severity: 'error',
          path: '/body',
          message: 'The image "/b.png" has no alt text.',
          fix: 'Add alt text that describes the image, as in ![a short description](/b.png).',
          params: { src: '/b.png' },
          line: 4,
        },
        {
          contract: 'images-have-alt',
          severity: 'error',
          path: '/body',
          message: 'The image "/a.png" has no alt text.',
          fix: 'Add alt text that describes the image, as in ![a short description](/a.png).',
          params: { src: '/a.png' },
          line: 9,
        },
      ])
      expect(verdict.ok).toBe(false)
    }
  })

  it('passes an image of the site with no alt, which a reader gets with the alt it was uploaded with', async () => {
    const verdict = await runImages(
      [
        { src: 'asset:ast_0123456789abcdef0123456789', alt: '', line: 2 },
        { src: 'asset:not-an-asset', alt: '', line: 5 },
      ],
      'write',
    )
    expect(verdict.errors.map((error) => error.line)).toStrictEqual([5])
  })

  it('leaves out the line when the image has none', async () => {
    const verdict = await runImages([{ src: '/a.png', alt: '' }], 'write')
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'images-have-alt',
        severity: 'error',
        path: '/body',
        message: 'The image "/a.png" has no alt text.',
        fix: 'Add alt text that describes the image, as in ![a short description](/a.png).',
        params: { src: '/a.png' },
      },
    ])
  })

  it('clips a long src in the message and the fix', async () => {
    const src = `/${'x'.repeat(200)}.png`
    const verdict = await runImages([{ src, alt: '', line: 1 }], 'write')
    const clipped = `/${'x'.repeat(79)}…`
    expect(verdict.errors[0]?.message).toBe(`The image "${clipped}" has no alt text.`)
    expect(verdict.errors[0]?.fix).toBe(
      `Add alt text that describes the image, as in ![a short description](${clipped}).`,
    )
  })

  it('is a warning when it is given that severity', async () => {
    const verdict = await runImages([{ src: '/a.png', alt: '', line: 2 }], 'write', 'warning')
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings.map((violation) => violation.contract)).toStrictEqual([
      'images-have-alt',
    ])
    expect(verdict.ok).toBe(true)
  })

  it('does not run in a collection that did not list it', async () => {
    const verdict = await run({
      markdown: markdownOf({ images: [{ src: '/a.png', alt: '', line: 2 }] }),
    })
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toStrictEqual([])
  })

  it('runs while the frontmatter does not pass the schema, which it does not read', async () => {
    const verdict = await run({
      collection: collectionOf({ contracts: [contracts.imagesHaveAlt()] }),
      markdown: markdownOf({ frontmatter: {}, images: [{ src: '/a.png', alt: '', line: 2 }] }),
    })
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'schema',
      'schema',
      'schema',
      'images-have-alt',
    ])
  })
})
