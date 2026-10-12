import { describe, expect, it } from 'vite-plus/test'
import { checkIssueForms } from '../guards/issue-forms.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a file in .github/ISSUE_TEMPLATE is not valid YAML or breaks GitHub's issue-form
// schema (name, description, body; element types, attributes and validations; unique ids and
// labels; markdown without an id), config.yml allows blank issues, or a form stops asking for
// what CONTRIBUTING.md says it asks for.

const input = (label: string, extra: Record<string, unknown> = {}) => ({
  type: 'input',
  id: label,
  attributes: { label },
  ...extra,
})

const form = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'A form',
  description: 'What it is for.',
  body,
  ...extra,
})

const check = (value: unknown, name = 'other.yml') =>
  checkIssueForms({ templates: [file(`.github/ISSUE_TEMPLATE/${name}`, json(value))] })

const rules = (value: unknown, name?: string) =>
  check(value, name).map((violation) => violation.rule)

const messages = (value: unknown, name?: string) =>
  check(value, name).map((violation) => violation.message)

describe('issue forms', () => {
  it('every form and the chooser configuration of the repository are valid', () => {
    const templates = readRepoFiles((path) => path.startsWith('.github/ISSUE_TEMPLATE/'))
    expect(templates.map((template) => template.path)).toEqual([
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
    ])
    expect(describeViolations(checkIssueForms({ templates }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a form with every kind of element', () => {
      const good = form([
        { type: 'markdown', attributes: { value: 'Read this first.' } },
        input('one', { validations: { required: true } }),
        { type: 'textarea', id: 'two', attributes: { label: 'Two', render: 'shell' } },
        {
          type: 'dropdown',
          id: 'three',
          attributes: { label: 'Three', options: ['a', 'b'], default: 1, multiple: true },
        },
        {
          type: 'checkboxes',
          id: 'four',
          attributes: { label: 'Four', options: [{ label: 'x', required: true }] },
        },
        {
          type: 'upload',
          id: 'five',
          attributes: { label: 'Five' },
          validations: { accept: '.png' },
        },
      ])
      expect(check(good)).toEqual([])
    })

    it('accepts the chooser configuration', () => {
      const config = {
        blank_issues_enabled: false,
        contact_links: [{ name: 'n', url: 'https://example.com', about: 'a' }],
      }
      expect(check(config, 'config.yml')).toEqual([])
    })

    it('reports a form without a description or a body, and an unknown key', () => {
      expect(messages({ name: 'A form', body: [input('a')], extra: 1 })).toEqual([
        'the form has no "description"',
        'the form has an unknown top-level key "extra"',
      ])
      expect(messages({ name: 'A form', description: 'x' })).toEqual([
        'the form has no "body"',
        '"body" must be a non-empty array of elements',
      ])
    })

    it('reports an unknown element type and an element without attributes', () => {
      expect(messages(form([{ type: 'radio', attributes: { label: 'x' } }]))).toEqual([
        'body[0]: "type" must be one of markdown, textarea, input, dropdown, checkboxes, upload',
        'a form needs at least one element that is not markdown',
      ])
      expect(messages(form([{ type: 'input', id: 'a' }]))).toContain(
        'body[0]: "attributes" is required',
      )
    })

    it('reports ids that repeat or use forbidden characters, and markdown with an id', () => {
      expect(messages(form([input('a'), input('a', { attributes: { label: 'other' } })]))).toEqual([
        'body[1]: the id "a" is used twice',
      ])
      expect(messages(form([input('has space')]))).toEqual([
        'body[0]: the id "has space" may only use letters, digits, "-" and "_"',
      ])
      expect(
        messages(form([{ type: 'markdown', id: 'm', attributes: { value: 'x' } }, input('a')])),
      ).toEqual(['body[0]: a markdown element has no id'])
    })

    it('reports a missing or repeated label', () => {
      expect(messages(form([{ type: 'input', id: 'a', attributes: {} }]))).toEqual([
        'body[0]: "attributes.label" is required',
      ])
      expect(messages(form([input('a', { id: 'x' }), input('a', { id: 'y' })]))).toEqual([
        'body[1]: the label "a" is used twice',
      ])
    })

    it('reports attributes and validations that do not belong to the type', () => {
      const dropdown = {
        type: 'dropdown',
        id: 'd',
        attributes: { label: 'D', options: ['a'], placeholder: 'x' },
        validations: { min_length: 3 },
      }
      expect(messages(form([dropdown]))).toEqual([
        'body[0]: "placeholder" is not an attribute of dropdown',
        'body[0]: "min_length" is not a validation of dropdown',
      ])
      expect(messages(form([input('a', { validations: { required: 'yes' } })]))).toEqual([
        'body[0]: "validations.required" must be true or false',
      ])
    })

    it('reports a dropdown with no options, repeated options or a default out of range', () => {
      const dropdown = (attributes: Record<string, unknown>) =>
        form([{ type: 'dropdown', id: 'd', attributes: { label: 'D', ...attributes } }])
      expect(messages(dropdown({ options: [] }))).toEqual([
        'body[0]: "options" must be a non-empty array',
      ])
      expect(messages(dropdown({ options: ['a', 'a'] }))).toEqual([
        'body[0]: options must be distinct',
      ])
      expect(messages(dropdown({ options: ['a'], default: 3 }))).toEqual([
        'body[0]: "default" must be the index of an option',
      ])
    })

    it('reports a checkbox without a label', () => {
      const boxes = form([
        { type: 'checkboxes', id: 'c', attributes: { label: 'C', options: [{ required: true }] } },
      ])
      expect(messages(boxes)).toEqual(['body[0]: every checkbox needs a non-empty "label"'])
    })

    it('reports a form that is all markdown', () => {
      expect(messages(form([{ type: 'markdown', attributes: { value: 'x' } }]))).toEqual([
        'a form needs at least one element that is not markdown',
      ])
    })

    it('reports a chooser that allows blank issues or has a broken link', () => {
      const link = { name: 'n', url: 'https://example.com', about: 'a' }
      expect(messages({ blank_issues_enabled: true, contact_links: [link] }, 'config.yml')).toEqual(
        ['"blank_issues_enabled" must be false: issues come from the forms'],
      )
      expect(
        messages(
          { blank_issues_enabled: false, contact_links: [{ ...link, url: '' }] },
          'config.yml',
        ),
      ).toEqual(['every contact link needs a non-empty "url"'])
      expect(messages({ blank_issues_enabled: false }, 'config.yml')).toEqual([
        '"contact_links" must list at least the private vulnerability reporting link',
      ])
    })

    it('reports a form name that two files share', () => {
      const result = checkIssueForms({
        templates: [
          file('.github/ISSUE_TEMPLATE/a.yml', json(form([input('a')]))),
          file('.github/ISSUE_TEMPLATE/b.yml', json(form([input('a')]))),
        ],
      })
      expect(result.map((violation) => violation.message)).toEqual([
        'the form name "A form" is also used by .github/ISSUE_TEMPLATE/a.yml',
      ])
    })

    it('reports a form that stops asking for what CONTRIBUTING.md says it asks for', () => {
      expect(messages(form([input('version')]), 'bug_report.yml')).toEqual([
        'CONTRIBUTING.md says this form asks for "runtime": add an element with that id, or change both',
        'CONTRIBUTING.md says this form asks for "reproduce": add an element with that id, or change both',
        'CONTRIBUTING.md says this form asks for "expected": add an element with that id, or change both',
        'CONTRIBUTING.md says this form asks for "actual": add an element with that id, or change both',
        'CONTRIBUTING.md says this form asks for "logs": add an element with that id, or change both',
      ])
      expect(rules(form([input('problem')]), 'feature_request.yml')).toHaveLength(3)
    })

    it('reports a file that is not valid YAML', () => {
      const result = checkIssueForms({
        templates: [file('.github/ISSUE_TEMPLATE/bad.yml', 'name: [unclosed')],
      })
      expect(result.map((violation) => violation.rule)).toContain('issue-forms/yaml')
    })
  })
})
