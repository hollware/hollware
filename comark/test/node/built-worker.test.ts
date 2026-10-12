import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTestHarness } from 'wrangler'
import { beforeAll, describe, expect, it } from 'vite-plus/test'
import { SMALL_POST } from '../../src/fixtures.ts'
import { SAFETY_CASES } from '../support/safety-table.ts'
import {
  SMALL_POST_COMPONENTS,
  SMALL_POST_FRONTMATTER,
  SMALL_POST_HEADINGS,
  SMALL_POST_HTML,
  SMALL_POST_IMAGES,
  SMALL_POST_LINKS,
} from '../support/small-post.ts'

// S3a (without Node.js compatibility) and S3b (what the built Worker pulls in). Fails when:
// - a dependency of the pipeline starts importing a Node built-in (the opt-out build then prints the
//   Cloudflare plugin's "Unexpected Node.js imports" warning and the bundle gets a `node:` specifier
//   or an import/require statement),
// - the Worker stops producing the exact data below in a real workerd that has `process`, `Buffer`
//   and `setImmediate` switched off (both opt-out flags in wrangler.jsonc),
// - or the probe stops telling the runtimes apart (then "without Node" would prove nothing).
//
// Two facts shape this file. At compatibility date 2026-10-06 Node.js compatibility is ON by default
// (a Worker with no flags has process, Buffer and setImmediate), so the Worker has to opt out with
// BOTH `no_nodejs_compat` and `no_nodejs_compat_v2`. And the vitest pool of @cloudflare/vitest-plugin
// keeps Node.js compatibility on for its own runner, so a test inside that pool can never prove it:
// the proof is the built Worker in a real workerd (the test harness of wrangler over the Vite build).

const root = fileURLToPath(new URL('../../', import.meta.url))
const vp = fileURLToPath(new URL('../../../../node_modules/.bin/vp', import.meta.url))

function build(args: string[]): { status: number | null; log: string } {
  // This project keeps wrangler's anonymous telemetry off, also for the builds the test starts.
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  const result = spawnSync(vp, ['build', ...args], { cwd: root, encoding: 'utf8', env })
  return { status: result.status, log: `${result.stdout}${result.stderr}` }
}

// `root` is what a build writes (and what is deleted before it), `outDir` the directory of its Worker.
const noArgs: string[] = []
const builds = {
  // vite.config.ts + wrangler.jsonc: both opt-out flags.
  optOut: {
    root: 'dist/default',
    outDir: 'dist/default/hollware_spike_comark',
    args: noArgs,
    log: '',
  },
  // vite.node.config.ts + wrangler.node.jsonc: no flags, so Node.js compatibility is on by default.
  nodeDefault: {
    root: 'dist/node',
    outDir: 'dist/node/hollware_spike_comark_node',
    args: ['--config', 'vite.node.config.ts'],
    log: '',
  },
  // A Worker that imports node:path, built with both opt-out flags.
  control: {
    root: 'dist/control',
    outDir: 'dist/control/hollware_spike_comark_control',
    args: ['--config', 'scripts/control/vite.config.ts'],
    log: '',
  },
}

beforeAll(() => {
  for (const entry of Object.values(builds)) {
    // A stale output of an earlier build would let a broken build config pass.
    rmSync(`${root}${entry.root}`, { recursive: true, force: true })
    const result = build(entry.args)
    expect(result.status).toBe(0)
    entry.log = result.log
  }
}, 120_000)

const NODE_WARNING = 'Unexpected Node.js imports'

describe('the built bundle needs no Node.js built-ins', () => {
  it.each(['optOut', 'nodeDefault'] as const)('%s build: a self-contained module', (name) => {
    const source = readFileSync(`${root}${builds[name].outDir}/index.js`, 'utf8')

    // The only module statement is the default export: no import, no dynamic import, no require.
    expect(source).not.toMatch(/^import\s/m)
    expect(source).not.toMatch(/\bimport\s*\(/)
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/["']node:[a-z_/]+["']/)
    expect(source.match(/^export .*$/gm)).toStrictEqual([
      'export { worker_entry_default as default };',
    ])
  })

  it('the opt-out build prints no Node.js warning, and the control that imports node:path does', () => {
    expect(builds.optOut.log).not.toContain(NODE_WARNING)
    expect(builds.control.log).toContain(NODE_WARNING)
    expect(builds.control.log).toContain('"node:path" imported from "index.ts"')
  })

  it('the generated configs carry what the two wrangler configs say', () => {
    const generated = (name: keyof typeof builds): unknown =>
      JSON.parse(readFileSync(`${root}${builds[name].outDir}/wrangler.json`, 'utf8'))

    expect(generated('optOut')).toMatchObject({
      compatibility_date: '2026-10-06',
      compatibility_flags: ['no_nodejs_compat', 'no_nodejs_compat_v2'],
    })
    expect(generated('nodeDefault')).toMatchObject({
      compatibility_date: '2026-10-06',
      compatibility_flags: [],
    })
  })
})

async function probe(flags: string[], date = '2026-10-06'): Promise<unknown> {
  const server = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: 'node-probe',
          main: 'test/fixtures/node-probe.mjs',
          compatibility_date: date,
          compatibility_flags: flags,
        },
      },
    ],
  })
  try {
    await server.listen()
    return await (await server.fetch('/')).json()
  } finally {
    await server.close()
  }
}

describe('what "without nodejs_compat" means at compatibility date 2026-10-06', () => {
  it('Node.js compatibility is ON with no flags at all', async () => {
    expect(await probe([])).toStrictEqual({
      typeofProcess: 'object',
      typeofBuffer: 'function',
      'node:buffer': 'importable',
      'node:path': 'importable',
      'node:fs': 'importable',
    })
  })

  it('the default flips on 2026-08-04: the day before, no flags means no Node.js at all', async () => {
    const off = {
      typeofProcess: 'undefined',
      typeofBuffer: 'undefined',
      'node:buffer': 'rejected',
      'node:path': 'rejected',
      'node:fs': 'rejected',
    }
    const on = {
      typeofProcess: 'object',
      typeofBuffer: 'function',
      'node:buffer': 'importable',
      'node:path': 'importable',
      'node:fs': 'importable',
    }

    expect(await probe([], '2026-08-03')).toStrictEqual(off)
    expect(await probe([], '2026-08-04')).toStrictEqual(on)
  })

  it('no_nodejs_compat alone still leaves Node.js built-ins available', async () => {
    expect(await probe(['no_nodejs_compat'])).toStrictEqual({
      typeofProcess: 'object',
      typeofBuffer: 'function',
      'node:buffer': 'importable',
      'node:path': 'importable',
      'node:fs': 'rejected',
    })
  })

  it('no_nodejs_compat and no_nodejs_compat_v2 together switch it off', async () => {
    expect(await probe(['no_nodejs_compat', 'no_nodejs_compat_v2'])).toStrictEqual({
      typeofProcess: 'undefined',
      typeofBuffer: 'undefined',
      'node:buffer': 'rejected',
      'node:path': 'rejected',
      'node:fs': 'rejected',
    })
  })
})

describe.each([
  [
    'both opt-out flags (Node.js compatibility off)',
    'optOut',
    { typeofProcess: 'undefined', typeofBuffer: 'undefined', typeofSetImmediate: 'undefined' },
  ],
  [
    'no flags (Node.js compatibility on by default)',
    'nodeDefault',
    { typeofProcess: 'object', typeofBuffer: 'function', typeofSetImmediate: 'function' },
  ],
] as const)('the built Worker in workerd with %s', (_label, name, nodeGlobals) => {
  const server = createTestHarness({
    root,
    workers: [{ configPath: `${root}${builds[name].outDir}/wrangler.json` }],
  })

  beforeAll(async () => {
    await server.listen()
    return async () => {
      await server.close()
    }
  }, 60_000)

  it('runs the library in a request that reports the Node.js globals of its isolate', async () => {
    const response = await server.fetch('/runtime')

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({
      ...nodeGlobals,
      headings: [{ depth: 1, text: 'Runtime check', id: 'runtime-check' }],
      html: '<h1 id="runtime-check">Runtime check</h1>\n<p>A <a href="/a/">link</a>.</p>',
    })
  })

  it('answers POST /process with the exact frontmatter, headings, links, images, components and HTML', async () => {
    const response = await server.fetch('/process', { method: 'POST', body: SMALL_POST })

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({
      frontmatter: SMALL_POST_FRONTMATTER,
      extracted: {
        headings: SMALL_POST_HEADINGS,
        links: SMALL_POST_LINKS,
        images: SMALL_POST_IMAGES,
        components: SMALL_POST_COMPONENTS,
        words: 82,
      },
      html: SMALL_POST_HTML,
    })
  })

  it('renders a stored document without parsing again (POST /parse then POST /render)', async () => {
    const stored = await (await server.fetch('/parse', { method: 'POST', body: SMALL_POST })).text()
    const response = await server.fetch('/render', { method: 'POST', body: stored })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SMALL_POST_HTML)
  })

  it('hits the autoClose stack overflow of comark in this runtime too, and only with it on', async () => {
    const overflow = await server.fetch('/autoclose', { method: 'POST', body: '*a '.repeat(5000) })
    const fine = await server.fetch('/autoclose', { method: 'POST', body: '# Title\n\ntext' })

    expect(await overflow.json()).toStrictEqual({ autoCloseOn: 'RangeError', autoCloseOff: 'ok' })
    expect(await fine.json()).toStrictEqual({ autoCloseOn: 'ok', autoCloseOff: 'ok' })
  })

  it.each(SAFETY_CASES)('POST /safe: $name gives the safe-configuration output', async (item) => {
    const response = await server.fetch('/safe', { method: 'POST', body: item.markdown })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(item.safe)
  })
})
