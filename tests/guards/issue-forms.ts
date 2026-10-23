import { plain, readYaml } from '../support/yaml.ts'
import { arrayAt, isRecord, recordAt } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

export interface IssueFormsInput {
  templates: readonly TextFile[]
}

const ELEMENT_TYPES = ['markdown', 'textarea', 'input', 'dropdown', 'checkboxes', 'upload']

const ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  markdown: ['value'],
  textarea: ['label', 'description', 'placeholder', 'value', 'render'],
  input: ['label', 'description', 'placeholder', 'value'],
  dropdown: ['label', 'description', 'options', 'default', 'multiple'],
  checkboxes: ['label', 'description', 'options'],
  upload: ['label', 'description'],
}

const VALIDATIONS: Readonly<Record<string, readonly string[]>> = {
  textarea: ['required', 'min_length'],
  input: ['required', 'min_length'],
  dropdown: ['required'],
  checkboxes: ['required'],
  upload: ['required', 'accept'],
}

const TOP_LEVEL = [
  'name',
  'description',
  'body',
  'assignees',
  'labels',
  'title',
  'type',
  'projects',
]

export const REQUIRED_IDS: Readonly<Record<string, readonly string[]>> = {
  'bug_report.yml': ['version', 'runtime', 'reproduce', 'expected', 'actual', 'logs'],
  'feature_request.yml': ['problem', 'proposal', 'alternatives', 'principle'],
}

export function checkIssueForms(input: IssueFormsInput): Violation[] {
  const violations: Violation[] = []
  const names = new Map<string, string>()
  for (const file of input.templates) {
    const report = (rule: string, message: string): void => {
      violations.push({ rule: `issue-forms/${rule}`, file: file.path, message })
    }
    const base = file.path.slice(file.path.lastIndexOf('/') + 1)
    if (!/\.ya?ml$/.test(base)) continue

    const yaml = readYaml(file.text)
    if (yaml.errors.length > 0) {
      for (const error of yaml.errors) report('yaml', `the file is not valid YAML: ${error}`)
      continue
    }
    const doc = plain(yaml.doc.contents)
    if (!isRecord(doc)) {
      report('yaml', 'the file must hold a YAML mapping')
      continue
    }

    if (base === 'config.yml' || base === 'config.yaml') {
      checkConfig(doc, report)
      continue
    }

    for (const key of ['name', 'description', 'body']) {
      if (doc[key] === undefined) report('top-level', `the form has no "${key}"`)
    }
    for (const key of Object.keys(doc)) {
      if (!TOP_LEVEL.includes(key))
        report('top-level', `the form has an unknown top-level key "${key}"`)
    }
    const name = doc.name
    if (typeof name === 'string') {
      const other = names.get(name)
      if (other !== undefined)
        report('top-level', `the form name "${name}" is also used by ${other}`)
      names.set(name, file.path)
    }
    const body = arrayAt(doc, 'body')
    if (body === undefined || body.length === 0) {
      report('body', '"body" must be a non-empty array of elements')
      continue
    }
    checkBody(body, report)

    const required = REQUIRED_IDS[base]
    if (required !== undefined) {
      const ids = new Set(body.map((element) => (isRecord(element) ? element.id : undefined)))
      for (const id of required) {
        if (!ids.has(id))
          report(
            'required-field',
            `CONTRIBUTING.md says this form asks for "${id}": add an element with that id, or change both`,
          )
      }
    }
  }
  return violations
}

type Report = (rule: string, message: string) => void

function checkConfig(config: Record<string, unknown>, report: Report): void {
  if (config.blank_issues_enabled !== false) {
    report('config', '"blank_issues_enabled" must be false: issues come from the forms')
  }
  const links = arrayAt(config, 'contact_links')
  if (links === undefined || links.length === 0) {
    report('config', '"contact_links" must list at least the private vulnerability reporting link')
  } else {
    for (const link of links) {
      for (const key of ['name', 'url', 'about']) {
        if (!isRecord(link) || typeof link[key] !== 'string' || link[key] === '') {
          report('config', `every contact link needs a non-empty "${key}"`)
        }
      }
    }
  }
  for (const key of Object.keys(config)) {
    if (key !== 'blank_issues_enabled' && key !== 'contact_links') {
      report('config', `config.yml has an unknown key "${key}"`)
    }
  }
}

function checkBody(body: unknown[], report: Report): void {
  const ids = new Set<string>()
  const labels = new Set<string>()
  let inputs = 0
  for (const [index, element] of body.entries()) {
    const where = `body[${index}]`
    if (
      !isRecord(element) ||
      typeof element.type !== 'string' ||
      !ELEMENT_TYPES.includes(element.type)
    ) {
      report('element', `${where}: "type" must be one of ${ELEMENT_TYPES.join(', ')}`)
      continue
    }
    const { type } = element
    const attributes = recordAt(element, 'attributes')
    if (attributes === undefined) {
      report('element', `${where}: "attributes" is required`)
      continue
    }
    for (const key of Object.keys(attributes)) {
      if (!ATTRIBUTES[type]?.includes(key))
        report('attributes', `${where}: "${key}" is not an attribute of ${type}`)
    }

    if (type === 'markdown') {
      if (element.id !== undefined) report('id', `${where}: a markdown element has no id`)
      if (element.validations !== undefined)
        report('validations', `${where}: a markdown element has no validations`)
      if (typeof attributes.value !== 'string' || attributes.value.trim() === '') {
        report('attributes', `${where}: a markdown element needs a non-empty "value"`)
      }
      continue
    }
    inputs += 1

    if (element.id !== undefined) {
      if (typeof element.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(element.id)) {
        report(
          'id',
          `${where}: the id ${JSON.stringify(element.id)} may only use letters, digits, "-" and "_"`,
        )
      } else if (ids.has(element.id)) {
        report('id', `${where}: the id "${element.id}" is used twice`)
      } else {
        ids.add(element.id)
      }
    }
    const label = attributes.label
    if (typeof label !== 'string' || label.trim() === '') {
      report('label', `${where}: "attributes.label" is required`)
    } else if (labels.has(label)) {
      report('label', `${where}: the label "${label}" is used twice`)
    } else {
      labels.add(label)
    }

    const validations = recordAt(element, 'validations')
    for (const key of Object.keys(validations ?? {})) {
      if (!VALIDATIONS[type]?.includes(key))
        report('validations', `${where}: "${key}" is not a validation of ${type}`)
    }
    if (validations?.required !== undefined && typeof validations.required !== 'boolean') {
      report('validations', `${where}: "validations.required" must be true or false`)
    }

    if (type === 'dropdown') checkDropdown(attributes, where, report)
    if (type === 'checkboxes') checkCheckboxes(attributes, where, report)
  }
  if (inputs === 0) report('body', 'a form needs at least one element that is not markdown')
}

function checkDropdown(attributes: Record<string, unknown>, where: string, report: Report): void {
  const options = attributes.options
  if (!Array.isArray(options) || options.length === 0) {
    report('dropdown', `${where}: "options" must be a non-empty array`)
    return
  }
  if (options.some((option) => typeof option !== 'string' || option === '')) {
    report('dropdown', `${where}: every option must be a non-empty string`)
  } else if (new Set(options).size !== options.length) {
    report('dropdown', `${where}: options must be distinct`)
  }
  const fallback = attributes.default
  if (
    fallback !== undefined &&
    (!Number.isInteger(fallback) || Number(fallback) >= options.length)
  ) {
    report('dropdown', `${where}: "default" must be the index of an option`)
  }
  if (attributes.multiple !== undefined && typeof attributes.multiple !== 'boolean') {
    report('dropdown', `${where}: "multiple" must be true or false`)
  }
}

function checkCheckboxes(attributes: Record<string, unknown>, where: string, report: Report): void {
  const options = attributes.options
  if (!Array.isArray(options) || options.length === 0) {
    report('checkboxes', `${where}: "options" must be a non-empty array`)
    return
  }
  for (const option of options) {
    if (!isRecord(option) || typeof option.label !== 'string' || option.label === '') {
      report('checkboxes', `${where}: every checkbox needs a non-empty "label"`)
    } else if (option.required !== undefined && typeof option.required !== 'boolean') {
      report('checkboxes', `${where}: "required" of a checkbox must be true or false`)
    }
  }
}
