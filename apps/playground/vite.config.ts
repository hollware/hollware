import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [
    cloudflare({
      // The site Worker runs next to the playground and reaches it over a service binding.
      auxiliaryWorkers: [{ configPath: './site/wrangler.jsonc' }],
    }),
  ],
})
