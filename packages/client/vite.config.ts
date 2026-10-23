import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/webhooks.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      devExports: true,
      customExports: (exports, { isPublish }) =>
        isPublish
          ? {
              ...exports,
              '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
              './webhooks': { types: './dist/webhooks.d.mts', default: './dist/webhooks.mjs' },
            }
          : exports,
    },
  },
})
