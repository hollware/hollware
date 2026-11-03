import { describe, expect, it } from 'vite-plus/test'

import config from '../../apps/playground/hollware.config.ts'
import { webCollections } from '../../scripts/web-structure.ts'
import { VOICE_WORDS } from '../guards/voice.ts'
import { readRepoFiles, readText } from '../support/repo.ts'

interface Schema {
  readonly type?: string
  readonly enum?: readonly unknown[]
  readonly pattern?: string
  readonly properties?: Readonly<Record<string, Schema>>
}

interface Collection {
  readonly components: Readonly<Record<string, { readonly props: Schema }>>
  readonly rules: readonly { readonly rule: string; readonly params: Record<string, unknown> }[]
}

const collections: Record<string, Collection> = JSON.parse(JSON.stringify(webCollections(config)))
const rendered = [
  ...readText('apps/web/app/components/page/PageBody.vue').matchAll(
    /^\s+'?([a-z-]+)'?: resolveComponent\(/gm,
  ),
].flatMap(([, name]) => (name === undefined ? [] : [name]))

describe('the pages of hollware.com, read from Hollware', () => {
  it('render every component their collections declare, and only those', () => {
    for (const collection of Object.values(collections)) {
      const byName = (a: string, b: string) => a.localeCompare(b)
      expect(Object.keys(collection.components).sort(byName)).toEqual([...rendered].sort(byName))
    }
  })

  it('give no component a prop of free text: copy goes in slots, where the contracts read it', () => {
    for (const collection of Object.values(collections)) {
      for (const [name, component] of Object.entries(collection.components)) {
        for (const [prop, schema] of Object.entries(component.props.properties ?? {})) {
          expect(
            schema.type !== 'string' || schema.enum !== undefined || schema.pattern !== undefined,
            `${name}.${prop}`,
          ).toBe(true)
        }
      }
    }
  })

  it('refuse the words the voice guard refuses in the repository', () => {
    for (const collection of Object.values(collections)) {
      const banned = collection.rules.find((rule) => rule.rule === 'banned-words')
      expect(banned?.params['words']).toEqual(VOICE_WORDS)
    }
  })
})

describe('shaders', () => {
  it('are imported by one component, which turns their telemetry off on every canvas', () => {
    const importers = readRepoFiles((path) => /^apps\/web\/(app|server)\/.+\.(vue|ts)$/.test(path))
      .filter((file) => /from 'shaders(\/[a-z]+)?'/.test(file.text))
      .map((file) => file.path)
    expect(importers).toEqual(['apps/web/app/components/shader/ShaderScene.client.vue'])
    const scene = readText('apps/web/app/components/shader/ShaderScene.client.vue')
    const canvases = scene.match(/<Shader\b[^>]*>/g) ?? []
    expect(canvases.length).toBeGreaterThan(0)
    for (const canvas of canvases) expect(canvas).toContain(':disable-telemetry="true"')
  })
})
