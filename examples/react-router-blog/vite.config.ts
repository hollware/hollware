import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import { defineConfig } from 'vite-plus'

// A blog that reads the playground's Hollware, as a site of your own would read yours. React
// Router renders on demand, so a publish shows on the next request with no rebuild. The Worker is
// built with the config of wrangler.jsonc, without Node.js compatibility.
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), reactRouter()],
})
