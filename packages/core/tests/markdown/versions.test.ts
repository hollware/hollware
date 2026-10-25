import comarkHtmlManifest from '../../node_modules/@comark/html/package.json' with { type: 'json' }
import comarkManifest from '../../node_modules/comark/package.json' with { type: 'json' }
import { describe, expect, it } from 'vite-plus/test'

import { CONTENT_FIXTURES } from '../../../../tests/fixtures/content.ts'
import { processMarkdown } from '../../src/markdown/process.ts'
import { COMARK_VERSION, PIPELINE_VERSION } from '../../src/markdown/versions.ts'
import { accepted, BLOG_OPTIONS, warmUpComark } from './support.ts'

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
    expect(pipelineVersion).toBe('3')
  })
})

describe('the version of the pipeline', () => {
  const PINNED: Record<string, Record<string, string>> = {
    '0.7.0/3': {
      'bench/long-post.md': '423a9a836a51e0f6',
      'blog/en/agents-write-with-contracts.md': 'f73e954211628290',
      'blog/en/edge-caching-basics.md': '06a64160608f053a',
      'blog/en/from-draft-to-published.md': '6e43d363254052ae',
      'blog/en/markdown-as-source-of-truth.md': 'fe0e72c9949bfad9',
      'blog/en/one-deployment-many-sites.md': '9b4a91126a21f641',
      'blog/es/agentes-que-escriben-con-contratos.md': '009b3047b665b7c9',
      'blog/es/cache-en-el-borde.md': '3708bac4fa9b3468',
      'blog/es/del-borrador-a-publicado.md': '3a7dc958cc8411d6',
      'blog/es/markdown-como-fuente-de-verdad.md': '9cd353d3e96ea2fa',
      'blog/es/un-despliegue-muchos-sitios.md': '12082c258d2a1a25',
      'hostile/block-html.md': '5ec1e4033bc2d6a4',
      'hostile/bom.md': 'c3fec3d259e9babd',
      'hostile/broken-frontmatter.md': '7f3db387730837cb',
      'hostile/disallowed-attribute.md': '316809864dfba7a3',
      'hostile/nested-emphasis.md': '28b2decbf40cb3cd',
      'hostile/raw-html.md': '3e8563c556711104',
      'hostile/unknown-component.md': '108c3186a0a9d892',
      'hostile/unsafe-url.md': 'ea84e42256426098',
      'invalid/broken-internal-link.md': '76719abc5380bd96',
      'invalid/description-too-long.md': 'fab22609313f3847',
      'invalid/image-without-alt.md': '22396cc8bb95a435',
      'invalid/missing-translation.md': 'a38eee811fc5e3fe',
      'invalid/seo-title-too-long.md': 'f97ccd1db1838a3b',
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
