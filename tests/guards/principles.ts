import { sectionLines } from '../support/markdown.ts'
import { plain, readYaml } from '../support/yaml.ts'
import { arrayAt, isRecord, isStringArray } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `principles`: the five principles named in the README are the options of the "Related
 * principle" dropdown of the feature request form, in the same words and order, followed by
 * the option for a proposal that fits none of them. A principle renamed in one place and not
 * in the other would send contributors to a name that no longer exists.
 */

export interface PrinciplesInput {
  /** `README.md`. */
  readme: TextFile
  /** `.github/ISSUE_TEMPLATE/feature_request.yml`. */
  featureRequest: TextFile
}

export const NO_PRINCIPLE_OPTION = 'None of them, or I am not sure'
export const PRINCIPLE_COUNT = 5

/** The names of the numbered principles of the README, without their final period. */
export function principlesOf(readme: string): string[] {
  const names: string[] = []
  for (const { line } of sectionLines(readme, 'Principles')) {
    const match = /^\d+\.\s+\*\*(.+?)\*\*/.exec(line)
    const name = match?.[1]
    if (name !== undefined) names.push(name.replace(/\.$/, '').trim())
  }
  return names
}

export function checkPrinciples(input: PrinciplesInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, file: string, message: string): void => {
    violations.push({ rule: `principles/${rule}`, file, message })
  }

  const names = principlesOf(input.readme.text)
  if (names.length !== PRINCIPLE_COUNT) {
    report(
      'count',
      input.readme.path,
      `the "## Principles" section must list exactly ${PRINCIPLE_COUNT} numbered principles, each starting with its bold name, found ${names.length}`,
    )
  }

  const yaml = readYaml(input.featureRequest.text)
  const form = plain(yaml.doc.contents)
  const body = arrayAt(form, 'body') ?? []
  const dropdown = body.find((element) => isRecord(element) && element.id === 'principle')
  const options =
    isRecord(dropdown) && isRecord(dropdown.attributes) ? dropdown.attributes.options : undefined
  if (!isStringArray(options)) {
    report(
      'dropdown',
      input.featureRequest.path,
      'the form needs a dropdown with the id "principle" and a list of options',
    )
    return violations
  }
  if (options[options.length - 1] !== NO_PRINCIPLE_OPTION) {
    report(
      'none-option',
      input.featureRequest.path,
      `the last option of the dropdown must be ${JSON.stringify(NO_PRINCIPLE_OPTION)}, found ${JSON.stringify(options[options.length - 1])}`,
    )
  }
  const named = options.slice(0, -1)
  if (JSON.stringify(named) !== JSON.stringify(names)) {
    report(
      'mismatch',
      input.featureRequest.path,
      `the dropdown options ${JSON.stringify(named)} must equal the principles of the README ${JSON.stringify(names)}, in the same order`,
    )
  }
  return violations
}
