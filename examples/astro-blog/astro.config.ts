import cloudflare from '@astrojs/cloudflare'
import { defineConfig } from 'astro/config'

// A blog that reads the playground's Hollware, as a site of your own would read yours. Pages are
// rendered on demand, so a publish shows on the next request with no rebuild. The Worker is built
// with the config of wrangler.jsonc, without Node.js compatibility.
export default defineConfig({
  output: 'server',
  // No sessions and no image binding: the blog reads Hollware and nothing else, so its Worker
  // binds no KV namespace and no Images.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
})
