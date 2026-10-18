import { describe, expect, it } from 'vite-plus/test'

import { defineHandlers, type Handlers, type OperationHandler } from '../src/ops/types.ts'

// Fails when: the handler table stops pairing one handler with each operation spec (a type error
// under `vp check`), or defineHandlers stops returning the table it is given.

const notYet = (): Promise<never> => Promise.reject(new Error('implemented in WP7'))

const handlers: Handlers = {
  approve_review: notYet,
  comment_review: notYet,
  content_stats: notYet,
  create_draft: notYet,
  create_site: notYet,
  delete_entry: notYet,
  delete_site: notYet,
  describe_site: notYet,
  get_entry: notYet,
  get_structure: notYet,
  get_translations: notYet,
  list_entries: notYet,
  search: notYet,
  list_reviews: notYet,
  make_webhook_secret: notYet,
  upload_asset: notYet,
  list_assets: notYet,
  get_asset: notYet,
  list_revisions: notYet,
  move_entry: notYet,
  list_backups: notYet,
  list_redirects: notYet,
  schedule_unpublish: notYet,
  get_revision: notYet,
  restore_revision: notYet,
  publish: notYet,
  request_changes: notYet,
  request_review: notYet,
  restore_entry: notYet,
  restore_site: notYet,
  set_collection: notYet,
  unpublish: notYet,
  update_draft: notYet,
  update_site: notYet,
  validate: notYet,
}

describe('the handler table', () => {
  it('pairs one handler with each operation, and nothing else', () => {
    expect(defineHandlers(handlers)).toBe(handlers)
    const { validate, ...missingOne } = handlers
    void validate
    // @ts-expect-error -- `validate` has no handler.
    defineHandlers(missingOne)
    // @ts-expect-error -- `purge_entry` is no operation.
    defineHandlers({ ...handlers, purge_entry: notYet })
  })

  it('types a handler with the input and output of its spec', () => {
    const describe: OperationHandler<'describe_site'> = async (input, context) => {
      expect(input).toEqual({})
      return {
        outcome: 'ok',
        site: {
          key: context.site.key,
          locales: [...context.site.locales],
          defaultLocale: context.site.defaultLocale,
          url: context.site.url,
          styleGuide: context.site.styleGuide,
          collections: [],
        },
      }
    }
    expect(typeof describe).toBe('function')
  })
})
