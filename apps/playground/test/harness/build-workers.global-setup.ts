import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projects = [
  new URL('../../', import.meta.url),
  new URL('../../../../examples/worker-site/', import.meta.url),
]

export default function buildWorkers() {
  for (const project of projects) {
    execFileSync(fileURLToPath(new URL('node_modules/.bin/vp', project)), ['build'], {
      cwd: fileURLToPath(project),
      stdio: 'pipe',
    })
  }
  for (const project of [
    new URL('../../../../examples/nuxt-blog/', import.meta.url),
    new URL('../../../web/', import.meta.url),
  ]) {
    execFileSync(fileURLToPath(new URL('node_modules/.bin/nuxt', project)), ['build'], {
      cwd: fileURLToPath(project),
      stdio: 'pipe',
    })
  }
  const astro = new URL('../../../../examples/astro-blog/', import.meta.url)
  execFileSync(fileURLToPath(new URL('node_modules/.bin/astro', astro)), ['build'], {
    cwd: fileURLToPath(astro),
    stdio: 'pipe',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  })
  const reactRouter = new URL('../../../../examples/react-router-blog/', import.meta.url)
  execFileSync(fileURLToPath(new URL('node_modules/.bin/react-router', reactRouter)), ['build'], {
    cwd: fileURLToPath(reactRouter),
    stdio: 'pipe',
  })
}
