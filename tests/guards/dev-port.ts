import { parseJsonc } from '../support/jsonc.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * A Hollware project serves `vp dev` on one fixed port, and its `HOLLWARE_PUBLIC_URL` names that
 * port: the Worker refuses any other Host. `vite.config.ts` sets `server.port` with `strictPort`,
 * so a port in use fails instead of moving to one the Host check would refuse.
 */
export function checkDevPort(input: {
  readonly viteConfig: TextFile
  readonly wranglerConfig: TextFile
}): Violation[] {
  const { viteConfig, wranglerConfig } = input
  const violations: Violation[] = []
  const port = /server:\s*\{\s*port:\s*(\d+),\s*strictPort:\s*true\s*\}/.exec(viteConfig.text)?.[1]
  if (port === undefined) {
    violations.push({
      rule: 'dev-port/fixed',
      file: viteConfig.path,
      message: 'Set `server: { port: <n>, strictPort: true }`: the dev port must not move.',
    })
  }
  const parsed = parseJsonc(wranglerConfig.text)
  const config = parsed.ok ? parsed.value : undefined
  const vars =
    typeof config === 'object' && config !== null && 'vars' in config ? config.vars : undefined
  const url =
    typeof vars === 'object' && vars !== null && 'HOLLWARE_PUBLIC_URL' in vars
      ? vars.HOLLWARE_PUBLIC_URL
      : undefined
  if (port !== undefined && url !== `http://localhost:${port}`) {
    violations.push({
      rule: 'dev-port/public-url',
      file: wranglerConfig.path,
      message: `HOLLWARE_PUBLIC_URL is ${String(url)}; set it to http://localhost:${port}, the port of vite.config.ts.`,
    })
  }
  return violations
}
