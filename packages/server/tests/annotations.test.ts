import { OPERATIONS } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { EFFECT_ANNOTATIONS } from '../src/mcp/annotations.ts'

// Fails when: the MCP hints of an effect move away from the map of the v0.1 plan, or an
// operation would reach MCP with hints that do not follow from its effect.

describe('MCP hints', () => {
  it('follow from the effect, and every tool is closed-world', () => {
    expect(EFFECT_ANNOTATIONS).toEqual({
      read: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      edit: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      write: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      destructive: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    })
  })

  it('give the read operations read-only hints, and unpublish, the trash of an entry and the changes of structure destructive ones', () => {
    const hints = Object.fromEntries(
      OPERATIONS.map((operation) => [
        operation.name,
        EFFECT_ANNOTATIONS[operation.effect].readOnlyHint
          ? 'read-only'
          : EFFECT_ANNOTATIONS[operation.effect].destructiveHint
            ? 'destructive'
            : 'changes',
      ]),
    )
    expect(hints).toEqual({
      approve_review: 'changes',
      comment_review: 'changes',
      content_stats: 'read-only',
      create_draft: 'changes',
      create_site: 'changes',
      delete_entry: 'destructive',
      delete_site: 'destructive',
      describe_site: 'read-only',
      get_asset: 'read-only',
      get_entry: 'read-only',
      get_revision: 'read-only',
      get_structure: 'read-only',
      get_translations: 'read-only',
      list_assets: 'read-only',
      list_backups: 'read-only',
      list_entries: 'read-only',
      list_redirects: 'read-only',
      list_reviews: 'read-only',
      list_revisions: 'read-only',
      make_webhook_secret: 'changes',
      move_entry: 'changes',
      publish: 'changes',
      request_changes: 'changes',
      request_review: 'changes',
      restore_entry: 'changes',
      restore_revision: 'changes',
      restore_site: 'changes',
      schedule_unpublish: 'destructive',
      search: 'read-only',
      set_collection: 'destructive',
      unpublish: 'destructive',
      update_draft: 'changes',
      update_site: 'destructive',
      upload_asset: 'changes',
      validate: 'read-only',
    })
  })
})
