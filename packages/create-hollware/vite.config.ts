import { defineConfig } from 'vite-plus'

export default defineConfig({
  // The template that the build makes holds the tests of a user's project, not of this package.
  test: { include: ['tests/**/*.test.ts'] },
  pack: {
    entry: ['src/index.ts'],
    dts: { generator: 'tsgo' },
    exports: {
      // Inside the workspace `exports` (and `bin`) point at the source, so no package needs
      // another one built (ADR-016). The published entry goes to `publishConfig`, which
      // `pnpm pack` moves into `exports` and `bin`.
      devExports: true,
      // The published entry spells out the `types` condition, so resolving the types does not
      // depend on `index.d.mts` happening to sit next to `index.mjs`.
      customExports: (exports, { isPublish }) =>
        isPublish
          ? { ...exports, '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } }
          : exports,
    },
  },
})
