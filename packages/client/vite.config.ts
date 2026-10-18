import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    // webhooks: the signature of webhooks alone, with no zod and no other import, for a site
    // whose own zod is another major (Nuxt Content's is zod 3).
    entry: ['src/index.ts', 'src/webhooks.ts'],
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
          ? {
              ...exports,
              '.': { types: './dist/index.d.mts', default: './dist/index.mjs' },
              './webhooks': { types: './dist/webhooks.d.mts', default: './dist/webhooks.mjs' },
            }
          : exports,
    },
  },
})
