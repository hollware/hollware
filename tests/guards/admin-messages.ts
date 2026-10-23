import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { TextFile, Violation } from './types.ts'

export interface AdminMessagesInput {
  sources: readonly TextFile[]
  allowed: readonly string[]
  app?: { name: string; messages: string; read: string; list: string }
}

const ADMIN = {
  name: 'the admin',
  messages: 'packages/admin/app/i18n/en.ts and es.ts',
  read: 'useMessages()',
  list: 'ADMIN_TEXT_LITERALS',
}

export const READ_ATTRIBUTES: ReadonlySet<string> = new Set([
  'label',
  'placeholder',
  'title',
  'aria-label',
  'description',
  'help',
  'hint',
  'empty',
  'filter-label',
  'alt',
])

interface TemplateNode {
  readonly type: number
  readonly content?: string
  readonly tag?: string
  readonly loc: { readonly start: { readonly line: number } }
  readonly props?: readonly {
    readonly type: number
    readonly name: string
    readonly value?: { readonly content: string }
    readonly loc: { readonly start: { readonly line: number } }
  }[]
  readonly children?: readonly TemplateNode[]
}

interface CompilerSfc {
  parse(
    source: string,
    options: { filename: string },
  ): {
    descriptor: { template: { ast?: TemplateNode; loc: { start: { line: number } } } | null }
    errors: readonly unknown[]
  }
}

const fromAdmin = createRequire(
  join(import.meta.dirname, '..', '..', 'packages', 'admin', 'package.json'),
)
const compiler: CompilerSfc = fromAdmin('vue/compiler-sfc')

const ELEMENT = 1
const TEXT = 2
const ATTRIBUTE = 6
const LETTER = /\p{L}/u

export function checkAdminMessages(input: AdminMessagesInput): Violation[] {
  const violations: Violation[] = []
  const app = input.app ?? ADMIN
  const allowed = new Set(input.allowed)
  const used = new Set<string>()
  const report = (file: string, kind: 'text' | 'attribute', line: number, text: string) => {
    if (allowed.has(text)) {
      used.add(text)
      return
    }
    violations.push({
      rule: `admin-messages/${kind}`,
      file,
      message: `line ${line} shows ${JSON.stringify(text)}${kind === 'attribute' ? ' as a static attribute' : ''}: put the text in ${app.messages} and read it from ${app.read}`,
    })
  }

  for (const file of input.sources) {
    const { descriptor, errors } = compiler.parse(file.text, { filename: file.path })
    if (errors.length > 0) {
      violations.push({
        rule: 'admin-messages/parse',
        file: file.path,
        message: 'the file does not parse as a Vue single-file component',
      })
      continue
    }
    const root = descriptor.template?.ast
    if (root === undefined) continue
    const visit = (node: TemplateNode): void => {
      if (node.type === TEXT) {
        const text = (node.content ?? '').replace(/\s+/g, ' ').trim()
        if (LETTER.test(text)) report(file.path, 'text', node.loc.start.line, text)
      }
      if (node.type === ELEMENT) {
        for (const prop of node.props ?? []) {
          if (prop.type !== ATTRIBUTE || !READ_ATTRIBUTES.has(prop.name)) continue
          const text = (prop.value?.content ?? '').trim()
          if (LETTER.test(text)) report(file.path, 'attribute', prop.loc.start.line, text)
        }
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(root)
  }

  for (const text of input.allowed) {
    if (!used.has(text)) {
      violations.push({
        rule: 'admin-messages/stale',
        file: 'tests/guards/exceptions.ts',
        message: `${JSON.stringify(text)} is allowed but no template of ${app.name} shows it: remove it from ${app.list}`,
      })
    }
  }
  return violations
}
