/**
 * The files of a tar archive (POSIX ustar, with pax and GNU long names), as an EmDash site
 * package is one (`.emdash`). Only regular files are read; directories, links and anything else
 * are passed over, and a name that would lead out of the archive is refused.
 */

const BLOCK = 512

/** The text of a header field: up to its first NUL. */
function field(header: Uint8Array, start: number, length: number): string {
  const bytes = header.subarray(start, start + length)
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end))
}

/** An octal number of a header field, as tar writes sizes. */
function octal(header: Uint8Array, start: number, length: number): number {
  const value = field(header, start, length).trim()
  return value === '' ? 0 : Number.parseInt(value, 8)
}

/** The `path` of a pax extended header, whose records read `<length> <key>=<value>\n`. */
function paxPath(data: Uint8Array): string | undefined {
  for (const record of new TextDecoder().decode(data).split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record)
    if (match?.[1] !== undefined) return match[1]
  }
  return undefined
}

/** Whether a name stays inside the archive: relative, with no `.` or `..` segment. */
function isSafe(name: string): boolean {
  return (
    name !== '' &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    name.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

export class TarError extends Error {}

/** Every regular file of the archive, by its name. */
export function readTar(archive: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let offset = 0
  let longName: string | undefined
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const size = octal(header, 124, 12)
    if (!Number.isFinite(size) || size < 0)
      throw new TarError('A header of the archive has no size.')
    const type = String.fromCharCode(header[156] ?? 0)
    const start = offset + BLOCK
    const data = archive.subarray(start, start + size)
    if (data.length !== size) throw new TarError('The archive ends inside a file.')
    offset = start + Math.ceil(size / BLOCK) * BLOCK
    if (type === 'x') {
      longName = paxPath(data)
      continue
    }
    if (type === 'L') {
      longName = new TextDecoder().decode(data).replace(/\0+$/, '')
      continue
    }
    const prefix = field(header, 345, 155)
    const name =
      longName ?? (prefix === '' ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`)
    longName = undefined
    if (type !== '0' && type !== '\0') continue
    const path = name.replace(/^\.\//, '')
    if (!isSafe(path)) throw new TarError(`The archive holds a file outside itself: ${path}`)
    files.set(path, data.slice())
  }
  return files
}
