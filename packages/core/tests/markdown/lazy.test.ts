import { describe, expect, it } from 'vite-plus/test'

const sources = import.meta.glob<string>('../../src/markdown/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const STATIC_VALUE_IMPORT =
  /^import\s+(?!type\b)[^;]*?from\s+['"](?:comark|@comark\/html)(?:\/[^'"]*)?['"]/m
const STATIC_BARE_IMPORT = /^import\s+['"](?:comark|@comark\/html)(?:\/[^'"]*)?['"]/m

describe('the modules of the Markdown pipeline', () => {
  const files = Object.entries(sources).map(
    ([path, text]) => [path.split('/').pop() ?? path, text] as const,
  )

  it('are the files of the pipeline, so that a new module is read too', () => {
    expect(files.map(([name]) => name).sort()).toStrictEqual([
      'analyze.ts',
      'index.ts',
      'json.ts',
      'parser.ts',
      'policy.ts',
      'process.ts',
      'render.ts',
      'routes.ts',
      'slug.ts',
      'types.ts',
      'versions.ts',
      'violations.ts',
    ])
  })

  it.each(files)('%s imports no Comark module when it is loaded, only its types', (_name, text) => {
    expect(text).not.toMatch(STATIC_VALUE_IMPORT)
    expect(text).not.toMatch(STATIC_BARE_IMPORT)
  })

  it('import Comark where the parser is built and `@comark/html` where HTML is rendered, and nowhere else', () => {
    const dynamic = (text: string) =>
      [...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
    const byFile = Object.fromEntries(files.map(([name, text]) => [name, dynamic(text)]))
    expect(byFile['parser.ts']).toStrictEqual([
      'comark',
      'comark/plugins/components',
      'comark/plugins/attributes',
      'comark/plugins/task-list',
      'comark/plugins/alert',
    ])
    expect(byFile['render.ts']).toStrictEqual(['@comark/html'])
    for (const [name, imports] of Object.entries(byFile)) {
      if (name !== 'parser.ts' && name !== 'render.ts') expect(imports, name).toStrictEqual([])
    }
  })
})
