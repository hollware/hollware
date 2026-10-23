import { inlineCodeSpans, sectionLines, tableCells } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

export interface PackageListsInput {
  agents: TextFile
  readme: TextFile
  changesetReadme: TextFile
  workspaceDirs: readonly string[]
  workspaceNames: readonly string[]
  published: readonly { name: string; dir: string }[]
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

export function checkPackageLists(input: PackageListsInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, file: string, message: string): void => {
    violations.push({ rule: `package-lists/${rule}`, file, message })
  }
  const countWord = NUMBER_WORDS[input.published.length] ?? String(input.published.length)

  const layout = sectionLines(input.agents.text, 'Layout')
  const cited = new Set(
    layout
      .filter(({ line }) => line.startsWith('- '))
      .flatMap(({ line }) =>
        inlineCodeSpans(line)
          .slice(0, 1)
          .map((span) => span.text.replace(/\/$/, '')),
      ),
  )
  if (layout.length === 0) {
    report(
      'agents-layout',
      input.agents.path,
      'AGENTS.md has no "## Layout" section listing the packages',
    )
  }
  for (const dir of input.workspaceDirs) {
    if (layout.length > 0 && !cited.has(dir)) {
      report(
        'agents-layout',
        input.agents.path,
        `the "## Layout" section has no bullet for \`${dir}\`: add one`,
      )
    }
  }

  const rows = sectionLines(input.readme.text, 'Packages')
    .map(({ line }) => tableCells(line))
    .flatMap((cells) => {
      const link = /^\[`([^`]+)`\]\(([^)]+)\)$/.exec(cells?.[0] ?? '')
      return link?.[1] === undefined || link[2] === undefined
        ? []
        : [{ name: link[1], dir: link[2].replace(/\/$/, '') }]
    })
  for (const { name, dir } of input.published) {
    const row = rows.find((candidate) => candidate.name === name)
    if (row === undefined) {
      report(
        'readme-table',
        input.readme.path,
        `the package table under "## Packages" has no row for ${name}: add one linking to ${dir}`,
      )
    } else if (row.dir !== dir) {
      report(
        'readme-table',
        input.readme.path,
        `the row of ${name} links to ${row.dir} but the package lives in ${dir}`,
      )
    }
  }
  for (const row of rows) {
    if (!input.published.some((candidate) => candidate.name === row.name)) {
      report(
        'readme-table',
        input.readme.path,
        `the package table lists ${row.name}, which is not a published package`,
      )
    }
  }
  const intro = sectionLines(input.readme.text, 'Packages').find(({ line }) =>
    /^\w+ packages,/.test(line),
  )
  const introWord = /^(\w+) packages,/i.exec(intro?.line ?? '')?.[1]?.toLowerCase()
  if (introWord !== countWord) {
    report(
      'count-word',
      input.readme.path,
      `the "## Packages" section must start with "${countWord[0]?.toUpperCase()}${countWord.slice(1)} packages,", the number of published packages, found ${JSON.stringify(introWord ?? null)}`,
    )
  }

  const versions = sectionLines(input.changesetReadme.text, 'Versions')
    .map(({ line }) => line)
    .join('\n')
  const named = new Set(inlineCodeSpans(versions).map((span) => span.text))
  for (const { name } of input.published) {
    if (!named.has(name)) {
      report(
        'changeset-readme',
        input.changesetReadme.path,
        `the "## Versions" section does not name ${name}`,
      )
    }
  }
  for (const name of named) {
    if (name.startsWith('@hollware/') && !input.workspaceNames.includes(name)) {
      report(
        'changeset-readme',
        input.changesetReadme.path,
        `the "## Versions" section names ${name}, which is not a package of this workspace`,
      )
    }
  }
  const versionsWord = /The (\w+) published packages/i.exec(versions)?.[1]?.toLowerCase()
  if (versionsWord !== countWord) {
    report(
      'count-word',
      input.changesetReadme.path,
      `the "## Versions" section must say "The ${countWord} published packages", found ${JSON.stringify(versionsWord ?? null)}`,
    )
  }
  return violations
}
