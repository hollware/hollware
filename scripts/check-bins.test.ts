import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { binsOf, checkBins, expectedVersionLine, main } from './check-bins.ts'

let root: string

function addPackage(dir: string, manifest: object, files: Record<string, string> = {}): void {
  mkdirSync(join(root, 'packages', dir), { recursive: true })
  writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify(manifest))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, 'packages', dir, path, '..'), { recursive: true })
    writeFileSync(join(root, 'packages', dir, path), text)
  }
}

const printing = (text: string) => `process.stdout.write(${JSON.stringify(`${text}\n`)})`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-bins-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-bins', () => {
  it('accepts bins that print "<bin> <version>" for --version', () => {
    addPackage(
      'cli',
      { name: 'hollware', version: '1.2.3', bin: { hollware: './dist/index.mjs' } },
      { 'dist/index.mjs': printing('hollware 1.2.3') },
    )
    addPackage(
      'create',
      { name: 'create-hollware', version: '1.2.3', bin: { 'create-hollware': './dist/index.mjs' } },
      { 'dist/index.mjs': printing('create-hollware 1.2.3') },
    )
    addPackage('lib', { name: '@hollware/lib', version: '1.2.3' })
    expect(checkBins(root)).toEqual([
      { dir: 'packages/cli', bin: 'hollware', ok: true, message: 'ok  hollware 1.2.3' },
      {
        dir: 'packages/create',
        bin: 'create-hollware',
        ok: true,
        message: 'ok  create-hollware 1.2.3',
      },
    ])
  })

  it('runs the published bin, not the source one the workspace links', () => {
    addPackage(
      'cli',
      {
        name: 'hollware',
        version: '1.2.3',
        bin: { hollware: './src/index.ts' },
        publishConfig: { bin: { hollware: './dist/index.mjs' } },
      },
      {
        'src/index.ts': 'console.error("the source ran"); process.exit(4)',
        'dist/index.mjs': printing('hollware 1.2.3'),
      },
    )
    expect(checkBins(root)).toEqual([
      { dir: 'packages/cli', bin: 'hollware', ok: true, message: 'ok  hollware 1.2.3' },
    ])
  })

  it('reports a bin that prints another version, even by one digit', () => {
    addPackage(
      'cli',
      { name: 'hollware', version: '1.2.3', bin: { hollware: './dist/index.mjs' } },
      { 'dist/index.mjs': printing('hollware 1.2.4') },
    )
    expect(checkBins(root)).toEqual([
      {
        dir: 'packages/cli',
        bin: 'hollware',
        ok: false,
        message:
          'hollware (packages/cli): ./dist/index.mjs --version printed "hollware 1.2.4", expected "hollware 1.2.3"',
      },
    ])
  })

  it('reports a bin that prints its package name where its bin name belongs', () => {
    addPackage(
      'cli',
      { name: '@hollware/cli', version: '1.2.3', bin: { hollware: './dist/index.mjs' } },
      { 'dist/index.mjs': printing('@hollware/cli 1.2.3') },
    )
    expect(checkBins(root).map((result) => result.ok)).toEqual([false])
  })

  it('reports a bin whose file was not built', () => {
    addPackage('cli', { name: 'hollware', version: '1.2.3', bin: { hollware: './dist/index.mjs' } })
    expect(checkBins(root)).toEqual([
      {
        dir: 'packages/cli',
        bin: 'hollware',
        ok: false,
        message:
          'hollware (packages/cli): ./dist/index.mjs does not exist: run "vp run -r build" first',
      },
    ])
  })

  it('reports a bin that exits with an error', () => {
    addPackage(
      'cli',
      { name: 'hollware', version: '1.2.3', bin: { hollware: './dist/index.mjs' } },
      { 'dist/index.mjs': 'console.error("boom"); process.exit(3)' },
    )
    expect(checkBins(root)[0]?.message).toBe(
      'hollware (packages/cli): ./dist/index.mjs --version exited with 3: boom',
    )
  })

  it('exits 1 when nothing is found, and 0 only when every bin passes', () => {
    expect(main(root)).toBe(1)
    addPackage(
      'cli',
      { name: 'hollware', version: '1.2.3', bin: { hollware: './dist/index.mjs' } },
      { 'dist/index.mjs': printing('hollware 1.2.3') },
    )
    expect(main(root)).toBe(0)
    addPackage('broken', { name: 'broken', version: '1.0.0', bin: { broken: './missing.mjs' } })
    expect(main(root)).toBe(1)
  })

  it('reads the bin of a manifest in both of its forms', () => {
    expect(binsOf({ name: '@scope/tool', bin: './cli.mjs' })).toEqual({ tool: './cli.mjs' })
    expect(binsOf({ name: 'x', bin: { a: './a.mjs', b: './b.mjs' } })).toEqual({
      a: './a.mjs',
      b: './b.mjs',
    })
    expect(binsOf({ name: 'x' })).toEqual({})
    expect(binsOf('not a manifest')).toEqual({})
    expect(
      binsOf({
        name: 'x',
        bin: { a: './src/a.ts' },
        publishConfig: { bin: { a: './dist/a.mjs' } },
      }),
    ).toEqual({ a: './dist/a.mjs' })
    expect(binsOf({ name: '@scope/tool', publishConfig: { bin: './dist/cli.mjs' } })).toEqual({
      tool: './dist/cli.mjs',
    })
    expect(
      binsOf({ name: 'x', bin: { a: './a.mjs' }, publishConfig: { access: 'public' } }),
    ).toEqual({ a: './a.mjs' })
    expect(expectedVersionLine('hollware', '0.0.0')).toBe('hollware 0.0.0')
  })
})
