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
    expect(comarkManifest.version).toBe('0.8.1')
    expect(COMARK_VERSION).toBe(comarkManifest.version)
  })

  it('is the version of @comark/html too, which pins comark to it, so a Worker holds one Comark', () => {
    expect(comarkHtmlManifest.version).toBe(COMARK_VERSION)
    expect(comarkHtmlManifest.dependencies.comark).toBe(COMARK_VERSION)
  })

  it('is stored with every result, next to the version of the pipeline', async () => {
    const { comarkVersion, pipelineVersion } = await accepted('Hello.')
    expect(comarkVersion).toBe('0.8.1')
    expect(pipelineVersion).toBe('3')
  })
})

describe('the version of the pipeline', () => {
  const PINNED: Record<string, Record<string, string>> = {
    '0.8.1/3': {
      'bench/long-post.md': '65dbc307701e8156',
      'blog/en/agents-write-with-contracts.md': 'ad59a3763bcec0dc',
      'blog/en/edge-caching-basics.md': '79369e2894ec3dce',
      'blog/en/from-draft-to-published.md': '5c33f234489d3f45',
      'blog/en/markdown-as-source-of-truth.md': 'ba7262c034ed2334',
      'blog/en/one-deployment-many-sites.md': 'e0b4f423ccbc646a',
      'blog/es/agentes-que-escriben-con-contratos.md': '6fb82f0c10a75ac2',
      'blog/es/cache-en-el-borde.md': 'ea6be00ec37800f7',
      'blog/es/del-borrador-a-publicado.md': '5a55028c21877217',
      'blog/es/markdown-como-fuente-de-verdad.md': '992674d49d5cf8b5',
      'blog/es/un-despliegue-muchos-sitios.md': '04b56e00fff5e13d',
      'hostile/block-html.md': 'a665b458d1c689be',
      'hostile/bom.md': '13a10758c854fc19',
      'hostile/broken-frontmatter.md': '7f3db387730837cb',
      'hostile/disallowed-attribute.md': '6e813dc0a9298722',
      'hostile/nested-emphasis.md': 'f463e7b4084f6403',
      'hostile/raw-html.md': '47c868f54d4158ad',
      'hostile/unknown-component.md': 'ace791d284770582',
      'hostile/unsafe-url.md': '7c26a31c2755759b',
      'invalid/broken-internal-link.md': 'af20988cd9fdeacb',
      'invalid/description-too-long.md': '6e55aaa4b040ce5f',
      'invalid/image-without-alt.md': '3b36d12bed3bd114',
      'invalid/missing-translation.md': '944cf9e320293308',
      'invalid/seo-title-too-long.md': '6bcbabd397d720c1',
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
