import { spawn } from 'node:child_process'

export interface Exec {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Runs `node` with `args` as a child process, with `input` on its stdin, and waits for it. It is
 * asynchronous on purpose: a test that serves HTTP in its own process (the stub of Hollware)
 * would deadlock if it blocked on the child.
 */
export function exec(
  args: string[],
  options: { cwd?: string; input?: string } = {},
): Promise<Exec> {
  return new Promise((resolve, reject) => {
    // `--no-warnings` keeps Node's own notices out of the streams under test.
    const child = spawn(process.execPath, ['--no-warnings', ...args], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })
}
