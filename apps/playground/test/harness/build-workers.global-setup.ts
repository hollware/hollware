import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The projects whose Workers the harness tests run: Hollware (this project), the example site
// and, below, the Nuxt example.
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
  // The Nuxt projects, the example and hollware.com, build with Nuxt, which runs Vite itself.
  for (const project of [
    new URL('../../../../examples/nuxt-blog/', import.meta.url),
    new URL('../../../web/', import.meta.url),
  ]) {
    execFileSync(fileURLToPath(new URL('node_modules/.bin/nuxt', project)), ['build'], {
      cwd: fileURLToPath(project),
      stdio: 'pipe',
      // The example counts its views at the harness's Hollware.
      env: { ...process.env, HOLLWARE_BEACON: 'http://localhost' },
    })
  }
}
