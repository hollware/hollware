import { commentReview, getReview, publish, requestReview, unpublish } from '@hollware/core'
import { CliError } from '../errors.ts'
import { printable } from '../format.ts'
import type { Session } from '../import/session.ts'
import { conflictComment, conflictOf, type Written } from './destination.ts'

export const REVIEW_SIZE = 100

export interface Member {
  path: string
  id: string
  version: number
  parent?: string
}

export interface Previous {
  id: string
  publish: Member[]
  unpublish: Member[]
}

export async function pendingReviews(to: Session, ids: readonly string[]): Promise<Previous[]> {
  const pending: Previous[] = []
  for (const id of ids) {
    const answer = await to.call(getReview, { id })
    if (answer.review?.status !== 'pending') continue
    const items = answer.items ?? []
    const member = (item: (typeof items)[number]): Member => ({
      path: `${item.entry.collection}/${item.entry.locale}/${item.entry.slug}`,
      id: item.entry.id,
      version: item.entry.version,
    })
    pending.push({
      id,
      publish: items.filter((item) => item.action === 'publish' && !item.excluded).map(member),
      unpublish: items.filter((item) => item.action === 'unpublish').map(member),
    })
  }
  return pending
}

export async function stillPending(
  to: Session,
  before: readonly Previous[],
): Promise<{ held: Previous[]; cancelled: Previous[] }> {
  const now = new Set(
    (
      await pendingReviews(
        to,
        before.map((one) => one.id),
      )
    ).map((one) => one.id),
  )
  return {
    held: before.filter((one) => now.has(one.id)),
    cancelled: before.filter((one) => !now.has(one.id)),
  }
}

export interface Delivery {
  reviews: string[]
  published: number
  unpublished: number
  waiting: string[]
  asked: Set<string>
}

interface Batch {
  publish: Member[]
  unpublish: Member[]
}

function batches(toPublish: readonly Member[], toUnpublish: readonly Member[]): Batch[] {
  const units = [
    ...treesOf(toPublish).map((members) => ({ publish: members, unpublish: [] as Member[] })),
    ...treesOf(toUnpublish).map((members) => ({ publish: [] as Member[], unpublish: members })),
  ]
  const out: Batch[] = []
  let current: Batch = { publish: [], unpublish: [] }
  for (const unit of units) {
    const size = unit.publish.length + unit.unpublish.length
    const held = current.publish.length + current.unpublish.length
    if (held > 0 && held + size > REVIEW_SIZE) {
      out.push(current)
      current = { publish: [], unpublish: [] }
    }
    current.publish.push(...unit.publish)
    current.unpublish.push(...unit.unpublish)
  }
  if (current.publish.length + current.unpublish.length > 0) out.push(current)
  return out
}

export function treesOf<One extends { path: string; parent?: string }>(
  members: readonly One[],
): One[][] {
  const byPath = new Map(members.map((member) => [member.path, member]))
  const rootOf = (member: One): string => {
    let at = member
    for (
      let above = byPath.get(at.parent ?? '');
      above !== undefined;
      above = byPath.get(at.parent ?? '')
    ) {
      at = above
    }
    return at.path
  }
  const trees = new Map<string, One[]>()
  for (const member of members) {
    const root = rootOf(member)
    trees.set(root, [...(trees.get(root) ?? []), member])
  }
  return [...trees.values()]
}

function refusal(
  what: string,
  answer: { outcome: string; failedEntry?: string | undefined },
  members: readonly Member[],
  verdict:
    | {
        errors: { contract: string; message: string }[]
        warnings: { contract: string; message: string }[]
      }
    | undefined,
): CliError {
  const failed = members.find((member) => member.id === answer.failedEntry)
  const where = failed === undefined ? '' : ` at ${printable(failed.path)}`
  const found = [...(verdict?.errors ?? []), ...(verdict?.warnings ?? [])]
    .map((violation) => printable(`[${violation.contract}] ${violation.message}`))
    .join('; ')
  return new CliError(
    `${what} answered ${answer.outcome}${where}${found === '' ? '' : `: ${found}`}. The drafts are written: fix the content in the source and promote again.`,
  )
}

export async function askForReviews(
  to: Session,
  toPublish: readonly Member[],
  toUnpublish: readonly Member[],
  conflicts: ReadonlyMap<string, Written>,
  acknowledged: readonly { contract: string; path: string }[],
  delivery: Delivery,
): Promise<void> {
  for (const batch of batches(toPublish, toUnpublish)) {
    const [first, ...group] = batch.publish
    if (first === undefined) {
      delivery.waiting.push(...batch.unpublish.map((member) => member.path))
      continue
    }
    const answer = await to.call(requestReview, {
      id: first.id,
      version: first.version,
      group: group.map(({ id, version }) => ({ id, version })),
      unpublish: batch.unpublish.map(({ id, version }) => ({ id, version })),
      acknowledgeWarnings: [...acknowledged],
    })
    if (answer.outcome !== 'pending_review' || answer.review === undefined) {
      throw refusal(
        'request_review',
        answer,
        [...batch.publish, ...batch.unpublish],
        answer.verdict,
      )
    }
    const review = answer.review.id
    delivery.reviews.push(review)
    for (const member of [...batch.publish, ...batch.unpublish]) delivery.asked.add(member.path)
    for (const member of batch.publish) {
      const written = conflicts.get(member.path)
      if (written === undefined) continue
      const conflict = conflictOf(written.promotion.publishedMarkdown ?? '', written.stored)
      await to.call(commentReview, {
        id: review,
        entryId: member.id,
        lines: conflict.lines,
        body: conflictComment(conflict),
      })
    }
  }
}

export async function publishNow(
  to: Session,
  toPublish: readonly Member[],
  toUnpublish: readonly Member[],
  acknowledged: readonly { contract: string; path: string }[],
  delivery: Delivery,
): Promise<void> {
  for (let start = 0; start < toPublish.length; start += REVIEW_SIZE) {
    const [first, ...group] = toPublish.slice(start, start + REVIEW_SIZE)
    if (first === undefined) break
    const members = [first, ...group]
    const answer = await to.call(publish, {
      id: first.id,
      version: first.version,
      group: group.map(({ id, version }) => ({ id, version })),
      acknowledgeWarnings: [...acknowledged],
    })
    if (answer.outcome === 'pending_review' && answer.review !== undefined) {
      delivery.reviews.push(answer.review.id)
    } else if (answer.outcome === 'published') {
      delivery.published += members.length
    } else {
      throw refusal('publish', answer, members, answer.verdict)
    }
    for (const member of members) delivery.asked.add(member.path)
  }
  for (const member of toUnpublish) {
    const answer = await to.call(unpublish, { id: member.id })
    if (answer.outcome === 'unpublished') delivery.unpublished += 1
    delivery.asked.add(member.path)
  }
}
