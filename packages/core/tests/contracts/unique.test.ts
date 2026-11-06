import { describe, expect, it } from 'vite-plus/test'

import { REFUSAL_CONTRACT_IDS } from '../../src/contracts/builtin.ts'
import {
  parentViolation,
  uniqueSlugViolation,
  uniqueTranslationViolation,
} from '../../src/contracts/unique.ts'

describe('the unique-slug and unique-translation violations', () => {
  it('name the entry that holds the slug, and how to go on', () => {
    expect(uniqueSlugViolation('ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW')).toStrictEqual({
      contract: 'unique-slug',
      severity: 'error',
      path: '',
      message:
        'Another entry of this collection and locale, ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW, already has this slug.',
      fix: 'Choose another slug, or change the entry ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW with update_draft.',
      params: { holder: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW' },
    })
  })

  it('point at the field of the translation group, escaped as a JSON Pointer', () => {
    expect(
      uniqueTranslationViolation('ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW', 'i18n/group'),
    ).toStrictEqual({
      contract: 'unique-translation',
      severity: 'error',
      path: '/frontmatter/i18n~1group',
      message:
        'Another entry of this collection and locale, ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW, already belongs to this translation group.',
      fix: 'Give "i18n/group" another value, or change the entry ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW with update_draft: a translation group holds one entry per locale.',
      params: { field: 'i18n/group', holder: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW' },
    })
  })

  it('make the write refused', () => {
    expect(REFUSAL_CONTRACT_IDS).toContain(uniqueSlugViolation('x').contract)
    expect(REFUSAL_CONTRACT_IDS).toContain(uniqueTranslationViolation('x', 'group').contract)
  })
})

describe('the violation of a nested entry that cannot go under its parent', () => {
  it('says why, by the reason, and what to do', () => {
    expect(parentViolation('too_deep', { parent: 'refunds', maxDepth: 3 })).toStrictEqual({
      contract: 'entry-parent',
      severity: 'error',
      path: '',
      message:
        'Under "refunds", the entry would be deeper than the 3 levels the collection allows.',
      fix: 'Put it under an entry nearer the root, or raise nesting.maxDepth with set_collection.',
      params: { reason: 'too_deep', parent: 'refunds' },
    })
    expect(parentViolation('missing', { parent: 'billing', maxDepth: 3 }).message).toBe(
      'The collection and locale have no entry "billing" to put it under.',
    )
    expect(parentViolation('not_nested', { parent: 'billing', maxDepth: null }).fix).toBe(
      'Leave parent out, or give the collection nesting with set_collection.',
    )
  })
})
