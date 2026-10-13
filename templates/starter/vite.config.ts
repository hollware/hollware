import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    // What you deploy is what the size budget of Hollware measures: minified.
    minify: true,
  },
})
