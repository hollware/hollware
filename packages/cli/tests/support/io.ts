import { main, type Io } from '../../src/index.ts'

/** The clock of the tests: 90 days after it is 2027-01-10T12:00:00.000Z. */
export const NOW = new Date('2026-10-12T12:00:00.000Z')

/**
 * Random bytes that are the same on every run and differ from call to call: the first call
 * gets bytes of 1, the second bytes of 2, and so on. A token made of bytes of 3 is `hw_pat_`
 * and fifty-two `3`s.
 */
export function countingBytes(): Io['randomBytes'] {
  let calls = 0
  return (length) => new Uint8Array(length).fill((calls += 1))
}

export interface Harness {
  io: Io
  /** Every message of `io.out`, in order. */
  out: string[]
  /** Every message of `io.err`, in order. */
  err: string[]
}

/**
 * An `Io` that writes to arrays and has no wrangler, no stdin and no temporary directory: a
 * command that reaches for one fails, unless the test gives it. The clock and the random bytes
 * are fixed.
 */
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

/** Runs the CLI with `argv` and returns its exit code and everything it printed. */
export async function run(argv: string[], overrides: Partial<Io> = {}): Promise<Outcome> {
  const { io, out, err } = createIo(overrides)
  const code = await main(argv, io)
  return { code, out, err }
}
