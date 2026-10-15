import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    // The module, and its runtime file by file: Nuxt adds each runtime file to the app it builds,
    // so they stay separate modules with their imports left as they are.
    entry: ['src/index.ts', 'src/runtime/**/*.ts'],
    unbundle: true,
    // Every package import stays as it is: the Nuxt app resolves vue, h3, nitropack and nuxt itself.
    external: [/^[^./]/],
    dts: { generator: 'tsgo' },
    exports: {
      // Inside the workspace `exports` point at the source, so no package needs another one
      // built (ADR-016). The published entry goes to `publishConfig`.
      devExports: true,
      // The runtime files are the module's to resolve by path, never entry points of their own.
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
