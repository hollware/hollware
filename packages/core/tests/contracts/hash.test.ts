import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { DescribedSchema } from '../../src/config/types.ts'
import { canonicalJson, sha256Hex } from '../../src/contracts/hash.ts'
import { contracts, type Contract, type Phase, type Severity } from '../../src/contracts/index.ts'
import { collectionOf, conversionLog, described, markdownOf, run } from './support.ts'

const SEO_TITLE: Contract<unknown> = {
  id: 'seo-title',
  severity: 'warning',
  description: 'A title of at most 60 characters.',
  check: () => [],
}

const CANONICAL =
  '{"components":{"callout":{"properties":{"type":{"enum":["info"]}},"type":"object"}},"contracts":[{"id":"components","phases":["write","publish"],"severity":"error"},{"id":"disallowed-attribute","phases":["write","publish"],"severity":"error"},{"id":"raw-html","phases":["write","publish"],"severity":"error"},{"id":"schema","phases":["write","publish"],"severity":"error"},{"id":"seo-title","phases":["write","publish"],"severity":"warning"},{"id":"unknown-component","phases":["write","publish"],"severity":"error"},{"id":"unsafe-url","phases":["write","publish"],"severity":"error"}],"frontmatter":{"properties":{"title":{"type":"string"}},"type":"object"}}'
const HASH = 'e47e4a39b6b50cdd37e4da98f6cce358170ac58e754e9ac542d1882bac8e770c'

function handMade(contractsOfCollection: readonly Contract<unknown>[] = [SEO_TITLE]) {
  return collectionOf({
    schema: described({ type: 'object', properties: { title: { type: 'string' } } }),
    components: {
      callout: {
        props: described({ type: 'object', properties: { type: { enum: ['info'] } } }),
      },
    },
    contracts: contractsOfCollection,
  })
}

async function hashOf(
  collection = handMade(),
  phase: Phase = 'write',
  frontmatter?: Record<string, unknown>,
) {
  return (await run({ collection, phase, markdown: markdownOf({ frontmatter }) })).contractsHash
}

function custom(id: string, severity: Severity, phases?: readonly Phase[]): Contract<unknown> {
  return {
    id,
    severity,
    ...(phases === undefined ? {} : { phases }),
    description: `The rule ${id}.`,
    check: () => [],
  }
}

describe('contractsHash', () => {
  it('is the SHA-256, in lowercase hex, of the canonical JSON of what the revision was checked against', async () => {
    expect(await hashOf()).toBe(HASH)
    expect(await sha256Hex(CANONICAL)).toBe(HASH)
  })

  it('is the same for the same rules, whatever the content', async () => {
    expect(await hashOf(handMade(), 'write', { title: 'A title' })).toBe(HASH)
    expect(await hashOf(handMade(), 'write', { title: 42 })).toBe(HASH)
    expect(await hashOf(handMade(), 'write', {})).toBe(HASH)
  })

  it('is the same when the config only changes the wording or the order of the contracts', async () => {
    const reworded: Contract<unknown> = { ...SEO_TITLE, description: 'Other words.' }
    expect(await hashOf(handMade([reworded]))).toBe(HASH)
    const first = await hashOf(handMade([custom('a', 'error'), custom('b', 'warning')]))
    const reversed = await hashOf(handMade([custom('b', 'warning'), custom('a', 'error')]))
    expect(reversed).toBe(first)
    expect(first).not.toBe(HASH)
  })

  it('changes with the severity, the id and the phases of a contract', async () => {
    const hashes = new Set([
      await hashOf(handMade([custom('rule', 'error')]), 'publish'),
      await hashOf(handMade([custom('rule', 'warning')]), 'publish'),
      await hashOf(handMade([custom('other', 'error')]), 'publish'),
      await hashOf(handMade([custom('rule', 'error', ['write'])]), 'publish'),
      await hashOf(handMade([custom('rule', 'error', ['publish'])]), 'publish'),
    ])
    expect(hashes.size).toBe(5)
  })

  it('reads the phases of a contract the same however they are spelled', async () => {
    const absent = await hashOf(handMade([custom('rule', 'error')]), 'publish')
    expect(await hashOf(handMade([custom('rule', 'error', ['write', 'publish'])]), 'publish')).toBe(
      absent,
    )
    expect(await hashOf(handMade([custom('rule', 'error', ['publish', 'write'])]), 'publish')).toBe(
      absent,
    )
    expect(
      await hashOf(handMade([custom('rule', 'error', ['publish', 'write', 'write'])]), 'publish'),
    ).toBe(absent)
  })

  it('changes with the schema of the frontmatter', async () => {
    const at60 = collectionOf({ schema: z.object({ title: z.string().max(60) }) })
    const at61 = collectionOf({ schema: z.object({ title: z.string().max(61) }) })
    expect(await hashOf(at60)).not.toBe(await hashOf(at61))
    expect(await hashOf(at60)).toBe(
      await hashOf(collectionOf({ schema: z.object({ title: z.string().max(60) }) })),
    )
  })

  it('changes with the props of a component, and with the components there are', async () => {
    const props = (values: string[]) =>
      described({ type: 'object', properties: { type: { enum: values } } })
    const hashes = new Set([
      await hashOf(collectionOf({ components: { callout: { props: props(['info']) } } })),
      await hashOf(collectionOf({ components: { callout: { props: props(['info', 'tip']) } } })),
      await hashOf(collectionOf({ components: { note: { props: props(['info']) } } })),
      await hashOf(
        collectionOf({
          components: { callout: { props: props(['info']) }, note: { props: props(['info']) } },
        }),
      ),
      await hashOf(collectionOf()),
    ])
    expect(hashes.size).toBe(5)
  })

  it('tells the write phase from the publish phase when they run different contracts', async () => {
    const withPair = collectionOf({
      translationGroupField: 'translationGroup',
      contracts: [contracts.translationPair()],
    })
    expect(await hashOf(withPair, 'write')).not.toBe(await hashOf(withPair, 'publish'))
    expect(await hashOf(handMade(), 'write')).toBe(await hashOf(handMade(), 'publish'))
  })

  it('is the same whether the schema accepts the content or keeps a contract from running', async () => {
    const collection = collectionOf({
      schema: z.object({ title: z.string() }),
      contracts: [custom('reads-frontmatter', 'error')],
    })
    expect(await hashOf(collection, 'write', { title: 42 })).toBe(
      await hashOf(collection, 'write', { title: 'A title' }),
    )
  })
})

describe('the conversion of the schemas to JSON Schema', () => {
  it('asks for the input JSON Schema, draft 2020-12, of the frontmatter and of each component, once for a collection however many times its contracts run', async () => {
    const frontmatter = conversionLog()
    const callout = conversionLog()
    const collection = collectionOf({
      schema: described({ type: 'object' }, frontmatter),
      components: { callout: { props: described({ type: 'object' }, callout) } },
    })
    await run({ collection })
    await run({ collection, phase: 'publish' })
    await run({ collection, markdown: markdownOf({ frontmatter: { anything: true } }) })
    expect(frontmatter).toStrictEqual({ inputTargets: ['draft-2020-12'], outputTargets: [] })
    expect(callout).toStrictEqual({ inputTargets: ['draft-2020-12'], outputTargets: [] })
  })

  it('is made again for another collection', async () => {
    const log = conversionLog()
    const schema = described({ type: 'object' }, log)
    await run({ collection: collectionOf({ schema }) })
    await run({ collection: collectionOf({ schema }) })
    expect(log.inputTargets).toStrictEqual(['draft-2020-12', 'draft-2020-12'])
  })

  it('counts a schema that does not convert as null in the hash, and tries to convert it once', async () => {
    let attempts = 0
    const broken: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value }),
        jsonSchema: {
          input: () => {
            attempts += 1
            throw new Error('no JSON Schema')
          },
          output: () => ({}),
        },
      },
    }
    const collection = collectionOf({ schema: broken })
    const NULL_HASH = '1abc68ea059a73da99f7c5857900dcfec12be1015d86c85537a69c18f8e4c870'
    expect(await hashOf(collection)).toBe(NULL_HASH)
    expect(await hashOf(collection)).toBe(NULL_HASH)
    expect(attempts).toBe(1)
  })
})

describe('canonicalJson', () => {
  it('puts the keys of every object in order, by UTF-16 code unit', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
    expect(canonicalJson({ b: 1, a: 1, B: 1, ä: 1 })).toBe('{"B":1,"a":1,"b":1,"ä":1}')
  })

  it('keeps arrays in order and puts the keys of the objects inside them in order', () => {
    expect(canonicalJson([3, 1, { b: 1, a: 2 }, 2])).toBe('[3,1,{"a":2,"b":1},2]')
  })

  it('writes values as JSON does, and leaves out what JSON leaves out', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(1.5)).toBe('1.5')
    expect(canonicalJson('é"\n')).toBe('"é\\"\\n"')
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(canonicalJson([undefined, 1])).toBe('[null,1]')
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson({})).toBe('{}')
    expect(canonicalJson([])).toBe('[]')
  })

  it('ignores a property that is not enumerable, as the JSON Schema of zod carries one', () => {
    const value = { type: 'string' }
    Object.defineProperty(value, '~standard', { value: { vendor: 'zod' }, enumerable: false })
    expect(canonicalJson(value)).toBe('{"type":"string"}')
  })
})

describe('sha256Hex', () => {
  it('is the SHA-256 in lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})
