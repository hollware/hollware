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
    expect(comarkManifest.version).toBe('0.9.2')
    expect(COMARK_VERSION).toBe(comarkManifest.version)
  })

  it('is the version of @comark/html too, which pins comark to it, so a Worker holds one Comark', () => {
    expect(comarkHtmlManifest.version).toBe(COMARK_VERSION)
    expect(comarkHtmlManifest.dependencies.comark).toBe(COMARK_VERSION)
  })

  it('is stored with every result, next to the version of the pipeline', async () => {
    const { comarkVersion, pipelineVersion } = await accepted('Hello.')
    expect(comarkVersion).toBe('0.9.2')
    expect(pipelineVersion).toBe('3')
  })
})

describe('the version of the pipeline', () => {
  const PINNED: Record<string, Record<string, string>> = {
    '0.9.2/3': {
      'bench/long-post.md': '44fcd8c03738d8dd',
      'blog/en/agents-write-with-contracts.md': 'a2c0284c33950eb2',
      'blog/en/edge-caching-basics.md': '8fbcb43e6275e323',
      'blog/en/from-draft-to-published.md': '6ef0e6ee0aebe273',
      'blog/en/markdown-as-source-of-truth.md': 'a90bddf3fef1666a',
      'blog/en/one-deployment-many-sites.md': '676554c4d15d632c',
      'blog/es/agentes-que-escriben-con-contratos.md': 'ba13ecee4b9941a4',
      'blog/es/cache-en-el-borde.md': '35f0e172b7a5706b',
      'blog/es/del-borrador-a-publicado.md': '17e300f1aebfc198',
      'blog/es/markdown-como-fuente-de-verdad.md': '7951d4403fb43d8b',
      'blog/es/un-despliegue-muchos-sitios.md': '834f7bae4ae3574b',
      'hostile/block-html.md': '24e22e320275ccc4',
      'hostile/bom.md': 'fe0dde234a3438ae',
      'hostile/broken-frontmatter.md': '7f3db387730837cb',
      'hostile/disallowed-attribute.md': 'b7013eaeba736622',
      'hostile/nested-emphasis.md': 'a2a5a58960d50932',
      'hostile/raw-html.md': '9fe2a00162ca86e3',
      'hostile/unknown-component.md': '317c5cc7c73f1195',
      'hostile/unsafe-url.md': 'b426df0ffa5cb7bc',
      'invalid/broken-internal-link.md': 'd47e1ceb9c94b981',
      'invalid/description-too-long.md': 'd9bf331d3fde306b',
      'invalid/image-without-alt.md': 'ff537efc45b4005f',
      'invalid/missing-translation.md': 'e7010745d52991f3',
      'invalid/seo-title-too-long.md': 'f9cfa06cbf0b13f2',
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
