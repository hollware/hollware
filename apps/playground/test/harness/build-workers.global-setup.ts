import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The projects whose Workers the harness tests run: Hollware (this project) and the example site.
const projects = [
  new URL('../../', import.meta.url),
  new URL('../../../../examples/worker-site/', import.meta.url),
]

// The harness tests run the production build output, so they build it first. This keeps
// `vp test` working on a clean checkout, before any `vp run -r build`.
// Only the project-local `vp` matches the Cloudflare plugin.
export default function buildWorkers() {
  for (const project of projects) {
    execFileSync(fileURLToPath(new URL('node_modules/.bin/vp', project)), ['build'], {
      cwd: fileURLToPath(project),
      stdio: 'pipe',
    })
  }
}
