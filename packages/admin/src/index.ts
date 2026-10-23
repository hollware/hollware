import { fileURLToPath } from 'node:url'

export const name = '@hollware/admin'

/**
 * The directory of the admin's built files, for the user's Vite config: `publicDir:
 * adminAssets()` serves them in development and copies them into the build, where the Worker's
 * static assets hold them under `/admin/`. The files are built before the package is
 * published; in this repository, `vp run -r build` builds them.
 */
export function adminAssets(): string {
  return fileURLToPath(new URL('../dist/client', import.meta.url))
}
