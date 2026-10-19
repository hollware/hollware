import { describe, expect, it } from 'vite-plus/test'

import {
  assetIdIn,
  assetIdOf,
  assetIdsIn,
  checkSvg,
  conversionOf,
  DEFAULT_MEDIA,
  processMarkdown,
  resolveAssetReferences,
  sniffImage,
  variantWidthsOf,
} from '../src/index.ts'
import { readMedia } from '../src/config/media.ts'
import { Problems } from '../src/config/config-error.ts'

// Fails when (src/media/index.ts, src/config/media.ts, src/markdown/policy.ts):
// - "tells a file by its bytes": a format is read from anything but its magic numbers, or a text
//   that only mentions <svg> passes for an SVG.
// - "refuses an SVG …" and "takes a plain SVG": a script, an event handler, embedded HTML, an
//   entity, a javascript: or data: URL, a reference outside the file, a character reference that
//   spells one, a CSS escape, or an animation of a link gets through; or a
//   gradient or a symbol referenced inside the file (#…) is refused.
// - "converts by the site's setting": quality or anim is ever left to the binding's defaults (its
//   default WebP is lossless and keeps one frame of a GIF: ADR-038), PNG is not lossless, a WebP
//   or an AVIF is converted when it fits, an image is scaled up, or SVG or `original` is converted.
// - "makes the copies narrower …": a copy as wide as the file, of an SVG or a JPEG, or under
//   `original`, is asked for.
// - "names an asset by its bytes": the id stops being `ast_` and the first 26 hex of the hash.
// - "resolves asset: references": a value that is not exactly a reference changes, or one is
//   missed inside an array or a nested object.
// - "gives an img of a document its size and copies": an author's own size is replaced, an image
//   without copies gets a srcset, one the site does not have or an SVG gets a size, or a `sizes`
//   lets the image grow past its own width; or assetIdsIn misses a nested reference or repeats one.
// - "keeps an asset: image": the Markdown pipeline drops `![alt](asset:…)` as an unsafe URL.
// - "reads the media setting": a value out of range is taken, or a missing one is not the default.

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new TextEncoder().encode(text)

describe('sniffImage', () => {
  it('tells a file by its bytes', () => {
    const webp = new Uint8Array(16)
    webp.set(ascii('RIFF'), 0)
    webp.set(ascii('WEBP'), 8)
    const avif = new Uint8Array(16)
    avif.set(ascii('ftypavif'), 4)
    expect(
      [
        bytes(0xff, 0xd8, 0xff, 0xe0),
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        webp,
        avif,
        ascii('GIF89a…'),
        ascii('GIF87a…'),
        ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        ascii('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg></svg>'),
        ascii(`${String.fromCodePoint(0xfeff)}  <svg/>`),
        ascii('<html><body><svg></svg></body></html>'),
        ascii('An essay that names <svg> later.'),
        bytes(0x50, 0x4b, 0x03, 0x04),
        bytes(),
      ].map(sniffImage),
    ).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/gif',
      'image/gif',
      'image/svg+xml',
      'image/svg+xml',
      'image/svg+xml',
      null,
      null,
      null,
      null,
    ])
  })
})

describe('checkSvg', () => {
  it('refuses an SVG with anything that can run or reach out', () => {
    const refused = [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><rect ONCLICK = "x()"/></svg>',
      '<svg><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><image href="data:image/png;base64,AAAA"/></svg>',
      '<svg><use xlink:href="https://evil.example/s.svg#x"/></svg>',
      '<svg><image href="photo.png"/></svg>',
      '<svg><style>@import url(https://evil.example/a.css);</style></svg>',
      '<svg><rect style="fill:url(https://evil.example/x)"/></svg>',
      '<svg><iframe src="x"></iframe></svg>',
      '<svg><a><set attributeName="href" to="&#106;avascript:alert(1)"/><text>x</text></a></svg>',
      '<svg><a><animate attributeName="xlink:href" values="#a;#b"/></a></svg>',
      '<svg><style>@\\69mport "https://evil.example/a.css";</style></svg>',
    ]
    expect(refused.map((svg) => checkSvg(svg)?.reason)).toEqual([
      'it holds a <script>',
      'it has an event handler (an on… attribute)',
      'it has an event handler (an on… attribute)',
      'it holds a <foreignObject>, which embeds HTML',
      'it declares a DOCTYPE or an entity',
      'it holds a javascript: or data: URL',
      'it holds a javascript: or data: URL',
      'it links outside the file (an href that does not start with #)',
      'it links outside the file (an href that does not start with #)',
      'its styles load something from outside',
      'its styles load something from outside',
      'it embeds another document',
      'it holds a character reference (&#…;) or an entity other than the five of XML',
      'it animates a link (<set> or <animate> of href)',
      'it holds a backslash, which CSS reads as an escape',
    ])
    expect(checkSvg('<svg><script/></svg>')?.fix).toContain('SVG optimizer')
  })

  it('takes a plain SVG, with gradients and symbols referenced inside it', () => {
    const plain = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <metadata>made: by hand &amp; with &lt;care&gt;</metadata>
  <defs><linearGradient id="g"><stop offset="0"/></linearGradient><symbol id="s"><rect/></symbol></defs>
  <rect width="10" height="10" fill="url(#g)" style="fill: url( '#g' )"/>
  <use href="#s"/><use xlink:href="#s"/>
</svg>`
    expect(checkSvg(plain)).toBe(null)
  })
})

describe('conversionOf', () => {
  it("converts by the site's setting, and always says quality and anim", () => {
    const webp = DEFAULT_MEDIA
    const avif = { ...DEFAULT_MEDIA, format: 'avif' as const }
    const original = { ...DEFAULT_MEDIA, format: 'original' as const }
    expect([
      conversionOf('image/jpeg', 1200, webp),
      conversionOf('image/png', 800, webp),
      conversionOf('image/gif', 320, webp),
      conversionOf('image/jpeg', 6000, webp),
      conversionOf('image/webp', 1200, webp),
      conversionOf('image/webp', 3000, webp),
      conversionOf('image/avif', 3000, webp),
      conversionOf('image/jpeg', 1200, avif),
      conversionOf('image/png', 1200, avif),
      conversionOf('image/svg+xml', null, webp),
      conversionOf('image/jpeg', 6000, original),
      conversionOf('image/jpeg', 2400, webp),
    ]).toEqual([
      { format: 'image/webp', quality: 85, anim: true },
      { format: 'image/webp', quality: 100, anim: true },
      { format: 'image/webp', quality: 85, anim: true },
      { format: 'image/webp', quality: 85, anim: true, width: 2400 },
      null,
      { format: 'image/webp', quality: 85, anim: true, width: 2400 },
      { format: 'image/avif', quality: 85, anim: true, width: 2400 },
      { format: 'image/avif', quality: 85, anim: true },
      { format: 'image/avif', quality: 100, anim: true },
      null,
      null,
      { format: 'image/webp', quality: 85, anim: true },
    ])
  })

  it('makes the copies narrower than the file served, only as WebP or AVIF', () => {
    const original = { ...DEFAULT_MEDIA, format: 'original' as const }
    expect([
      variantWidthsOf('image/webp', 1600, DEFAULT_MEDIA),
      variantWidthsOf('image/avif', 1280, DEFAULT_MEDIA),
      variantWidthsOf('image/webp', 640, DEFAULT_MEDIA),
      variantWidthsOf('image/svg+xml', null, DEFAULT_MEDIA),
      variantWidthsOf('image/jpeg', 1600, DEFAULT_MEDIA),
      variantWidthsOf('image/webp', 1600, original),
    ]).toEqual([[640, 1280], [640], [], [], [], []])
  })
})

describe('asset references', () => {
  it('names an asset by its site and its bytes, so two sites never share an id', async () => {
    const bytes = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    // ast_ and the first 26 hex of the SHA-256 of "blog:<hash>" and of "docs:<hash>".
    expect([await assetIdOf('blog', bytes), await assetIdOf('docs', bytes)]).toEqual([
      'ast_d00d6e7de2db11d072c51ee81a',
      'ast_07e2d3775ec24d9af807a6057c',
    ])
  })

  it('resolves asset: references, deep inside a value, and nothing else', () => {
    const id = 'ast_0123456789abcdef0123456789'
    expect(assetIdIn(`asset:${id}`)).toBe(id)
    expect(assetIdIn(` asset:${id} `)).toBe(id)
    expect(
      [`asset:${id}x`, `see asset:${id}`, 'asset:ast_short', 'https://x.test/a.png'].map(assetIdIn),
    ).toEqual([null, null, null, null])
    const value = {
      img: `asset:${id}`,
      title: `asset:${id} is my cover`,
      gallery: [`asset:${id}`, 'https://x.test/a.png'],
      seo: { image: `asset:${id}`, count: 2, draft: false, none: null },
    }
    expect(
      resolveAssetReferences(value, (found) => `https://cms.test/assets/blog/${found}`),
    ).toEqual({
      img: `https://cms.test/assets/blog/${id}`,
      title: `asset:${id} is my cover`,
      gallery: [`https://cms.test/assets/blog/${id}`, 'https://x.test/a.png'],
      seo: { image: `https://cms.test/assets/blog/${id}`, count: 2, draft: false, none: null },
    })
    expect(value.img).toBe(`asset:${id}`)
  })

  it('gives an img of a document its size and copies, and keeps the size its author gave', () => {
    const photo = 'ast_0123456789abcdef0123456789'
    const plain = 'ast_aaaaaaaaaaaaaaaaaaaaaaaaaa'
    const logo = 'ast_bbbbbbbbbbbbbbbbbbbbbbbbbb'
    const gone = 'ast_cccccccccccccccccccccccccc'
    const url = (id: string) => `https://cms.test/assets/blog/${id}`
    const sizes = new Map([
      [photo, { width: 1600, height: 900, widths: [640, 1280] }],
      [plain, { width: 500, height: 400, widths: [] }],
      [logo, { width: null, height: null, widths: [] }],
    ])
    const document = {
      frontmatter: { cover: `asset:${photo}` },
      meta: {},
      nodes: [
        ['p', {}, ['img', { src: `asset:${photo}`, alt: 'Photo' }]],
        ['img', { src: `asset:${photo}`, alt: 'Small', width: '320' }],
        ['img', { src: `asset:${plain}`, alt: 'Plain' }],
        ['img', { src: `asset:${logo}`, alt: 'Logo' }],
        ['img', { src: `asset:${gone}`, alt: 'Gone' }],
      ],
    }

    const resolved = resolveAssetReferences(document, url, (id) => sizes.get(id))

    expect(assetIdsIn(document)).toEqual([photo, plain, logo, gone])
    expect(resolved.frontmatter.cover).toBe(url(photo))
    expect(resolved.nodes).toEqual([
      [
        'p',
        {},
        [
          'img',
          {
            src: url(photo),
            alt: 'Photo',
            srcset: `${url(photo)}/640 640w, ${url(photo)}/1280 1280w, ${url(photo)} 1600w`,
            sizes: '(min-width: 1600px) 1600px, 100vw',
            width: '1600',
            height: '900',
          },
        ],
      ],
      [
        'img',
        {
          src: url(photo),
          alt: 'Small',
          width: '320',
          srcset: `${url(photo)}/640 640w, ${url(photo)}/1280 1280w, ${url(photo)} 1600w`,
          sizes: '(min-width: 1600px) 1600px, 100vw',
        },
      ],
      ['img', { src: url(plain), alt: 'Plain', width: '500', height: '400' }],
      ['img', { src: url(logo), alt: 'Logo' }],
      ['img', { src: url(gone), alt: 'Gone' }],
    ])
  })

  it('keeps an asset: image through the Markdown pipeline', async () => {
    const id = 'ast_0123456789abcdef0123456789'
    const result = await processMarkdown(`# Title\n\n![The pipeline](asset:${id})\n`, {
      components: [],
      maxMarkdownBytes: 10_000,
      routes: {},
    })
    if (!result.ok) throw new Error('the pipeline refused the file')
    const processed = result.value
    expect(processed.extracted.disallowed).toEqual([])
    expect(processed.extracted.images).toEqual([
      expect.objectContaining({ src: `asset:${id}`, alt: 'The pipeline' }),
    ])
    expect(JSON.stringify(processed.document)).toContain(`asset:${id}`)
  })
})

describe('readMedia', () => {
  it('reads the media setting, and refuses what is out of range with a fix', () => {
    const problems = new Problems()
    expect(readMedia('media', undefined, problems)).toEqual(DEFAULT_MEDIA)
    expect(
      readMedia(
        'media',
        { format: 'avif', quality: 60, maxWidth: 1600, widths: [960, 480] },
        problems,
      ),
    ).toEqual({
      format: 'avif',
      quality: 60,
      maxWidth: 1600,
      widths: [480, 960],
      keepOriginals: true,
    })
    expect(readMedia('media', { widths: [] }, problems).widths).toEqual([])
    expect(readMedia('media', { keepOriginals: false }, problems).keepOriginals).toBe(false)
    expect(problems.list).toEqual([])
    expect(
      readMedia('media', { format: 'png', quality: 101, maxWidth: 100, widths: [100] }, problems),
    ).toEqual(DEFAULT_MEDIA)
    for (const widths of [[640, 640], [320, 480, 640, 800, 960], [640.5], '640'])
      readMedia('media', { widths }, problems)
    readMedia('media', { keepOriginals: 'no' }, problems)
    expect(problems.list.map((problem) => problem.path)).toEqual([
      'media.format',
      'media.quality',
      'media.maxWidth',
      'media.widths',
      'media.widths',
      'media.widths',
      'media.widths',
      'media.widths',
      'media.keepOriginals',
    ])
    expect(problems.list.every((problem) => problem.fix.length > 0)).toBe(true)
  })
})
