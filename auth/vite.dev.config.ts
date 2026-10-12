import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

// `vp dev` for the spike's smoke test: the same Worker, with the inspector off so that the only port
// it serves on is the one given on the command line.
export default defineConfig({
  plugins: [cloudflare({ inspectorPort: false })],
})
