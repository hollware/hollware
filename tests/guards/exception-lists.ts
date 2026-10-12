import { parseSync, Visitor } from 'vite-plus'
import type { ExceptionList } from './exceptions.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `exceptions`: an exception list may only shrink.
 *
 * Every list of `tests/guards/exceptions.ts` records its size in `max`. It fails when a list
 * is longer than `max` (an exception was added without raising the number on purpose, which a
 * reviewer then sees), and when it is shorter (an exception was removed and the recorded
 * number is stale, which would leave room for a silent addition later). Entries are unique
 * and each has a reason.
 *
 * Exceptions live in that file and nowhere else. The second check parses the guard sources
 * and reports a top-level constant that is named like an allowlist (`ALLOWED_X`, `IGNORES`,
 * `SKIP_LIST`, `KNOWN_EXCEPTIONS`) and holds an array, a Set or an object. It is a heuristic:
 * it finds the natural way to write an exception, not every way.
 */

export function checkExceptionLists(lists: Readonly<Record<string, ExceptionList>>): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, name: string, message: string): void => {
    violations.push({
      rule: `exceptions/${rule}`,
      file: 'tests/guards/exceptions.ts',
      message: `${name}: ${message}`,
    })
  }
  for (const [name, list] of Object.entries(lists)) {
    const size = list.entries.length
    if (size > list.max) {
      report(
        'over-max',
        name,
        `has ${size} entries but max is ${list.max}: exception lists only shrink, so fix the cause instead of adding an exception`,
      )
    } else if (size < list.max) {
      report(
        'slack',
        name,
        `has ${size} entries but max is ${list.max}: lower max to ${size}, or it leaves room to add an exception unnoticed`,
      )
    }
    const seen = new Set<string>()
    for (const { value } of list.entries) {
      if (seen.has(value)) report('duplicate', name, `${JSON.stringify(value)} is listed twice`)
      seen.add(value)
    }
    for (const entry of list.entries) {
      if (entry.reason.trim().length < 10) {
        report(
          'no-reason',
          name,
          `${JSON.stringify(entry.value)} needs a reason of at least a sentence`,
        )
      }
    }
  }
  return violations
}

const ALLOWLIST_NAME =
  /(?:^|_)(?:ALLOW(?:ED|LIST)?|EXCEPTIONS?|IGNORES?|SKIPS?|SKIPPED|WHITELIST|WAIVERS?)(?:_|$)/i

/** Guard sources that may declare exceptions: none. They take them as arguments. */
export function checkNoStrayExceptions(files: readonly TextFile[]): Violation[] {
  const violations: Violation[] = []
  for (const file of files) {
    const result = parseSync(file.path, file.text)
    new Visitor({
      Program(program) {
        for (const statement of program.body) {
          const declaration =
            statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
          if (declaration?.type !== 'VariableDeclaration') continue
          for (const declarator of declaration.declarations) {
            if (declarator.id.type !== 'Identifier' || !ALLOWLIST_NAME.test(declarator.id.name))
              continue
            const init = declarator.init
            const holdsData =
              init?.type === 'ArrayExpression' ||
              init?.type === 'ObjectExpression' ||
              (init?.type === 'NewExpression' &&
                init.callee.type === 'Identifier' &&
                ['Set', 'Map'].includes(init.callee.name))
            if (holdsData) {
              violations.push({
                rule: 'exceptions/stray-list',
                file: file.path,
                message: `${declarator.id.name} looks like an exception list outside tests/guards/exceptions.ts: move it there with a max and a reason, and pass it to the guard as an argument`,
              })
            }
          }
        }
      },
    }).visit(result.program)
  }
  return violations
}
