import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
  pack: {
    entry: ['src/index.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      devExports: true,
      customExports: (exports, { isPublish }) =>
        isPublish
          ? { ...exports, '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } }
          : exports,
    },
  },
})
