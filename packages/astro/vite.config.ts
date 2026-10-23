import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      devExports: true,
      customExports: (exports, { isPublish }) => ({
        ...exports,
        ...(isPublish ? { '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } } : {}),
        './HollwareContent.astro': './components/HollwareContent.astro',
        './HollwareImage.astro': './components/HollwareImage.astro',
      }),
    },
  },
})
