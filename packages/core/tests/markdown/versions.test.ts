import comarkHtmlManifest from '../../node_modules/@comark/html/package.json' with { type: 'json' }
import comarkManifest from '../../node_modules/comark/package.json' with { type: 'json' }
import { describe, expect, it } from 'vite-plus/test'

import { CONTENT_FIXTURES } from '../../../../tests/fixtures/content.ts'
import { processMarkdown } from '../../src/markdown/process.ts'
import { COMARK_VERSION, PIPELINE_VERSION } from '../../src/markdown/versions.ts'
import { accepted, BLOG_OPTIONS, warmUpComark } from './support.ts'

// Fails when: COMARK_VERSION no longer names the version of `comark` that is installed (Comark
// exports no version, so this constant is all `comark_version` has), or `@comark/html` stops
// pinning that same version, which would put two copies of Comark in a Worker; or the output of the
// pipeline for the shared fixtures changes without PIPELINE_VERSION changing with it: a settings
// change (an allowlist, a plugin, the heading ids, the marker, a line number) that forgets to
// bump the version leaves the revisions written before it with a document the pipeline would no
// longer make, and `reparse` never knows to rebuild them.

warmUpComark()

describe('the version of Comark', () => {
  it('is the version of the comark that is installed', () => {
    expect(comarkManifest.version).toBe('0.7.0')
    expect(COMARK_VERSION).toBe(comarkManifest.version)
  })

  it('is the version of @comark/html too, which pins comark to it, so a Worker holds one Comark', () => {
    expect(comarkHtmlManifest.version).toBe(COMARK_VERSION)
    expect(comarkHtmlManifest.dependencies.comark).toBe(COMARK_VERSION)
  })

  it('is stored with every result, next to the version of the pipeline', async () => {
    const { comarkVersion, pipelineVersion } = await accepted('Hello.')
    expect(comarkVersion).toBe('0.7.0')
    expect(pipelineVersion).toBe('1')
  })
})

describe('the version of the pipeline', () => {
  /**
   * The first sixteen hexadecimal digits of the SHA-256 of the JSON of what `processMarkdown`
   * answers for each shared fixture, with the options of the playground's blog, by the version of
   * Comark and of the pipeline. When this fails, the pipeline makes another document than it did:
   * bump PIPELINE_VERSION (or COMARK_VERSION, with the package) and pin the new output here.
   */
  const PINNED: Record<string, Record<string, string>> = {
    '0.7.0/1': {
      'bench/long-post.md': '218bea62efe21762',
      'blog/en/agents-write-with-contracts.md': 'aae7ebaf1784b038',
      'blog/en/edge-caching-basics.md': '79f78d4a8b8a0cf1',
      'blog/en/from-draft-to-published.md': '385062b4590a52fc',
      'blog/en/markdown-as-source-of-truth.md': '9e81164ce1aed86a',
      'blog/en/one-deployment-many-sites.md': '1b8f396082837113',
      'blog/es/agentes-que-escriben-con-contratos.md': '9a6c51734101f916',
      'blog/es/cache-en-el-borde.md': '6c569ab3c5898f56',
      'blog/es/del-borrador-a-publicado.md': '3369c031dfdc9b6f',
      'blog/es/markdown-como-fuente-de-verdad.md': '176b28f9e7521eed',
      'blog/es/un-despliegue-muchos-sitios.md': '7f08929633b35f06',
      'hostile/block-html.md': '26fa49e8e5e438be',
      'hostile/bom.md': '8047cd62193e6e9f',
      'hostile/broken-frontmatter.md': '1ccd7e3dd1b09ff8',
      'hostile/disallowed-attribute.md': '80e0f5c2e3c6b106',
      'hostile/nested-emphasis.md': 'd568771d67de287f',
      'hostile/raw-html.md': '05ab755000e2face',
      'hostile/unknown-component.md': 'ffce425055e68cd2',
      'hostile/unsafe-url.md': '66605dca19d85c0f',
      'invalid/broken-internal-link.md': 'c2156a774f670d96',
      'invalid/description-too-long.md': 'c04bd29e73059753',
      'invalid/image-without-alt.md': 'efbcc6cf9ed3cf3c',
      'invalid/missing-translation.md': 'dfe840f1f7c73b3c',
      'invalid/seo-title-too-long.md': 'af96d5eebcc3cc22',
    },
  }

  async function digest(text: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
  }

  async function fingerprints(): Promise<Record<string, string>> {
    const found: Record<string, string> = {}
    for (const fixture of CONTENT_FIXTURES) {
      const result = await processMarkdown(fixture.markdown, BLOG_OPTIONS)
      found[fixture.path] = await digest(JSON.stringify(result))
    }
    return found
  }

  it('is pinned to the output it makes for every shared fixture', async () => {
    expect(await fingerprints()).toStrictEqual(PINNED[`${COMARK_VERSION}/${PIPELINE_VERSION}`])
  })
})
