import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/runtime/**/*.ts'],
    unbundle: true,
    external: [/^[^./]/],
    dts: { generator: 'tsgo' },
    exports: {
      devExports: true,
      customExports: (_exports, { isPublish }) =>
        isPublish
          ? {
              '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
              './package.json': './package.json',
            }
          : { '.': './src/index.ts', './package.json': './package.json' },
    },
  },
})
