import { describe, expect, it } from 'vite-plus/test'
import rootConfig from '../../vite.config.ts'
import { checkAgentsCommands, commandsOf, type PackageScripts } from '../guards/agents-commands.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles, repoFiles } from '../support/repo.ts'
import { isRecord, recordAt } from '../support/values.ts'
import { workspaceManifests } from '../support/workspace.ts'
import { isAgentsFile } from '../support/repo.ts'

// Fails when: an AGENTS.md cites in backticks `vp run <task>` for a task that neither the root
// vite.config.ts nor any package defines, `pnpm --filter <pkg> run <script>` for a script the
// package lacks, `pnpm run <script>` for a script the root lacks, or `node <file>` for a file
// that does not exist.

function rootTasks(): Set<string> {
  const config: unknown = rootConfig
  return new Set(Object.keys(recordAt(recordAt(config, 'run'), 'tasks') ?? {}))
}

function packagesWithScripts(): PackageScripts[] {
  return workspaceManifests().flatMap((manifest) => {
    const json: unknown = JSON.parse(manifest.text)
    if (!isRecord(json) || typeof json.name !== 'string') return []
    return [
      {
        name: json.name,
        dir: manifest.path === 'package.json' ? '' : manifest.path.replace(/\/package\.json$/, ''),
        scripts: new Set(Object.keys(recordAt(json, 'scripts') ?? {})),
      },
    ]
  })
}

const PACKAGES: PackageScripts[] = [
  { name: 'hollware-monorepo', dir: '', scripts: new Set(['prepare', 'version-packages']) },
  { name: '@hollware/playground', dir: 'apps/playground', scripts: new Set(['test', 'build']) },
  { name: '@hollware/core', dir: 'packages/core', scripts: new Set(['build', 'publint']) },
]

const check = (text: string) =>
  checkAgentsCommands({
    docs: [file('AGENTS.md', text)],
    tasks: new Set(['check:push', 'check:commit']),
    packages: PACKAGES,
    files: new Set(['scripts/break-line.ts']),
  })

const messages = (text: string) =>
  check(text).map((violation) => `${violation.rule}: ${violation.message}`)

describe('commands in AGENTS.md', () => {
  it('every vp run task, pnpm script and node file they cite exists', () => {
    const docs = readRepoFiles(isAgentsFile)
    // The orientation of tests/ cites commands too: it is judged like the root file.
    expect(docs.map((doc) => doc.path)).toEqual(
      expect.arrayContaining(['AGENTS.md', 'tests/AGENTS.md']),
    )
    expect(rootTasks()).toEqual(
      new Set([
        'bench',
        'check:budgets',
        'check:commit',
        'check:push',
        'e2e:admin',
        'test:acceptance',
        'test:conformance',
      ]),
    )
    const violations = checkAgentsCommands({
      docs,
      tasks: rootTasks(),
      packages: packagesWithScripts(),
      files: new Set(repoFiles()),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts commands that refer to real tasks, scripts and files', () => {
      const text = [
        '`vp run check:push` `vp run -r build` `pnpm exec vp run check:commit`',
        '`vp run -F @hollware/core build` `vp run --log grouped test` `vp run @hollware/playground#test`',
        '`vp run hollware-monorepo#check:push` `pnpm --filter @hollware/playground run test`',
        '`pnpm -F @hollware/core run build` `pnpm run version-packages`',
        '`node scripts/break-line.ts --file <f> --find <s>` `vp run <task>` `pnpm --filter <pkg> run <script>`',
        '`pnpm --filter ./apps/* run build` `pnpm --filter ...core run build` `vp check` `pnpm dev`',
      ].join('\n')
      expect(check(text)).toEqual([])
    })

    it('reports a vp run task that does not exist', () => {
      expect(check('Run `vp run check:everything` now.')).toEqual([
        {
          rule: 'agents-commands/unknown-task',
          file: 'AGENTS.md',
          message:
            'line 1: `vp run check:everything` runs "check:everything", which is neither a task of vite.config.ts nor a script of any package',
        },
      ])
    })

    it('reports a package#task that names a missing package or task', () => {
      expect(messages('`vp run @hollware/nope#test` and `vp run @hollware/core#test`')).toEqual([
        'agents-commands/unknown-package: line 1: `vp run @hollware/nope#test` names the package "@hollware/nope", which is not in the workspace',
        'agents-commands/unknown-task: line 1: `vp run @hollware/core#test` runs "test", which package @hollware/core does not define',
      ])
    })

    it('reports pnpm --filter ... run for a missing package or script', () => {
      expect(
        messages(
          '`pnpm --filter @hollware/playground run nope` `pnpm --filter @hollware/gone run test` `pnpm --filter=@hollware/core run test`',
        ),
      ).toEqual([
        'agents-commands/missing-script: line 1: `pnpm --filter @hollware/playground run nope` runs the script "nope", which @hollware/playground does not define',
        'agents-commands/unknown-package: line 1: `pnpm --filter @hollware/gone run test` filters on "@hollware/gone", which is not a package of the workspace',
        'agents-commands/missing-script: line 1: `pnpm --filter=@hollware/core run test` runs the script "test", which @hollware/core does not define',
      ])
    })

    it('reports a pnpm run script the root does not define', () => {
      expect(messages('`pnpm run version-packages` `pnpm run release`')).toEqual([
        'agents-commands/missing-script: line 1: `pnpm run release` runs the script "release", which the root package.json does not define',
      ])
    })

    it('reports a node file that does not exist', () => {
      expect(check('`node scripts/gone.ts --flag`')).toEqual([
        {
          rule: 'agents-commands/missing-file',
          file: 'AGENTS.md',
          message:
            'line 1: `node scripts/gone.ts --flag` runs scripts/gone.ts, which does not exist',
        },
      ])
    })

    it('reads commands from fenced blocks, with their line and without a shell prompt', () => {
      const text = 'Run:\n\n```sh\n$ vp run nope\nvp run check:push\n```\n'
      expect(messages(text)).toEqual([
        'agents-commands/unknown-task: line 4: `vp run nope` runs "nope", which is neither a task of vite.config.ts nor a script of any package',
      ])
    })

    it('lists the commands of a document', () => {
      expect(commandsOf('a `x` b\n```\ny\n```\n')).toEqual([
        { command: 'x', line: 1 },
        { command: 'y', line: 3 },
      ])
    })
  })
})
