import { headings, stripFencedBlocks, tableCells } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `adr`: the architecture decision records follow the rules of `docs/adr/README.md`.
 *
 * - The files of `docs/adr/` are `README.md` and ADRs named `NNNN-kebab-case-title.md`; any
 *   other file would escape every check below, so it is reported.
 * - Numbers run from 1 without gaps or repeats: a number is never reused and an ADR is never
 *   deleted (it is superseded).
 * - An ADR starts with `# ADR-NNN: Title` (NNN is the file number), then a `Status:` line
 *   (`Proposed`, `Accepted` or `Superseded by ADR-NNN`, with a real `(YYYY-MM-DD)` date),
 *   then exactly the sections Context, Decision, Consequences and Alternatives considered, in
 *   that order and no other heading. Fenced blocks are ignored, as the template in the README
 *   shows.
 * - The index table in the README lists exactly the ADR files, with their number, title and
 *   status. So does the ADR table of `docs/design.md`.
 */

export interface AdrInput {
  /** The direct children of `docs/adr/`, with their text. */
  files: readonly TextFile[]
  /** `docs/design.md`, whose ADR table is checked too. Optional. */
  design?: TextFile
}

const ADR_FILE = /^docs\/adr\/(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const SECTIONS = ['Context', 'Decision', 'Consequences', 'Alternatives considered']
const STATUS = /^Status: (Proposed|Accepted|Superseded by ADR-(\d{3})) \((\d{4})-(\d{2})-(\d{2})\)$/

interface Adr {
  path: string
  number: number
  title: string | undefined
  /** `Accepted`, `Proposed` or `Superseded by ADR-NNN`. */
  status: string | undefined
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function pad3(number: number): string {
  return String(number).padStart(3, '0')
}

export function checkAdrs(input: AdrInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, file: string, message: string): void => {
    violations.push({ rule: `adr/${rule}`, file, message })
  }

  const adrs: Adr[] = []
  let readme: TextFile | undefined
  for (const file of input.files) {
    if (file.path === 'docs/adr/README.md') {
      readme = file
      continue
    }
    const match = ADR_FILE.exec(file.path)
    if (match === null) {
      report(
        'file-name',
        file.path,
        'a file in docs/adr/ is README.md or an ADR named NNNN-kebab-case-title.md (four digits, lowercase): anything else escapes the checks on ADRs',
      )
      continue
    }
    adrs.push(checkAdr(file, Number(match[1]), report))
  }

  const numbers = adrs.map((adr) => adr.number).sort((a, b) => a - b)
  const expected = numbers.map((_, index) => index + 1)
  if (numbers.some((number, index) => number !== expected[index])) {
    report(
      'number-gap',
      'docs/adr',
      `ADR numbers must run from 1 without gaps or repeats (an ADR is superseded, never deleted), found ${numbers.map(pad3).join(', ')}`,
    )
  }
  const byNumber = new Map(adrs.map((adr) => [adr.number, adr]))
  for (const adr of adrs) {
    const target = /^Superseded by ADR-(\d{3})$/.exec(adr.status ?? '')?.[1]
    if (target !== undefined && (Number(target) === adr.number || !byNumber.has(Number(target)))) {
      report(
        'superseded-target',
        adr.path,
        `"Superseded by ADR-${target}" must name another ADR that exists`,
      )
    }
  }

  if (readme === undefined) {
    report(
      'index-missing',
      'docs/adr/README.md',
      'docs/adr/README.md is missing: it holds the index of the ADRs',
    )
  } else {
    checkIndex(readme, adrs, report)
  }
  if (input.design !== undefined) checkDesignTable(input.design, adrs, report)
  return violations
}

type Report = (rule: string, file: string, message: string) => void

function checkAdr(file: TextFile, number: number, report: Report): Adr {
  const adr: Adr = { path: file.path, number, title: undefined, status: undefined }
  const lines = file.text.split('\n')

  const title = /^# ADR-(\d{3}): (.+)$/.exec(lines[0] ?? '')
  if (title === null || Number(title[1]) !== number) {
    report(
      'title',
      file.path,
      `the first line must be "# ADR-${pad3(number)}: <title>", found ${JSON.stringify(lines[0] ?? '')}`,
    )
  } else {
    adr.title = (title[2] ?? '').trim()
  }

  const statusLine = lines.slice(1).find((line) => line.trim() !== '') ?? ''
  const status = STATUS.exec(statusLine)
  if (status === null) {
    report(
      'status',
      file.path,
      `the first line after the title must be "Status: Proposed|Accepted|Superseded by ADR-NNN (YYYY-MM-DD)", found ${JSON.stringify(statusLine)}`,
    )
  } else if (!isCalendarDate(Number(status[3]), Number(status[4]), Number(status[5]))) {
    report(
      'status',
      file.path,
      `the status date ${status[3]}-${status[4]}-${status[5]} is not a real date`,
    )
  } else {
    adr.status = status[1]
  }

  const found = headings(file.text)
  const sections = found.slice(1)
  const wellFormed =
    sections.length === SECTIONS.length &&
    sections.every((heading, index) => heading.level === 2 && heading.text === SECTIONS[index])
  if (!wellFormed || found[0]?.level !== 1) {
    report(
      'sections',
      file.path,
      `an ADR has exactly the sections ${SECTIONS.map((name) => `"## ${name}"`).join(', ')}, in that order and no other heading, found ${
        found
          .slice(1)
          .map((heading) => `"${'#'.repeat(heading.level)} ${heading.text}"`)
          .join(', ') || 'none'
      }`,
    )
  }
  return adr
}

function checkIndex(readme: TextFile, adrs: readonly Adr[], report: Report): void {
  const byFile = new Map(adrs.map((adr) => [adr.path.slice('docs/adr/'.length), adr]))
  const listed = new Set<string>()
  for (const line of stripFencedBlocks(readme.text).split('\n')) {
    const cells = tableCells(line)
    const number = cells?.[0]
    if (cells === undefined || number === undefined || !/^\d{3}$/.test(number)) continue
    const link = /^\[[^\]]*\]\(([^)]+)\)$/.exec(cells[3] ?? '')
    const target = link?.[1]
    if (target === undefined) {
      report(
        'index-mismatch',
        readme.path,
        `the row of ADR ${number} must end with a link to its file, found ${JSON.stringify(cells[3] ?? '')}`,
      )
      continue
    }
    const adr = byFile.get(target)
    if (adr === undefined) {
      report(
        'index-extra',
        readme.path,
        `the index links to ${target}, which is not an ADR file of docs/adr/`,
      )
      continue
    }
    if (listed.has(target)) {
      report('index-duplicate', readme.path, `${target} is listed twice in the index`)
    }
    listed.add(target)
    if (Number(number) !== adr.number || cells[1] !== adr.title || cells[2] !== adr.status) {
      report(
        'index-mismatch',
        readme.path,
        `the index row for ${target} says ${JSON.stringify(`${number} | ${cells[1]} | ${cells[2]}`)} but the file says ${JSON.stringify(`${pad3(adr.number)} | ${adr.title} | ${adr.status}`)}`,
      )
    }
  }
  for (const [name] of byFile) {
    if (!listed.has(name)) {
      report(
        'index-missing',
        readme.path,
        `${name} is not in the index: add a row for it in the same commit`,
      )
    }
  }
}

function checkDesignTable(design: TextFile, adrs: readonly Adr[], report: Report): void {
  const byFile = new Map(adrs.map((adr) => [adr.path.slice('docs/adr/'.length), adr]))
  const listed = new Set<string>()
  for (const line of stripFencedBlocks(design.text).split('\n')) {
    const cells = tableCells(line)
    const link = /^\[ADR-(\d{3})\]\(adr\/([^)]+)\)$/.exec(cells?.[0] ?? '')
    if (cells === undefined || link === null) continue
    const target = link[2] ?? ''
    const adr = byFile.get(target)
    if (adr === undefined) {
      report(
        'design-extra',
        design.path,
        `the ADR table links to ${target}, which is not an ADR file of docs/adr/`,
      )
      continue
    }
    listed.add(target)
    if (Number(link[1]) !== adr.number || cells[1] !== adr.title || cells[2] !== adr.status) {
      report(
        'design-mismatch',
        design.path,
        `the ADR table row for ${target} says ${JSON.stringify(`${link[1]} | ${cells[1]} | ${cells[2]}`)} but the file says ${JSON.stringify(`${pad3(adr.number)} | ${adr.title} | ${adr.status}`)}`,
      )
    }
  }
  for (const [name] of byFile) {
    if (!listed.has(name)) {
      report(
        'design-missing',
        design.path,
        `${name} is not in the ADR table of the design document`,
      )
    }
  }
}
