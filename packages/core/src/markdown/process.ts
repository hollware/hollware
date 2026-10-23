import type { MarkdownDocument } from 'comark'
import { analyzeDocument } from './analyze.ts'
import { jsonProblem } from './json.ts'
import { getParser } from './parser.ts'
import { compileRoutes } from './routes.ts'
import type { ProcessMarkdown, ProcessMarkdownOptions, ProcessResult } from './types.ts'
import {
  frontmatterNotJson,
  frontmatterNotMapping,
  notAString,
  parseFailure,
  sizeLimit,
  unstorable,
  yamlSyntax,
} from './violations.ts'
import { COMARK_VERSION, PIPELINE_VERSION } from './versions.ts'

const BYTE_ORDER_MARK = 0xfeff

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && at + 1 < text.length) {
      const next = text.charCodeAt(at + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        at++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'boolean') return 'a boolean'
  return 'something else'
}

function isYamlError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'YAMLException'
}

function linesBeforeBody(source: string, body: string): number {
  if (!source.endsWith(body)) return 0
  const end = source.length - body.length
  let lines = 0
  for (let at = 0; at < end; at++) {
    const code = source.charCodeAt(at)
    if (code === 10 || (code === 13 && source.charCodeAt(at + 1) !== 10)) lines++
  }
  return lines
}

function yamlViolation(error: Error, source: string) {
  const reason: unknown = Reflect.get(error, 'reason')
  const mark: unknown = Reflect.get(error, 'mark')
  const markLine = isRecord(mark) ? mark.line : undefined
  const markColumn = isRecord(mark) ? mark.column : undefined
  const firstLine = source.startsWith('---\r\n') ? 1 : 2
  return yamlSyntax(
    typeof reason === 'string' ? reason : (error.message.split('\n')[0] ?? 'it does not parse'),
    typeof markLine === 'number' ? markLine + firstLine : undefined,
    typeof markColumn === 'number' ? markColumn + 1 : undefined,
  )
}

async function run(markdown: unknown, options: ProcessMarkdownOptions): Promise<ProcessResult> {
  if (typeof markdown !== 'string') return { ok: false, violations: [notAString()] }

  const bytes = utf8ByteLength(markdown)
  if (!(bytes <= options.maxMarkdownBytes)) {
    return { ok: false, violations: [sizeLimit(bytes, options.maxMarkdownBytes)] }
  }

  const source = markdown.charCodeAt(0) === BYTE_ORDER_MARK ? markdown.slice(1) : markdown
  const parser = await getParser()

  let split: { content: string; data: unknown }
  try {
    split = parser.splitFrontmatter(source)
  } catch (error) {
    const violation = isYamlError(error) ? yamlViolation(error, source) : parseFailure(error)
    return { ok: false, violations: [violation] }
  }
  const frontmatter = split.data
  if (!isRecord(frontmatter)) {
    return { ok: false, violations: [frontmatterNotMapping(describe(frontmatter))] }
  }
  const problem = jsonProblem(frontmatter)
  if (problem !== undefined) return { ok: false, violations: [frontmatterNotJson(problem)] }

  const document: MarkdownDocument = await parser.parseBody(split.content)
  document.frontmatter = frontmatter
  const analysis = analyzeDocument(document, {
    components: new Set(options.components),
    routes: compileRoutes(options.routes),
    lineOffset: linesBeforeBody(source, split.content),
  })
  if (analysis.problem !== undefined) {
    return { ok: false, violations: [unstorable(analysis.problem)] }
  }
  return {
    ok: true,
    value: {
      frontmatter,
      document,
      extracted: analysis.extracted,
      comarkVersion: COMARK_VERSION,
      pipelineVersion: PIPELINE_VERSION,
    },
  }
}

/**
 * Processes a Markdown file for a collection: the frontmatter and the body
 * are parsed once and the contracts get what they need from the result. It answers for any
 * string and never throws: a file it cannot store comes back as violations.
 */
export const processMarkdown: ProcessMarkdown = async (markdown, options) => {
  try {
    return await run(markdown, options)
  } catch (error) {
    return { ok: false, violations: [parseFailure(error)] }
  }
}
