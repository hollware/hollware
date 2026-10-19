import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      // Inside the workspace `exports` point at the source, so no package needs another one
      // built (ADR-016). The published entry goes to `publishConfig`.
      devExports: true,
      // The published entry spells out the `types` condition, so resolving the types does not
      // depend on `index.d.mts` happening to sit next to `index.mjs`.
      // The Astro components ship as their source, which Astro compiles in the site, both here
      // and once published.
      customExports: (exports, { isPublish }) => ({
        ...exports,
        ...(isPublish ? { '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } } : {}),
        './HollwareContent.astro': './components/HollwareContent.astro',
        './HollwareImage.astro': './components/HollwareImage.astro',
      }),
    },
  },
})
