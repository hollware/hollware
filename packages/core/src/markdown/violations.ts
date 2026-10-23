import type { Violation } from '../contracts/types.ts'
import type { JsonProblem } from './json.ts'
import { MAX_DEPTH } from './policy.ts'
import type { Problem } from './analyze.ts'

function refusal(
  contract: 'size-limit' | 'frontmatter-syntax' | 'comark-parse',
  path: '/frontmatter' | '/body',
  message: string,
  fix: string,
  line?: number,
): Violation {
  const violation: Violation = { contract, severity: 'error', path, message, fix }
  return line === undefined ? violation : { ...violation, line }
}

export function sizeLimit(bytes: number, limit: number): Violation {
  return refusal(
    'size-limit',
    '/body',
    `The Markdown file is ${bytes} bytes and this collection accepts at most ${limit}.`,
    `Shorten the file to ${limit} bytes or fewer, counting the frontmatter, or split the content into several entries.`,
  )
}

const YAML_FIX =
  'Put a space after every colon, indent nested keys with spaces (never tabs), quote any value that contains a colon, a hash or a bracket, and give each key only once.'

export function yamlSyntax(
  reason: string,
  line: number | undefined,
  column: number | undefined,
): Violation {
  const where =
    line === undefined ? '' : ` (line ${line}${column === undefined ? '' : `, column ${column}`})`
  return refusal(
    'frontmatter-syntax',
    '/frontmatter',
    `The frontmatter is not valid YAML: ${reason}${where}.`,
    `Fix the YAML between the two --- lines at the top of the file${line === undefined ? '' : `, at line ${line}`}. ${YAML_FIX}`,
    line,
  )
}

export function frontmatterNotMapping(found: string): Violation {
  return refusal(
    'frontmatter-syntax',
    '/frontmatter',
    `The frontmatter must be a YAML mapping of keys to values, but the file starts with ${found}.`,
    'Start the file with a line of three dashes, one "key: value" line for each field and a closing line of three dashes. If the dashes at the top were meant as a horizontal rule, remove them or write *** instead.',
    1,
  )
}

const JSON_PROBLEMS: Readonly<Record<JsonProblem, string>> = {
  shared: 'a YAML anchor or alias, which Hollware does not store',
  depth: `a value nested more than ${MAX_DEPTH} levels deep`,
  number: 'a number that is not finite',
  type: 'a value that is not text, a number, a boolean, null, a list or a mapping',
}

export function frontmatterNotJson(problem: JsonProblem): Violation {
  return refusal(
    'frontmatter-syntax',
    '/frontmatter',
    `The frontmatter holds ${JSON_PROBLEMS[problem]}.`,
    problem === 'shared'
      ? 'Remove the &anchor and *alias markers and write every value out in full.'
      : 'Replace the value with plain text, a number, a boolean, null, a list or a mapping of them.',
    1,
  )
}

const PARSE_FIX =
  'Simplify the Markdown: flatten deep nesting of emphasis, lists, quotes and components, and balance every bracket and brace. If it still fails, split the entry to find the part that breaks.'

export function parseFailure(error: unknown): Violation {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message.split('\n')[0] ?? ''}` : String(error)
  return refusal(
    'comark-parse',
    '/body',
    `Comark could not parse the Markdown (${detail.slice(0, 200)}).`,
    PARSE_FIX,
  )
}

export function notAString(): Violation {
  return refusal(
    'comark-parse',
    '/body',
    'The Markdown is not a string.',
    'Send the whole file, frontmatter and body, as one string.',
  )
}

export function unstorable(problem: Problem): Violation {
  return refusal(
    'comark-parse',
    '/body',
    problem === 'nesting'
      ? `The document nests elements more than ${MAX_DEPTH} levels deep.`
      : `A component prop holds a value that nests more than ${MAX_DEPTH} levels deep or is not JSON.`,
    problem === 'nesting'
      ? 'Flatten the nesting of emphasis, lists, quotes and components.'
      : 'Give the component a smaller, flatter value, written as JSON.',
  )
}
