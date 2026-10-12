import { describe, expect, it } from 'vite-plus/test'

import { defineHandlers, type Handlers, type OperationHandler } from '../src/ops/types.ts'

// Fails when: the handler table stops pairing one handler with each operation spec (a type error
// under `vp check`), or defineHandlers stops returning the table it is given.

const notYet = (): Promise<never> => Promise.reject(new Error('implemented in WP7'))

const handlers: Handlers = {
  create_draft: notYet,
  describe_site: notYet,
  get_entry: notYet,
  get_translations: notYet,
  list_entries: notYet,
  publish: notYet,
  unpublish: notYet,
  update_draft: notYet,
  validate: notYet,
}

describe('the handler table', () => {
  it('pairs one handler with each operation, and nothing else', () => {
    expect(defineHandlers(handlers)).toBe(handlers)
    const { validate, ...missingOne } = handlers
    void validate
    // @ts-expect-error -- `validate` has no handler.
    defineHandlers(missingOne)
    // @ts-expect-error -- `delete_entry` is no operation of v0.1.
    defineHandlers({ ...handlers, delete_entry: notYet })
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
          styleGuide: context.site.styleGuide,
          collections: [],
        },
      }
    }
    expect(typeof describe).toBe('function')
  })
})
