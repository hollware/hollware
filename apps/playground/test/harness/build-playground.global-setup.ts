import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)

// The harness tests run the production build output, so they build it first. This keeps
// `vp test` working on a clean checkout, before any `vp run -r build`.
// Only the project-local `vp` matches the Cloudflare plugin.
export default function buildPlayground() {
  execFileSync(fileURLToPath(new URL('node_modules/.bin/vp', root)), ['build'], {
    cwd: fileURLToPath(root),
    stdio: 'pipe',
  })
}
