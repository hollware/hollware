import { main, type Io } from '../../src/index.ts'

export const NOW = new Date('2026-10-12T12:00:00.000Z')

export function countingBytes(): Io['randomBytes'] {
  let calls = 0
  return (length) => new Uint8Array(length).fill((calls += 1))
}

export interface Harness {
  io: Io
  out: string[]
  err: string[]
}

export function createIo(overrides: Partial<Io> = {}): Harness {
  const out: string[] = []
  const err: string[] = []
  const io: Io = {
    out: (message) => out.push(message),
    err: (message) => err.push(message),
    cwd: '/nowhere',
    now: () => NOW,
    randomBytes: countingBytes(),
    readStdin: () => Promise.resolve(undefined),
    wrangler: (args) => Promise.reject(new Error(`unexpected wrangler call: ${args.join(' ')}`)),
    tempDir: () => {
      throw new Error('unexpected request for a temporary directory')
    },
    ...overrides,
  }
  return { io, out, err }
}

export interface Outcome {
  code: number
  out: string[]
  err: string[]
}

export async function run(argv: string[], overrides: Partial<Io> = {}): Promise<Outcome> {
  const { io, out, err } = createIo(overrides)
  const code = await main(argv, io)
  return { code, out, err }
}
