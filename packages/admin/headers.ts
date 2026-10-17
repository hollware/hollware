import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Workers Static Assets serves the admin's hashed files without the Worker (ADR-026), so their
 * headers come from a `_headers` file at the root of the assets: no type sniffing, no other origin
 * loads them, and HTTPS only. The build writes it next to `admin/`, which a public directory of
 * the app (inside `admin/`) cannot reach.
 */
export const HEADERS = `/admin/assets/*
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=31536000
`

/** A Vite plugin that writes `_headers` into `root`, the directory of the assets, after a build. */
export function assetHeaders(root: string) {
  return {
    name: 'hollware-asset-headers',
    closeBundle() {
      writeFileSync(join(root, '_headers'), HEADERS)
    },
  }
}
