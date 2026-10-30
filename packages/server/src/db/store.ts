import type { Clock, ContentStore } from '../ports.ts'
import { connect, type D1Like } from './d1.ts'
import * as history from './history.ts'
import * as reads from './reads.ts'
import * as reviews from './reviews.ts'
import * as schedules from './schedules.ts'
import * as writes from './writes.ts'

export interface StoreOptions {
  readonly clock?: Clock
}

const systemClock: Clock = { now: () => new Date() }

export function createD1Store(db: D1Like, options: StoreOptions = {}): ContentStore {
  const database = connect(db)
  const clock = options.clock ?? systemClock
  return {
    findEntry: (site, ref, view) => reads.findEntry(database, site, ref, view),
    findEntryById: (site, id, view) => reads.findEntryById(database, site, id, view),
    listEntries: (site, query) => reads.listEntries(database, site, query),
    searchEntries: (site, query) => reads.searchEntries(database, site, query),
    findSummaries: (site, ids, view) => reads.findSummaries(database, site, ids, view),
    relatedOf: (site, entryId) => reads.relatedOf(database, site, entryId),
    listTranslations: (site, collection, translationGroup, view) =>
      reads.listTranslations(database, site, collection, translationGroup, view),
    lookup: (site) => reads.lookup(database, site),
    lastPublication: (site, entryId) => reads.lastPublication(database, site, entryId),
    listRevisions: (site, entryId, limit, cursor) =>
      history.listRevisions(database, site, entryId, limit, cursor),
    findRevision: (site, id) => history.findRevision(database, site, id),
    sourceHeadTimes: (site, sourceLocale, pairs) =>
      history.sourceHeadTimes(database, site, sourceLocale, pairs),
    revisionTimes: (site, ids) => history.revisionTimes(database, site, ids),
    createEntry: (site, entry) => writes.createEntry(database, clock, site, entry),
    appendRevision: (site, write) => writes.appendRevision(database, clock, site, write),
    publish: (site, write) => writes.publish(database, clock, site, write),
    publishGroup: (site, group) => writes.publishGroup(database, clock, site, group),
    schedule: (site, write) => schedules.schedule(database, clock, site, write),
    dueSchedules: (site, now) => schedules.dueSchedules(database, site, now),
    cancelSchedule: (site, entryId) => schedules.cancelSchedule(database, clock, site, entryId),
    scheduleUnpublish: (site, write) => schedules.scheduleUnpublish(database, clock, site, write),
    cancelUnpublish: (site, entryId) => schedules.cancelUnpublish(database, site, entryId),
    unpublishOf: (site, entryId) => schedules.unpublishOf(database, site, entryId),
    dueUnpublishes: (site, now) => schedules.dueUnpublishes(database, site, now),
    unpublish: (site, write) => writes.unpublish(database, clock, site, write),
    trashEntry: (site, write) => writes.trashEntry(database, clock, site, write),
    moveEntry: (site, write) => writes.moveEntry(database, clock, site, write),
    listRedirects: (site, query) => writes.listRedirects(database, site, query),
    restoreEntry: (site, entryId) => writes.restoreEntry(database, clock, site, entryId),
    requestReview: (site, write) =>
      reviews.requestReview(database, clock, site, write, (entryId) =>
        writes.whyNothingChanged(database, site, entryId),
      ),
    reviewItems: (site, reviewIds) => reviews.reviewItemsOf(database, site, reviewIds),
    revisionMarkdown: (site, ids) => reviews.revisionMarkdown(database, site, ids),
    approveReview: (site, write) => writes.approveReview(database, clock, site, write),
    findReview: (site, id) => reviews.findReview(database, site, id),
    listReviews: (site, query) => reviews.listReviews(database, site, query),
    requestChanges: (site, write) => reviews.requestChanges(database, clock, site, write),
    rejectReview: (site, write) => reviews.rejectReview(database, clock, site, write),
    commentReview: (site, write) => reviews.commentReview(database, clock, site, write),
    reviewComments: (site, reviewIds) => reviews.reviewCommentsOf(database, site, reviewIds),
    reviewAgentRuns: (site, reviewIds) => reviews.agentRunsOf(database, site, reviewIds),
    markAgentRun: (site, run) => reviews.markAgentRun(database, clock, site, run),
  }
}
