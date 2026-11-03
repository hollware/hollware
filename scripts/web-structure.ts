import { pathToFileURL } from 'node:url'
import { definitionsFromConfig, type HollwareConfig } from '../packages/core/src/index.ts'

export const WEB_COLLECTIONS = ['pages', 'features', 'compare', 'glossary'] as const

export function webCollections(config: HollwareConfig): Record<string, unknown> {
  const docs = definitionsFromConfig(config)['docs']
  if (docs === undefined) throw new Error('hollware.config.ts of the playground has no site docs')
  return Object.fromEntries(
    WEB_COLLECTIONS.map((name) => {
      const collection = docs.collections[name]
      if (collection === undefined) throw new Error(`the site docs has no collection ${name}`)
      return [name, collection]
    }),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { default: config } = await import('../apps/playground/hollware.config.ts')
  process.stdout.write(`${JSON.stringify(webCollections(config), null, 2)}\n`)
}
