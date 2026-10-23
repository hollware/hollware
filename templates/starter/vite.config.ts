import { cloudflare } from '@cloudflare/vite-plugin'
import { adminAssets } from '@hollware/admin'
import { defineConfig } from 'vite-plus'

const LOCAL_URL = 'http://localhost:5199'
const LOCAL_SECRET = 'hollware-local-development-only-not-a-secret'

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      config:
        command === 'serve'
          ? (config) => ({
              vars: {
                HOLLWARE_SECRET: LOCAL_SECRET,
                ...config.vars,
                HOLLWARE_PUBLIC_URL: LOCAL_URL,
              },
            })
          : undefined,
    }),
  ],
  publicDir: adminAssets(),
  server: { port: 5199, strictPort: true },
  build: {
    minify: true,
  },
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: ['dist/**', '.wrangler/**', 'worker-configuration.d.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**', '.wrangler/**', 'worker-configuration.d.ts'],
  },
}))
