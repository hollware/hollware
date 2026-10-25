import {
  allowOnly,
  audit,
  auditStep,
  mapMemory,
  reviewPending,
  translateMissing,
  type Hollware,
  type Message,
  writeReport,
} from '@hollware/agents'
import { OPERATIONS } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Principal } from '../../src/auth/types.ts'
import { handlers } from '../../src/ops/index.ts'
import { invoke } from '../../src/ops/invoke.ts'
import type { OperationContext } from '../../src/ops/types.ts'
import type { AnalyticsSources } from '../../src/ports.ts'
import { VERDICT } from '../db/support.ts'
import { blogPost, warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, type World } from '../ops/world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

function agentsPrincipal(world: World): Principal {
  return {
    kind: 'token',
    userId: world.tenant.userId,
    tokenId: world.tenant.tokenId,
    site: world.tenant.key,
    scopes: ['content:read', 'content:write'],
  }
}

function agentsHollware(world: World, extra: Partial<OperationContext> = {}): Hollware {
  const context: OperationContext = {
    ...world.context({ principal: agentsPrincipal(world) }),
    client: { name: 'hollware-agents', version: '0.6.0' },
    ...extra,
  }
  return allowOnly(async (tool, input) => {
    const spec = OPERATIONS.find((operation) => operation.name === tool)
    if (spec === undefined) throw new Error(`no operation ${tool}`)
    const output = spec.output.parse(await invoke(handlers, spec, spec.input.parse(input), context))
    return Object.fromEntries(Object.entries(output))
  })
}

function scripted(script: { review?: string; translate?: string; fix?: string }) {
  const asked: string[] = []
  const model = async (messages: readonly Message[]) => {
    const prompt = messages.map((message) => message.content).join('\n')
    if (prompt.startsWith('You review')) {
      asked.push('review')
      return script.review ?? ''
    }
    if (prompt.includes('The contracts of the site refuse')) {
      asked.push('fix')
      return script.fix ?? ''
    }
    asked.push('translate')
    return script.translate ?? ''
  }
  return { model, asked }
}

async function publishedAlone(world: World, slug: string) {
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: blogPost({ title: 'Caching at the edge', translationGroup: slug }),
  })
  const id = created.entry?.id ?? ''
  const published = await world.store.publish(world.tenant.key, {
    entryId: id,
    expectedVersion: 1,
    verdict: VERDICT,
    acknowledged: [],
    actor: {
      kind: 'token',
      userId: world.tenant.userId,
      tokenId: world.tenant.tokenId,
      meta: null,
    },
    sortKey: '2026-10-01',
  })
  if (published.outcome !== 'published') throw new Error(JSON.stringify(published))
  return id
}

describe('the reviewer', () => {
  it('comments once on a pending review, in the agents name', async () => {
    const world = await newWorld(env.DB, 'agents-reviewer')
    const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
    const hollware = agentsHollware(world)
    await hollware.call('request_review', { id: en.id, version: en.version })
    const { model, asked } = scripted({ review: '- How it works: add an example.' })

    const first = await reviewPending({ hollware, model, memory: mapMemory() })
    const second = await reviewPending({ hollware, model, memory: mapMemory() })
    const listed = await world.agent.listReviews({})

    expect([first, second, asked]).toEqual([{ commented: 1 }, { commented: 0 }, ['review']])
    expect(listed.reviews?.[0]?.comments.map(({ body, client }) => ({ body, client }))).toEqual([
      { body: '- How it works: add an example.', client: 'hollware-agents' },
    ])
  })
})

const TITLE = 'Caché en el borde, qué guarda, cuánto tiempo dura y cómo se limpia'
const SLUG = 'cache-en-el-borde-que-guarda-cuanto-tiempo-dura-y-como-se-limpia'

describe('the translator', () => {
  it('drafts the missing translation, fixes what the contracts refuse, and asks for its review', async () => {
    const world = await newWorld(env.DB, 'agents-translator')
    await publishedAlone(world, 'edge-guide')
    const spanish = (description: string | null) =>
      blogPost(
        { title: TITLE, description, translationGroup: 'edge-guide' },
        '\n# Caché en el borde\n\nLo que guarda una caché del borde.\n',
      )
    const { model, asked } = scripted({
      translate: spanish(null),
      fix: spanish('Qué guarda el borde.'),
    })
    const memory = mapMemory()

    const first = await translateMissing({ hollware: agentsHollware(world), model, memory })
    const second = await translateMissing({
      hollware: agentsHollware(world),
      model,
      memory: mapMemory(),
    })
    const draft = await world.agent.getEntry({
      collection: 'blog',
      locale: 'es',
      slug: SLUG,
    })
    const reviews = await world.agent.listReviews({})

    expect([first, second]).toEqual([
      { drafted: 1, sentToReview: 1 },
      { drafted: 0, sentToReview: 0 },
    ])
    expect(asked).toEqual(['translate', 'fix'])
    expect([
      draft.entry?.status,
      draft.entry?.version,
      draft.entry?.frontmatter['description'],
    ]).toEqual(['draft', 2, 'Qué guarda el borde.'])
    expect(reviews.reviews?.map((review) => review.entry.slug)).toEqual([SLUG])
  })
})

describe('the translator, interrupted', () => {
  it('tries again a translation whose run stopped before it was saved', async () => {
    const world = await newWorld(env.DB, 'agents-translator-retry')
    await publishedAlone(world, 'edge-guide')
    const memory = mapMemory()
    const failing = async () => {
      throw new Error('the model is down')
    }
    const { model } = scripted({
      translate: blogPost({
        title: 'Caché',
        description: 'Del borde.',
        translationGroup: 'edge-guide',
      }),
    })

    const stopped = await translateMissing({
      hollware: agentsHollware(world),
      model: failing,
      memory,
    }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    const retried = await translateMissing({ hollware: agentsHollware(world), model, memory })

    expect(stopped).toBe('the model is down')
    expect(retried).toEqual({ drafted: 1, sentToReview: 1 })
  })
})

describe('the auditor', () => {
  it('reports what is read and old and what the contracts refuse, as a draft and to the webhook', async () => {
    const world = await newWorld(env.DB, 'agents-auditor')
    await publishedAlone(world, 'edge-guide')
    world.time.set('2027-05-20T10:00:00.000Z')
    await publishedAlone(world, 'fresh-guide')
    const analytics: AnalyticsSources = {
      connection: async () => null,
      topPages: async () => ({
        outcome: 'ok',
        provider: 'cloudflare',
        pages: [
          { path: '/en/blog/edge-guide/', views: 120 },
          { path: '/en/blog/fresh-guide/', views: 90 },
        ],
      }),
      connect: async () => ({ outcome: 'unavailable' }),
      disconnect: async () => false,
    }
    const posted: string[] = []

    const answer = await audit(
      {
        hollware: agentsHollware(world, { analytics }),
        webhook: async (report) => {
          posted.push(report)
        },
      },
      { report: { collection: 'notes', locale: 'en' }, day: '2027-06-01', staleDays: 180 },
    )
    const report = await world.agent.getEntry({
      collection: 'notes',
      locale: 'en',
      slug: 'audit-2027-06-01',
    })

    expect(answer.findings).toBeGreaterThanOrEqual(2)
    expect(report.entry?.status).toBe('draft')
    expect(report.entry?.markdown).toBe(
      posted[0]
        ?.replace('title: "Content audit of 2027-06-01"', 'title: Content audit of 2027-06-01')
        .replace(
          'description: "What the weekly audit of 2027-06-01 found: read but old, and failing contracts."',
          "description: 'What the weekly audit of 2027-06-01 found: read but old, and failing contracts.'",
        ),
    )
    expect(posted[0]).toContain(
      '- /en/blog/edge-guide/ (blog/en/edge-guide): 120 views in 30 days, last updated 2026-10-13',
    )
    expect(posted[0]).not.toContain('/en/blog/fresh-guide/ (')
    expect(posted[0]).toContain('- blog/en/edge-guide: error translation-pair:')
  })
})

describe('the auditor, a step at a time', () => {
  it('goes round the entries a few a run, and reports what every step found', async () => {
    const world = await newWorld(env.DB, 'agents-auditor-steps')
    await publishedAlone(world, 'first-guide')
    await publishedAlone(world, 'second-guide')
    const hollware = agentsHollware(world)
    const memory = mapMemory()
    const report = { collection: 'notes', locale: 'en' } as const
    const step = () =>
      auditStep({ hollware, memory }, { report, now: '2026-10-20T10:00:00.000Z', perRun: 1 })

    const steps = [await step(), await step()]
    await writeReport({ hollware, memory }, { report, day: '2026-10-20' })
    const written = await world.agent.getEntry({
      collection: 'notes',
      locale: 'en',
      slug: 'audit-2026-10-20',
    })

    expect(steps).toEqual([{ checked: 1 }, { checked: 1 }])
    expect(written.entry?.markdown).toContain('- blog/en/first-guide: error translation-pair:')
    expect(written.entry?.markdown).toContain('- blog/en/second-guide: error translation-pair:')
  })
})
