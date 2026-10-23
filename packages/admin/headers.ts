import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const HEADERS = `/admin/assets/*
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=31536000
`

export function assetHeaders(root: string) {
  return {
    name: 'hollware-asset-headers',
    closeBundle() {
      writeFileSync(join(root, '_headers'), HEADERS)
    },
  }
}
