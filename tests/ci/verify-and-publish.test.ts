import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'
import { parseWorkflow } from '../guards/workflow-model.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const REGISTRY = 'https://registry.npmjs.org/'
const STEP = 'Verify the tarballs and publish them'

interface Release {
  kind: string
  name: string
  version: string
  access: string
  tag: string
  tarball: { path: string; integrity: string }
}

interface Plan {
  version: number
  plan: Release[][]
}

let template: { dir: string; plan: Plan }

let root: string
let packDir: string
let summaryFile: string
let logFile: string
let scriptFile: string

function publishShell(): string {
  const workflow = parseWorkflow(
    file('.github/workflows/release.yml', readText('.github/workflows/release.yml')),
  )
  const job = workflow.jobs.find((candidate) => candidate.id === 'publish')
  const step = job?.steps.find((candidate) => candidate.name === STEP)
  if (step?.run === undefined) {
    throw new Error(`release.yml: the publish job has no "${STEP}" step with a shell to run`)
  }
  return step.run
}

const NPM_STUB = `#!/usr/bin/env bash
case "$1" in
  --version)
    echo "\${STUB_NPM_VERSION:-11.17.0}"
    ;;
  view)
    echo "$*" >>"$NPM_LOG"
    spec="$2"
    if [[ -n "\${STUB_VIEW_ANSWER:-}" ]]; then
      echo "\${STUB_VIEW_ANSWER}"
      exit 0
    fi
    if [[ " \${STUB_PUBLISHED:-} " == *" \${spec} "* ]]; then
      echo "\\"\${spec##*@}\\""
      exit 0
    fi
    if [[ -n "\${STUB_VIEW_ERROR:-}" ]]; then
      echo "{\\"error\\":{\\"code\\":\\"\${STUB_VIEW_ERROR}\\"}}"
      echo "npm error code \${STUB_VIEW_ERROR}" >&2
      exit 1
    fi
    echo '{"error":{"code":"E404","summary":"No match found for version"}}'
    echo "npm error code E404" >&2
    exit 1
    ;;
  publish)
    echo "$*" >>"$NPM_LOG"
    count="$(grep -c '^publish ' "$NPM_LOG")"
    if [[ "\${STUB_PUBLISH_FAIL_AT:-}" == "$count" ]]; then
      echo "npm error code E403" >&2
      exit 1
    fi
    echo "+ $2"
    ;;
  *)
    echo "unexpected npm call: $*" >&2
    exit 99
    ;;
esac
`

function sha256(bytes: Buffer): { base64: string; hex: string } {
  const hash = createHash('sha256').update(bytes)
  return { base64: hash.copy().digest('base64'), hex: hash.digest('hex') }
}

const PUBLISH_CONFIG = { access: 'public', provenance: true }

function makeTarball(
  into: string,
  name: string,
  version: string,
  path: string,
  manifest: Record<string, unknown> = { publishConfig: PUBLISH_CONFIG },
): void {
  const stage = mkdtempSync(join(tmpdir(), 'verify-and-publish-stage-'))
  mkdirSync(join(stage, 'package'))
  writeFileSync(
    join(stage, 'package', 'package.json'),
    JSON.stringify({ name, version, ...manifest }),
  )
  writeFileSync(join(stage, 'package', 'index.mjs'), `export default ${JSON.stringify(name)}\n`)
  const run = spawnSync('tar', ['-czf', join(into, path), '-C', stage, 'package'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    encoding: 'utf8',
  })
  rmSync(stage, { recursive: true, force: true })
  if (run.status !== 0) throw new Error(`tar: ${run.stderr}`)
}

function integrityOf(path: string): string {
  return `sha256-${sha256(readFileSync(join(packDir, path))).base64}`
}

function rebuildTarball(release: Release, manifest: Record<string, unknown>): void {
  makeTarball(packDir, release.name, release.version, release.tarball.path, manifest)
  release.tarball.integrity = integrityOf(release.tarball.path)
}

function templateRelease(into: string, name: string, version: string): Release {
  const path = `packages/${name.replace('@', '').replace('/', '-')}-${version}.tgz`
  makeTarball(into, name, version, path)
  const bytes = readFileSync(join(into, path))
  return {
    kind: 'publish',
    name,
    version,
    access: 'public',
    tag: 'latest',
    tarball: { path, integrity: `sha256-${sha256(bytes).base64}` },
  }
}

const VERSION = '0.0.2'

function writePlan(plan: Plan): void {
  writeFileSync(join(packDir, 'publish-plan.json'), JSON.stringify(plan, null, 2))
}

function goodPlan(): Plan {
  return structuredClone(template.plan)
}

function releasesOf(plan: Plan): Release[] {
  return plan.plan.flat()
}

function firstRelease(plan: Plan): Release {
  const first = releasesOf(plan)[0]
  if (first === undefined) throw new Error('the plan has no release')
  return first
}

interface Outcome {
  status: number | null
  stdout: string
  stderr: string
  errors: string[]
  calls: string[]
  summary: string
}

function runJob(env: Record<string, string> = {}): Outcome {
  const run = spawnSync('bash', [scriptFile], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${join(template.dir, 'bin')}:${process.env.PATH ?? ''}`,
      PACK_DIR: packDir,
      GITHUB_STEP_SUMMARY: summaryFile,
      NPM_LOG: logFile,
      ...env,
    },
  })
  const log = readFileSync(logFile, 'utf8')
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    errors: run.stderr
      .split('\n')
      .filter((line) => line.startsWith('::error::'))
      .map((line) => line.slice('::error::'.length)),
    calls: log === '' ? [] : log.trimEnd().replaceAll(packDir, '<pack>').split('\n'),
    summary: readFileSync(summaryFile, 'utf8'),
  }
}

function publishedTarballs(outcome: Outcome): string[] {
  return outcome.calls
    .filter((call) => call.startsWith('publish '))
    .map((call) => (call.split(' ')[1] ?? '').split('/').pop() ?? '')
}

beforeAll(() => {
  const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' })
  if (jq.status !== 0) {
    throw new Error(
      'tests/ci needs jq on PATH: install it with your package manager (CONTRIBUTING.md)',
    )
  }
  const dir = mkdtempSync(join(tmpdir(), 'verify-and-publish-template-'))
  mkdirSync(join(dir, 'packages'))
  mkdirSync(join(dir, 'bin'))
  const stub = join(dir, 'bin', 'npm')
  writeFileSync(stub, NPM_STUB)
  chmodSync(stub, 0o755)
  template = {
    dir,
    plan: {
      version: 1,
      plan: [
        [templateRelease(dir, '@hollware/core', VERSION)],
        [
          templateRelease(dir, '@hollware/server', VERSION),
          templateRelease(dir, 'hollware', VERSION),
        ],
      ],
    },
  }
})

afterAll(() => {
  rmSync(template.dir, { recursive: true, force: true })
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verify-and-publish-'))
  packDir = join(root, 'pack')
  mkdirSync(packDir)
  cpSync(join(template.dir, 'packages'), join(packDir, 'packages'), { recursive: true })
  summaryFile = join(root, 'summary.md')
  logFile = join(root, 'npm.log')
  writeFileSync(summaryFile, '')
  writeFileSync(logFile, '')
  scriptFile = join(root, 'publish.sh')
  writeFileSync(scriptFile, publishShell())
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the publish job of release.yml', () => {
  describe('a good artifact', () => {
    test('is verified, then published in plan order with provenance, access, tag and registry', () => {
      const plan = goodPlan()
      writePlan(plan)
      const result = runJob()
      expect(result.status).toBe(0)
      expect(result.errors).toEqual([])
      expect(result.calls).toEqual([
        `view @hollware/core@${VERSION} version --json --prefer-online --registry ${REGISTRY}`,
        `view @hollware/server@${VERSION} version --json --prefer-online --registry ${REGISTRY}`,
        `view hollware@${VERSION} version --json --prefer-online --registry ${REGISTRY}`,
        `publish <pack>/packages/hollware-core-${VERSION}.tgz --registry ${REGISTRY} --provenance --access public --tag latest`,
        `publish <pack>/packages/hollware-server-${VERSION}.tgz --registry ${REGISTRY} --provenance --access public --tag latest`,
        `publish <pack>/packages/hollware-${VERSION}.tgz --registry ${REGISTRY} --provenance --access public --tag latest`,
      ])
    })

    test('leaves a summary with the package, the version, the sha256 and the result of each', () => {
      const plan = goodPlan()
      writePlan(plan)
      const result = runJob()
      const hex = (path: string) => sha256(readFileSync(join(packDir, path))).hex
      const row = (release: Release, outcome: string) =>
        `| \`${release.name}\` | ${release.version} | \`${hex(release.tarball.path)}\` | ${outcome} |`
      expect(result.summary).toBe(
        [
          '## Published on npm',
          '',
          '| Package | Version | sha256 | Result |',
          '| --- | --- | --- | --- |',
          ...releasesOf(plan).map((item) => row(item, 'published')),
          '',
        ].join('\n'),
      )
    })

    test('passes the tag and the access the plan names, for a prerelease on its own tag', () => {
      const plan = goodPlan()
      const [core] = releasesOf(plan)
      if (core === undefined) throw new Error('the plan has no release')
      core.tag = 'next'
      core.access = 'restricted'
      writePlan(plan)
      const result = runJob()
      expect(result.calls[3]).toContain(' --access restricted --tag next')
    })
  })

  describe('a version that npm already has', () => {
    test('is skipped while the rest is published, and a release that is all there publishes nothing', () => {
      const plan = goodPlan()
      writePlan(plan)
      const result = runJob({ STUB_PUBLISHED: `@hollware/core@${VERSION}` })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`@hollware/core@${VERSION} is already on npm: skipped.`)
      expect(publishedTarballs(result)).toEqual([
        `hollware-server-${VERSION}.tgz`,
        `hollware-${VERSION}.tgz`,
      ])
      expect(result.summary).toContain(`| \`@hollware/core\` | ${VERSION} |`)
      expect(result.summary).toContain('| already on npm |')
      expect(result.summary.match(/\| published \|/g)).toHaveLength(2)

      writeFileSync(logFile, '')
      const all = runJob({
        STUB_PUBLISHED: `@hollware/core@${VERSION} @hollware/server@${VERSION} hollware@${VERSION}`,
      })
      expect(all.status).toBe(0)
      expect(all.calls).toHaveLength(3)
      expect(all.calls.every((call) => call.startsWith('view '))).toBe(true)
    })
  })

  describe('npm', () => {
    test('a failed publish stops the job, keeps the record and says how to go on', () => {
      writePlan(goodPlan())
      const result = runJob({ STUB_PUBLISH_FAIL_AT: '2' })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `Publishing @hollware/server@${VERSION} failed. Run the job again once the cause is fixed: a version that is already on npm is skipped.`,
      ])
      expect(result.calls.filter((call) => call.startsWith('publish '))).toHaveLength(2)
      expect(result.summary).toContain('| published |')
      expect(result.summary).toContain('| **failed** |')
      expect(result.summary.match(/\| \*\*failed\*\* \|/g)).toHaveLength(1)
    })

    test('an answer that is not "not found" stops the job before anything is published', () => {
      writePlan(goodPlan())
      const result = runJob({ STUB_VIEW_ERROR: 'ECONNRESET' })
      expect(result.status).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain(
        `Could not tell whether @hollware/core@${VERSION} is on npm`,
      )
      expect(result.calls).toHaveLength(1)
      expect(result.calls[0]).toMatch(/^view /)
      expect(result.summary).toBe('')
    })

    test('an answer for another version than the one asked for stops the job before anything is published', () => {
      writePlan(goodPlan())
      const result = runJob({ STUB_VIEW_ANSWER: '"0.0.9"' })
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `npm answered "0.0.9" when asked for @hollware/core@${VERSION}.`,
      ])
      expect(result.calls).toEqual([
        `view @hollware/core@${VERSION} version --json --prefer-online --registry ${REGISTRY}`,
      ])
      expect(result.summary).toBe('')
    })

    test('an old npm cannot do trusted publishing', { timeout: 30_000 }, () => {
      writePlan(goodPlan())
      for (const old of ['11.5.0', '11.4.9', '10.9.2']) {
        const result = runJob({ STUB_NPM_VERSION: old })
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([
          `Trusted publishing needs npm 11.5.1 or newer, found ${old}.`,
        ])
        expect(result.calls).toEqual([])
      }
      for (const fine of ['11.5.1', '11.17.0', '11.100.0', '12.0.0']) {
        expect(runJob({ STUB_NPM_VERSION: fine }).status).toBe(0)
        writeFileSync(logFile, '')
      }
    })
  })

  describe('an artifact that was tampered with', () => {
    test('a tarball changed after the plan was written is refused before npm is asked anything', () => {
      const plan = goodPlan()
      writePlan(plan)
      appendFileSync(join(packDir, firstRelease(plan).tarball.path), 'x')
      const result = runJob()
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `The sha256 of ${firstRelease(plan).tarball.path} does not match the publish plan.`,
      ])
      expect(result.calls).toEqual([])
      expect(result.summary).toBe('')
    })

    test('a tarball that holds another package, with a plan that agrees on its hash, is refused', () => {
      const plan = goodPlan()
      const [core, server] = releasesOf(plan)
      if (core === undefined || server === undefined) throw new Error('the plan has no releases')
      copyFileSync(join(packDir, server.tarball.path), join(packDir, core.tarball.path))
      core.tarball.integrity = integrityOf(core.tarball.path)
      writePlan(plan)
      const result = runJob()
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `${core.tarball.path} holds @hollware/server@${VERSION}, the publish plan says @hollware/core@${VERSION}.`,
      ])
      expect(result.calls).toEqual([])
    })

    test('a tarball that is not a package is refused', () => {
      const plan = goodPlan()
      const junk = Buffer.from('not a tarball')
      writeFileSync(join(packDir, firstRelease(plan).tarball.path), junk)
      firstRelease(plan).tarball.integrity = `sha256-${sha256(junk).base64}`
      writePlan(plan)
      const result = runJob()
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        `${firstRelease(plan).tarball.path} is not a package tarball.`,
      ])
      expect(result.calls).toEqual([])
    })

    test('a tarball whose package.json sets publishConfig keys besides access and provenance is refused', () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ registry: 'https://evil.example/' }, '{"registry":"https://evil.example/"}'],
        [
          { '@hollware:registry': 'https://evil.example/' },
          '{"@hollware:registry":"https://evil.example/"}',
        ],
        [{ tag: 'beta', access: 'public' }, '{"tag":"beta"}'],
        [{ 'provenance-file': '/tmp/bundle.json' }, '{"provenance-file":"/tmp/bundle.json"}'],
        [
          { ...PUBLISH_CONFIG, exports: { '.': { default: './dist/index.mjs' } } },
          '{"exports":{".":{"default":"./dist/index.mjs"}}}',
        ],
      ]
      for (const [publishConfig, shown] of cases) {
        const plan = goodPlan()
        rebuildTarball(firstRelease(plan), { publishConfig })
        writePlan(plan)
        const result = runJob()
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([
          `${firstRelease(plan).tarball.path} sets publishConfig keys besides access and provenance: ${shown}`,
        ])
        expect(result.calls).toEqual([])
      }
    })

    test('a publishConfig that is not an object is refused, and none at all is accepted', () => {
      const plan = goodPlan()
      rebuildTarball(firstRelease(plan), { publishConfig: 'registry=https://evil.example/' })
      writePlan(plan)
      const refused = runJob()
      expect(refused.errors).toEqual([
        `${firstRelease(plan).tarball.path} sets publishConfig keys besides access and provenance: "registry=https://evil.example/"`,
      ])

      const bare = goodPlan()
      rebuildTarball(firstRelease(bare), {})
      writePlan(bare)
      expect(runJob().status).toBe(0)
    })

    test('a tarball the plan lists but the artifact lacks, or holds as a link, is refused', () => {
      const plan = goodPlan()
      writePlan(plan)
      const path = firstRelease(plan).tarball.path
      unlinkSync(join(packDir, path))
      const missing = runJob()
      expect(missing.errors).toEqual([
        `The tarball of @hollware/core@${VERSION} is missing: ${path}`,
      ])

      const [, server] = releasesOf(plan)
      if (server === undefined) throw new Error('the plan has no second release')
      symlinkSync(join(packDir, server.tarball.path), join(packDir, path))
      const linked = runJob()
      expect(linked.errors).toEqual([
        `The tarball of @hollware/core@${VERSION} is missing: ${path}`,
      ])
      expect(linked.calls).toEqual([])
    })

    test('a file the plan does not list is refused, wherever it sits', () => {
      const plan = goodPlan()
      writePlan(plan)
      const stray = join(packDir, 'packages', 'evil-9.9.9.tgz')
      copyFileSync(join(packDir, firstRelease(plan).tarball.path), stray)
      expect(runJob().errors).toEqual([
        'The artifact holds files that are not in the publish plan: packages/evil-9.9.9.tgz',
      ])

      unlinkSync(stray)
      writeFileSync(join(packDir, 'run.sh'), 'echo hi')
      mkdirSync(join(packDir, 'nested'))
      writeFileSync(join(packDir, 'nested', 'x.txt'), 'x')
      const result = runJob()
      expect(result.errors).toEqual([
        'The artifact holds files that are not in the publish plan: nested/x.txt, run.sh',
      ])
      expect(result.calls).toEqual([])
    })
  })

  describe('a plan with hostile values', () => {
    const hostile: { field: string; value: string; message: string }[] = [
      {
        field: 'tag',
        value: '--registry=https://evil.example',
        message: 'Unexpected dist-tag of @hollware/core: --registry=https://evil.example',
      },
      { field: 'tag', value: '', message: 'Unexpected dist-tag of @hollware/core: <empty>' },
      {
        field: 'access',
        value: 'restricted --otp 1',
        message: 'Unexpected access of @hollware/core: restricted --otp 1',
      },
      {
        field: 'name',
        value: '@hollware/core;rm -rf',
        message: 'Unexpected package name in the publish plan: @hollware/core;rm -rf',
      },
      {
        field: 'version',
        value: '0.0.2;id',
        message: 'Unexpected version of @hollware/core: 0.0.2;id',
      },
      { field: 'version', value: '1', message: 'Unexpected version of @hollware/core: 1' },
      {
        field: 'path',
        value: '../../etc/passwd',
        message: 'Unexpected tarball path of @hollware/core: ../../etc/passwd',
      },
      {
        field: 'path',
        value: '/etc/passwd',
        message: 'Unexpected tarball path of @hollware/core: /etc/passwd',
      },
      {
        field: 'path',
        value: 'packages/sub/x.tgz',
        message: 'Unexpected tarball path of @hollware/core: packages/sub/x.tgz',
      },
      {
        field: 'integrity',
        value: 'sha256-AAAA',
        message: 'Unexpected sha256 of @hollware/core: sha256-AAAA',
      },
    ]

    test.each(hostile)(
      '$field "$value" is refused before npm is asked anything',
      ({ field, value, message }) => {
        const plan = goodPlan()
        const target = firstRelease(plan)
        if (field === 'path') target.tarball.path = value
        else if (field === 'integrity') target.tarball.integrity = value
        else if (field === 'tag') target.tag = value
        else if (field === 'access') target.access = value
        else if (field === 'name') target.name = value
        else target.version = value
        writePlan(plan)
        const result = runJob()
        expect(result.status).toBe(1)
        expect(result.errors).toEqual([message])
        expect(result.calls).toEqual([])
        expect(result.summary).toBe('')
      },
    )

    test('a value that spans several lines cannot split into other fields', () => {
      const plan = goodPlan()
      firstRelease(plan).tag = 'latest\nhollware\t0.0.9'
      writePlan(plan)
      const result = runJob()
      expect(result.status).toBe(1)
      expect(result.errors).toEqual([
        'Unexpected dist-tag of @hollware/core: latest\\nhollware\\t0.0.9',
      ])
      expect(result.calls).toEqual([])
    })
  })

  describe('a plan that is not a plan', () => {
    test('a missing plan, invalid JSON and an unknown format are refused', () => {
      const missing = runJob()
      expect(missing.errors).toEqual(['publish-plan.json is missing from the downloaded artifact.'])

      writeFileSync(join(packDir, 'publish-plan.json'), '{ not json')
      expect(runJob().errors).toEqual(['publish-plan.json is not a version 1 publish plan.'])

      const plan = goodPlan()
      plan.version = 2
      writePlan(plan)
      expect(runJob().errors).toEqual(['publish-plan.json is not a version 1 publish plan.'])

      writeFileSync(
        join(packDir, 'publish-plan.json'),
        JSON.stringify({ version: 1, plan: 'nope' }),
      )
      expect(runJob().errors).toEqual(['publish-plan.json is not a version 1 publish plan.'])
    })

    test('a plan with nothing to publish, or only entries of another kind, is refused', () => {
      writePlan({ version: 1, plan: [] })
      expect(runJob().errors).toEqual(['The publish plan has nothing to publish.'])

      const plan = goodPlan()
      for (const item of releasesOf(plan)) item.kind = 'skip'
      writePlan(plan)
      const result = runJob()
      expect(result.errors).toEqual(['The publish plan has nothing to publish.'])
      expect(result.calls).toEqual([])
    })

    test('a plan whose waves are not lists is refused', () => {
      writeFileSync(
        join(packDir, 'publish-plan.json'),
        JSON.stringify({ version: 1, plan: [{ kind: 'publish' }] }),
      )
      const result = runJob()
      expect(result.errors).toEqual([
        'publish-plan.json does not have the shape of a publish plan.',
      ])
      expect(result.calls).toEqual([])
    })

    test('entries of another kind are left alone next to the ones to publish', () => {
      const plan = goodPlan()
      const [core, server] = releasesOf(plan)
      if (core === undefined || server === undefined) throw new Error('the plan has no releases')
      server.kind = 'skip'
      writePlan(plan)
      unlinkSync(join(packDir, server.tarball.path))
      const result = runJob()
      expect(result.status).toBe(0)
      expect(result.calls.filter((call) => call.startsWith('publish '))).toHaveLength(2)
    })
  })

  test('the shell is the text of the "Verify the tarballs and publish them" step of release.yml', () => {
    const shell = publishShell()
    expect(shell).toContain('set -euo pipefail')
    expect(shell.split('\n').filter((line) => line.includes('npm publish'))).toHaveLength(1)
  })
})
