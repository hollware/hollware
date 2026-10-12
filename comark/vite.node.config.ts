import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// CONTRAST build: the same Worker with no compatibility flags, so Node.js compatibility is on by
// default (see wrangler.node.jsonc). The project's own build, vite.config.ts, has it switched off, and
// the Cloudflare plugin then warns about every import of a Node built-in ("Unexpected Node.js imports
// for environment ..."), so a clean build there is evidence that nothing needs it.
export default defineConfig({
  plugins: [cloudflare({ configPath: './wrangler.node.jsonc' })],
  build: { outDir: 'dist/node' },
})
