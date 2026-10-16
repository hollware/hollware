import { describe, expect, it } from 'vite-plus/test'
import { checkAdminMessages } from '../guards/admin-messages.ts'
import { ADMIN_TEXT_LITERALS, exceptionValues, WEB_TEXT_LITERALS } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a template of packages/admin/app shows a text with a letter in it, as a text node or
// as a static label, placeholder, title, aria-label, description, help, hint, empty, filter-label
// or alt, that does not come from the messages of packages/admin/app/i18n, and is not in
// ADMIN_TEXT_LITERALS; or when an entry of that list is shown by no template. The same for the
// templates of hollware.com (apps/web/app), its messages (apps/web/app/i18n) and WEB_TEXT_LITERALS.

const isAdminTemplate = (path: string) => /^packages\/admin\/app\/.+\.vue$/.test(path)
const isWebTemplate = (path: string) => /^apps\/web\/app\/.+\.vue$/.test(path)

describe('admin messages', () => {
  it('every text of a template of the admin comes from its messages', () => {
    const sources = readRepoFiles(isAdminTemplate)
    expect(sources.length).toBeGreaterThan(15)
    expect(
      describeViolations(
        checkAdminMessages({ sources, allowed: exceptionValues(ADMIN_TEXT_LITERALS) }),
      ),
    ).toEqual([])
  })

  it('every text of a template of hollware.com comes from its messages', () => {
    const sources = readRepoFiles(isWebTemplate)
    expect(sources.length).toBeGreaterThan(10)
    expect(
      describeViolations(
        checkAdminMessages({
          sources,
          allowed: exceptionValues(WEB_TEXT_LITERALS),
          app: {
            name: 'hollware.com',
            messages: 'apps/web/app/i18n/en.ts and es.ts',
            read: 'useLocale()',
            list: 'WEB_TEXT_LITERALS',
          },
        }),
      ),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (template: string, allowed: readonly string[] = []) =>
      checkAdminMessages({
        sources: [file('packages/admin/app/pages/X.vue', `<template>\n${template}\n</template>\n`)],
        allowed,
      })

    it('accepts texts read from the messages, and texts with no letter', () => {
      expect(
        check(
          [
            '<Page :title="m.home.title">',
            '  <p>{{ m.home.noViews }}</p>',
            '  <span>{{ a }} · {{ b }}</span>',
            '  <code>---</code>',
            '  <UButton :label="m.entry.save" icon="i-lucide-plus" class="w-full" />',
            '  <svg viewBox="0 0 32 32" aria-hidden="true" />',
            '</Page>',
          ].join('\n'),
        ),
      ).toEqual([])
    })

    it('reports a literal text node, with its line', () => {
      expect(check('<p class="text-muted">\n  No page views yet.\n</p>')).toEqual([
        {
          rule: 'admin-messages/text',
          file: 'packages/admin/app/pages/X.vue',
          message:
            'line 2 shows "No page views yet.": put the text in packages/admin/app/i18n/en.ts and es.ts and read it from useMessages()',
        },
      ])
      expect(check('<span>{{ n }} of {{ total }}</span>').map((v) => v.message)).toEqual([
        'line 2 shows "of": put the text in packages/admin/app/i18n/en.ts and es.ts and read it from useMessages()',
      ])
    })

    it('reports a static attribute a person reads, and leaves the others alone', () => {
      expect(check('<UButton label="Save" variant="ghost" size="sm" />')).toEqual([
        {
          rule: 'admin-messages/attribute',
          file: 'packages/admin/app/pages/X.vue',
          message:
            'line 2 shows "Save" as a static attribute: put the text in packages/admin/app/i18n/en.ts and es.ts and read it from useMessages()',
        },
      ])
      const rules = check(
        [
          '<UInput placeholder="Search" />',
          '<section aria-label="Comments" />',
          '<UModal title="Remove it?" />',
          '<UCheckbox description="Reads content" />',
          '<UFormField help="Markdown." />',
          '<DataTable filter-label="Filter" empty="Nothing." />',
        ].join('\n'),
      ).map((v) => v.rule)
      expect(rules).toEqual(Array(7).fill('admin-messages/attribute'))
    })

    it('lets an allowed literal stay, and reports an allowed one that no template shows', () => {
      expect(check('<span>Hollware</span>', ['Hollware'])).toEqual([])
      expect(check('<span>{{ m.x }}</span>', ['Hollware'])).toEqual([
        {
          rule: 'admin-messages/stale',
          file: 'tests/guards/exceptions.ts',
          message:
            '"Hollware" is allowed but no template of the admin shows it: remove it from ADMIN_TEXT_LITERALS',
        },
      ])
    })
  })
})
