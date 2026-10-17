import { describe, expect, it } from 'vite-plus/test'

import { readTar, TarError } from '../src/import/tar.ts'

// Fails when: the reading of a tar archive (src/import/tar.ts), as an EmDash package is one,
// misses a file, its name (prefix, pax or GNU long names) or its bytes, reads a directory as a
// file, stops at a file of many blocks, or takes a name that leads out of the archive.

const encoder = new TextEncoder()

/** A ustar header for `name`, with its checksum. */
function header(name: string, size: number, type: string, prefix = ''): Uint8Array {
  const block = new Uint8Array(512)
  const put = (text: string, start: number) => block.set(encoder.encode(text), start)
  put(name, 0)
  put('0000644\0', 100)
  put(`${size.toString(8).padStart(11, '0')}\0`, 124)
  put(type, 156)
  put('ustar\0', 257)
  put('00', 263)
  put(prefix, 345)
  put('        ', 148)
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

/** The archive of these entries: a header, then the data padded to blocks, then two empty blocks. */
function tar(entries: { name: string; data?: string; type?: string; prefix?: string }[]) {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const data = encoder.encode(entry.data ?? '')
    parts.push(header(entry.name, data.length, entry.type ?? '0', entry.prefix))
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
    padded.set(data)
    parts.push(padded)
  }
  parts.push(new Uint8Array(1024))
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const decoded = (files: Map<string, Uint8Array>) =>
  Object.fromEntries([...files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]))

describe('readTar', () => {
  it('reads every regular file with its bytes, long names included, and passes over directories', () => {
    const long = `records/entry/${'x'.repeat(120)}.ndjson`
    const big = 'y'.repeat(1300)
    const files = readTar(
      tar([
        { name: 'records/', type: '5' },
        { name: './manifest.json', data: '{"formatVersion":1}' },
        { name: 'entry/000000.ndjson', data: big, prefix: 'records' },
        { name: 'PaxHeader', data: `${long.length + 9} path=${long}\n`, type: 'x' },
        { name: 'truncated-name', data: 'from pax' },
        { name: '././@LongLink', data: `index/${'z'.repeat(110)}.ndjson\0`, type: 'L' },
        { name: 'truncated-too', data: 'from gnu' },
      ]),
    )

    expect(decoded(files)).toEqual({
      'manifest.json': '{"formatVersion":1}',
      'records/entry/000000.ndjson': big,
      [long]: 'from pax',
      [`index/${'z'.repeat(110)}.ndjson`]: 'from gnu',
    })
  })

  it('refuses a name that leads out of the archive, and an archive cut inside a file', () => {
    expect(() => readTar(tar([{ name: '../outside.json', data: '{}' }]))).toThrow(
      new TarError('The archive holds a file outside itself: ../outside.json'),
    )
    expect(() => readTar(tar([{ name: '/etc/passwd', data: 'x' }]))).toThrow(TarError)
    const cut = tar([{ name: 'manifest.json', data: 'z'.repeat(600) }]).subarray(0, 900)
    expect(() => readTar(cut)).toThrow(new TarError('The archive ends inside a file.'))
  })
})
