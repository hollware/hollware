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
    expect(pipelineVersion).toBe('2')
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
    '0.7.0/2': {
      'bench/long-post.md': '5ad53a69c722cbd8',
      'blog/en/agents-write-with-contracts.md': '6822a8ab60d251f9',
      'blog/en/edge-caching-basics.md': 'd5f17b325b87400b',
      'blog/en/from-draft-to-published.md': '9578ddd682c7453c',
      'blog/en/markdown-as-source-of-truth.md': '114fce309a1efeca',
      'blog/en/one-deployment-many-sites.md': 'a1684b8ded496b66',
      'blog/es/agentes-que-escriben-con-contratos.md': 'a9b6c5b022ea4225',
      'blog/es/cache-en-el-borde.md': '6d169376cf371a10',
      'blog/es/del-borrador-a-publicado.md': '2bb5bbc896056bfd',
      'blog/es/markdown-como-fuente-de-verdad.md': '4038d083236d4aa1',
      'blog/es/un-despliegue-muchos-sitios.md': '3c81e614e27d9837',
      'hostile/block-html.md': 'b0e84735b264d70c',
      'hostile/bom.md': '5eebe6dcd9abd152',
      'hostile/broken-frontmatter.md': '1ccd7e3dd1b09ff8',
      'hostile/disallowed-attribute.md': '741d04141f0f15c2',
      'hostile/nested-emphasis.md': '3719a2b878d60eff',
      'hostile/raw-html.md': '657ac7b64ad70752',
      'hostile/unknown-component.md': '0fe767d0955ad91a',
      'hostile/unsafe-url.md': 'd5755e668aebf5e3',
      'invalid/broken-internal-link.md': 'ed22aa3a8dffd2bf',
      'invalid/description-too-long.md': '90bebcb2c87be062',
      'invalid/image-without-alt.md': '02cca21b9a03aaab',
      'invalid/missing-translation.md': '7163b84db8c63ac9',
      'invalid/seo-title-too-long.md': '423febc4e64546a5',
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
