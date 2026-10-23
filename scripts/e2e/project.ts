import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const PROJECT_URL = 'http://localhost:5199'

export function step(message: string): void {
  process.stdout.write(`\n▸ ${message}\n`)
}

export function fail(message: string): never {
  throw new Error(message)
}

export async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, [...args], {
      cwd,
      env,
      maxBuffer: 64 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    fail(`${command} ${args.join(' ')} failed:\n${failed.stdout ?? ''}\n${failed.stderr ?? ''}`)
  }
}

export async function waitFor(url: string, seconds: number): Promise<void> {
  for (let tried = 0; tried < seconds; tried += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  fail(`${url} did not answer in ${seconds} s`)
}

export async function startDev(
  project: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stop: () => void }> {
  const server: ChildProcess = spawn(join(project, 'node_modules/.bin/vp'), ['dev'], {
    cwd: project,
    env,
    stdio: 'ignore',
    detached: true,
  })
  const stop = () => {
    if (server.pid === undefined) return
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {}
  }
  try {
    await waitFor(`${PROJECT_URL}/health`, 120)
  } catch (error) {
    stop()
    throw error
  }
  return { stop }
}

export async function mcp(
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${PROJECT_URL}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params['name'] === 'string' ? { 'mcp-name': params['name'] } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'hollware-e2e', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  const message = (await response.json()) as { result?: Record<string, unknown> }
  if (response.status !== 200 || message.result === undefined) {
    fail(`MCP ${method} answered ${response.status}: ${JSON.stringify(message)}`)
  }
  return message.result
}

export async function call(
  token: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await mcp(token, 'tools/call', { name: tool, arguments: args })
  const output = result['structuredContent']
  if (typeof output !== 'object' || output === null) fail(`${tool} answered no output`)
  return output as Record<string, unknown>
}

export function post(title: string, group: string): string {
  return `---
title: ${title}
description: A post that an end-to-end test of Hollware writes and publishes.
date: 2026-10-15
tags:
  - e2e
translationGroup: ${group}
---

# ${title}

Plain words, and nothing else.
`
}

export async function publishPost(token: string, slug: string, title: string): Promise<void> {
  const draft = await call(token, 'create_draft', {
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: post(title, slug),
  })
  const entry = draft['entry'] as { id: string; version: number } | undefined
  if (entry === undefined) fail(`create_draft answered ${JSON.stringify(draft)}`)
  let published = await call(token, 'publish', { id: entry.id, version: entry.version })
  if (published['outcome'] === 'needs_acknowledgement') {
    const { warnings } = published['verdict'] as {
      warnings: { contract: string; path: string }[]
    }
    published = await call(token, 'publish', {
      id: entry.id,
      version: entry.version,
      acknowledgeWarnings: warnings.map(({ contract, path }) => ({ contract, path })),
    })
  }
  if (published['outcome'] !== 'published') fail(`publish answered ${JSON.stringify(published)}`)
}

export async function readPublished(token: string, slug: string): Promise<number> {
  const response = await fetch(`${PROJECT_URL}/v1/blog/en/${slug}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as { entry?: { status?: string } }
  return response.status === 200 && body.entry?.status === 'published' ? 200 : response.status
}
