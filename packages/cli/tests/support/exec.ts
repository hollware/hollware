import { spawn } from 'node:child_process'

export interface Exec {
  code: number | null
  stdout: string
  stderr: string
}

export function exec(
  args: string[],
  options: { cwd?: string; input?: string } = {},
): Promise<Exec> {
  return new Promise((resolve, reject) => {
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
