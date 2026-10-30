import type { Hollware } from './hollware.ts'
import type { Memory } from './memory.ts'
import type { Model } from './model.ts'
import { list, record, text } from './read.ts'

export const AGENTS_CLIENT = 'hollware-agents'

export const MAX_REVIEWS = 8

export const MAX_COMMENT = 3500

export const REVIEWER_PROMPT = [
  'You review an entry of a website before a person decides whether to publish it.',
  'The contracts of the site already checked its schema, links, images and translations: never repeat those.',
  'Read it as an editor: is it clear, does it follow the style guide, does each claim have an example, is anything missing, wrong or out of date?',
  'Answer in the language of the entry, in Markdown, in at most eight short bullet points, the most important first.',
  'Name the section of each point. Say what reads well in one bullet at most. Do not rewrite the entry.',
].join(' ')

export interface ReviewerDeps {
  readonly hollware: Hollware
  readonly model: Model
  readonly memory: Memory
}

/**
 * Comments once on each pending review: what the contracts cannot see. A review that has a
 * comment of the agents, or that the memory has, is left alone, so a run that fails halfway is
 * picked up by the next one without commenting twice.
 */
export async function reviewPending(deps: ReviewerDeps): Promise<{ readonly commented: number }> {
  const site = record((await deps.hollware.call('describe_site', {}))['site'])
  const reviews = list((await deps.hollware.call('list_reviews', { status: 'pending' }))['reviews'])
  let commented = 0
  for (const review of reviews) {
    if (commented >= MAX_REVIEWS) break
    const id = text(review['id'])
    if (id === null) continue
    const ours = list(review['comments']).some((comment) => comment['client'] === AGENTS_CLIENT)
    if (ours || (await deps.memory.get(`reviewed:${id}`)) !== null) continue
    const summary = record(review['entry'])
    const found = record(
      (
        await deps.hollware.call('get_entry', {
          collection: summary['collection'],
          locale: summary['locale'],
          slug: summary['slug'],
        })
      )['entry'],
    )
    const markdown = text(found['markdown'])
    if (markdown === null) continue
    const collection = list(site['collections']).find(
      (one) => one['name'] === summary['collection'],
    )
    const guides = [text(site['styleGuide']), text(collection?.['styleGuide'])].filter(
      (guide): guide is string => guide !== null,
    )
    const answer = (
      await deps.model([
        { role: 'system', content: REVIEWER_PROMPT },
        {
          role: 'user',
          content: [
            `Style guide:\n${guides.length === 0 ? '(none)' : guides.join('\n\n')}`,
            `Entry (${String(summary['locale'])}):\n\n${markdown}`,
          ].join('\n\n'),
        },
      ])
    ).trim()
    if (answer === '') continue
    const result = await deps.hollware.call('comment_review', { id, body: clipped(answer) })
    await deps.memory.put(`reviewed:${id}`, String(result['outcome']), 30 * 86_400)
    if (result['outcome'] === 'commented') commented += 1
  }
  return { commented }
}

export const MAX_ITEMS = 8

function clipped(answer: string): string {
  return answer.length > MAX_COMMENT ? `${answer.slice(0, MAX_COMMENT)}…` : answer
}

/**
 * Comments on one review, read with `get_review`: one comment on the whole review when it changes
 * one entry, one comment on each entry it proposes otherwise. A review the memory has is left
 * alone, so a delivery that comes again does not comment twice.
 */
export async function reviewById(
  deps: ReviewerDeps,
  id: string,
): Promise<{ readonly commented: number }> {
  if ((await deps.memory.get(`reviewed:${id}`)) !== null) return { commented: 0 }
  const site = record((await deps.hollware.call('describe_site', {}))['site'])
  const answer = await deps.hollware.call('get_review', { id })
  if (answer['outcome'] !== 'ok') {
    await deps.memory.put(`reviewed:${id}`, String(answer['outcome']), 30 * 86_400)
    return { commented: 0 }
  }
  const items = list(answer['items'])
  const anchored = items.length > 1
  let commented = 0
  let outcome = 'ok'
  for (const item of items.slice(0, MAX_ITEMS)) {
    const markdown = text(item['proposed'])
    if (markdown === null || item['excluded'] === true) continue
    const entry = record(item['entry'])
    const collection = list(site['collections']).find((one) => one['name'] === entry['collection'])
    const guides = [text(site['styleGuide']), text(collection?.['styleGuide'])].filter(
      (guide): guide is string => guide !== null,
    )
    const said = (
      await deps.model([
        { role: 'system', content: REVIEWER_PROMPT },
        {
          role: 'user',
          content: [
            `Style guide:\n${guides.length === 0 ? '(none)' : guides.join('\n\n')}`,
            `Entry (${String(entry['locale'])}):\n\n${markdown}`,
          ].join('\n\n'),
        },
      ])
    ).trim()
    if (said === '') continue
    const result = await deps.hollware.call('comment_review', {
      id,
      body: clipped(said),
      ...(anchored ? { entryId: entry['id'] } : {}),
    })
    outcome = String(result['outcome'])
    if (outcome !== 'commented') break
    commented += 1
  }
  await deps.memory.put(`reviewed:${id}`, outcome, 30 * 86_400)
  return { commented }
}
