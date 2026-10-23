import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'
import { commentsIn, commentSyntaxOf, type Comment } from '../support/comments.ts'
import { isMap, isScalar, isSeq, readYaml } from '../support/yaml.ts'
import { lineAt } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

export interface CommentsInput {
  files: readonly TextFile[]
  bins: readonly string[]
  publicNames: Readonly<Record<string, readonly string[]>>
  shippedMigrations: readonly string[]
  zizmorIgnores: readonly string[]
  themeFiles: readonly string[]
}

export interface RejectedComment {
  file: string
  line: number
  comment: Comment
}

const REFERENCE = /^\/\/\/ <reference (?:types|path|lib)="[^"]+" \/>$/
const TS_EXPECT_ERROR = /^\/\/ @ts-expect-error -- \S/
const OXLINT_DISABLE = /^\/\/ oxlint-disable-next-line [\w/@-]+(?:, [\w/@-]+)* -- \S/
const THEME_MARKERS = new Set(['/* theme:start */', '/* theme:end */'])
const VERSION_PIN = /^# v\d+\.\d+\.\d+$/
const PINNED_USES = /^\s*(?:-\s+)?uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+$/
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/
const MIGRATION = /^packages\/server\/migrations\/[^/]+\.sql$/
const BREAKPOINT = '--> statement-breakpoint'
const ZIZMOR = /^# (zizmor: ignore\[[^\]]+\])$/
const PNPM_WORKSPACE = 'pnpm-workspace.yaml'
const PNPM_EXCLUDES = [
  ['minimumReleaseAgeExclude'],
  ['trustPolicyExclude'],
  ['auditConfig', 'ignoreGhsas'],
] as const

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

function isTrailing(text: string, comment: Comment): boolean {
  return text.slice(lineStart(text, comment.start), comment.start).trim() !== ''
}

function pnpmReasonLines(text: string): Set<number> {
  const yaml = readYaml(text)
  const lines = new Set<number>()
  const add = (node: unknown): void => {
    if (isScalar(node) && node.range) lines.add(yaml.lineOf(node.range[0]))
  }
  for (const path of PNPM_EXCLUDES) {
    const list = yaml.doc.getIn(path, true)
    if (isSeq(list)) for (const item of list.items) add(item)
  }
  const builds = yaml.doc.get('allowBuilds', true)
  if (isMap(builds)) for (const pair of builds.items) add(pair.value)
  return lines
}

type Program = ReturnType<typeof parseSync>['program']

function declaredNames(node: ESTree.Node): string[] {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSEnumDeclaration':
      return node.id === null ? [] : [node.id.name]
    case 'TSModuleDeclaration':
      return node.id.type === 'Identifier' ? [node.id.name] : []
    case 'VariableDeclaration':
      return node.declarations.flatMap((declarator) =>
        declarator.id.type === 'Identifier' ? [declarator.id.name] : [],
      )
    default:
      return []
  }
}

function exportName(node: ESTree.ModuleExportName): string {
  return node.type === 'Literal' ? node.value : node.name
}

function publicDocAnchors(program: Program, names: ReadonlySet<string>): Set<number> {
  const reexported = new Map<string, string[]>()
  for (const statement of program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.source !== null) continue
    for (const specifier of statement.specifiers) {
      if (specifier.local.type !== 'Identifier') continue
      const local = specifier.local.name
      reexported.set(local, [...(reexported.get(local) ?? []), exportName(specifier.exported)])
    }
  }
  const anchors = new Set<number>()
  for (const statement of program.body) {
    let declaration: ESTree.Node | null = null
    let exported: string[] = []
    if (statement.type === 'ExportNamedDeclaration' && statement.declaration !== null) {
      declaration = statement.declaration
      exported = declaredNames(statement.declaration)
    } else if (statement.type !== 'ExportNamedDeclaration') {
      declaration = statement
      exported = declaredNames(statement).flatMap((name) => reexported.get(name) ?? [])
    }
    if (declaration === null || !exported.some((name) => names.has(name))) continue
    anchors.add(statement.start)
    const bodies: [number, number][] = []
    const members: number[] = []
    const member = (node: { start: number }): void => {
      members.push(node.start)
    }
    const body = (node: { body: { start: number; end: number } | null }): void => {
      if (node.body !== null) bodies.push([node.body.start, node.body.end])
    }
    new Visitor({
      TSPropertySignature: member,
      TSMethodSignature: member,
      TSIndexSignature: member,
      TSCallSignatureDeclaration: member,
      TSConstructSignatureDeclaration: member,
      PropertyDefinition: member,
      MethodDefinition: member,
      AccessorProperty: member,
      TSEnumMember: member,
      Property: member,
      FunctionDeclaration: body,
      FunctionExpression: body,
      ArrowFunctionExpression: body,
    }).visit({ ...program, body: [statement] })
    for (const start of members) {
      if (!bodies.some(([from, to]) => start > from && start < to)) anchors.add(start)
    }
  }
  return anchors
}

function nextCode(text: string, offset: number): number {
  let i = offset
  while (i < text.length && /\s/.test(text.charAt(i))) i += 1
  return i
}

function packageOf(
  file: string,
  publicNames: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  return Object.keys(publicNames).find((directory) => file.startsWith(`${directory}/src/`))
}

export function rejectedComments(input: CommentsInput): RejectedComment[] {
  const rejected: RejectedComment[] = []
  const bins = new Set(input.bins)
  const shipped = new Set(input.shippedMigrations)
  const zizmor = new Set(input.zizmorIgnores)
  const themes = new Set(input.themeFiles)
  const publicSets = new Map(
    Object.entries(input.publicNames).map(([directory, names]) => [directory, new Set(names)]),
  )
  for (const { path, text } of input.files) {
    if (shipped.has(path)) continue
    const syntax = commentSyntaxOf(path)
    const comments = commentsIn(path, text)
    if (comments.length === 0) continue
    let anchors: Set<number> | undefined
    let firstStatement = text.length
    if (syntax === 'script') {
      const program = parseSync(path, text).program
      firstStatement = program.body[0]?.start ?? text.length
      const directory = packageOf(path, input.publicNames)
      const names = directory === undefined ? undefined : publicSets.get(directory)
      if (names !== undefined) anchors = publicDocAnchors(program, names)
    }
    const reasonLines = path === PNPM_WORKSPACE ? pnpmReasonLines(text) : new Set<number>()
    const allowed = (comment: Comment): boolean => {
      const raw = comment.text
      if (comment.start === 0 && raw.startsWith('#!')) return syntax === 'shell' || bins.has(path)
      if (syntax === 'script') {
        if (REFERENCE.test(raw)) return comment.end <= firstStatement
        if (TS_EXPECT_ERROR.test(raw) || OXLINT_DISABLE.test(raw)) return true
        if (raw.startsWith('/**') && raw !== '/**/' && anchors !== undefined) {
          return anchors.has(nextCode(text, comment.end))
        }
        return false
      }
      if (syntax === 'css') return themes.has(path) && THEME_MARKERS.has(raw)
      if (syntax === 'sql') return MIGRATION.test(path) && raw === BREAKPOINT
      if (syntax === 'yaml') {
        const directive = ZIZMOR.exec(raw)?.[1]
        if (directive !== undefined) return zizmor.has(`${path}#${directive}`)
        if (path === PNPM_WORKSPACE) {
          return isTrailing(text, comment) && reasonLines.has(lineAt(text, comment.start))
        }
        return (
          WORKFLOW.test(path) &&
          VERSION_PIN.test(raw) &&
          PINNED_USES.test(text.slice(lineStart(text, comment.start), comment.start))
        )
      }
      return false
    }
    for (const comment of comments) {
      if (!allowed(comment))
        rejected.push({ file: path, line: lineAt(text, comment.start), comment })
    }
  }
  return rejected
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}...` : flat
}

export function checkComments(input: CommentsInput): Violation[] {
  const violations: Violation[] = rejectedComments(input).map(({ file, line, comment }) => ({
    rule: 'comments/found',
    file,
    message: `line ${line}: ${JSON.stringify(preview(comment.text))} is a comment: say it in a name, a test or an AGENTS.md, or delete it`,
  }))
  const texts = new Map(input.files.map((file) => [file.path, file.text]))
  for (const entry of input.zizmorIgnores) {
    const [file = '', directive = ''] = entry.split('#')
    if (!(texts.get(file) ?? '').includes(`# ${directive}`)) {
      violations.push({
        rule: 'comments/stale-allowance',
        file,
        message: `the allowed "# ${directive}" is gone: remove it from ZIZMOR_IGNORES`,
      })
    }
  }
  for (const file of input.themeFiles) {
    const text = texts.get(file) ?? ''
    for (const marker of THEME_MARKERS) {
      if (!text.includes(marker)) {
        violations.push({
          rule: 'comments/stale-allowance',
          file,
          message: `${marker} is gone: the theme block of this stylesheet has no marker`,
        })
      }
    }
  }
  return violations
}
