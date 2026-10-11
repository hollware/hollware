import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      // With a bare `exports: true`, tsdown writes `"."` as the string "./dist/index.mjs".
      // Spell out the `types` condition too, so resolving the types does not depend on
      // `index.d.mts` happening to sit next to `index.mjs`.
      customExports: {
        '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
      },
    },
  },
})
