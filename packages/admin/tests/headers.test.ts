import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { assetHeaders } from '../headers.ts'

describe('the headers of the admin assets', () => {
  it('are written to _headers at the root of the assets after a build', () => {
    const root = mkdtempSync(join(tmpdir(), 'admin-assets-'))

    assetHeaders(root).closeBundle()

    expect(readFileSync(join(root, '_headers'), 'utf8')).toBe(
      '/admin/assets/*\n  X-Content-Type-Options: nosniff\n  Cross-Origin-Resource-Policy: same-origin\n  Strict-Transport-Security: max-age=31536000\n',
    )
  })

  it('are written by the build of the app', () => {
    const config = readFileSync(join(import.meta.dirname, '..', 'vite.app.config.ts'), 'utf8')
    expect(config).toContain("assetHeaders(fileURLToPath(new URL('dist/client', import.meta.url)))")
  })
})
