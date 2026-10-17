import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getIcons } from '@iconify/utils'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'
import { assetHeaders } from './headers.ts'

/**
 * The single-page app of the admin (ADR-026), built apart from the package's entry (`vite.config.ts`
 * packs `src/`). It is served by the user's Worker at `/admin/`, from the static assets of
 * `dist/client`, so its base is `/admin/` and it lands in `dist/client/admin`.
 */

const require = createRequire(import.meta.url)

/** The files under a directory, recursively. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  )
}

/**
 * The icons of the admin, in its bundle: the page's policy lets it fetch nothing but its own
 * origin, so Iconify's API is out of reach. They are the Lucide icons that Nuxt UI's components
 * and the admin's own files name (`i-lucide-…`), found when the app is built, and handed to the
 * app as the constant `__HOLLWARE_ICONS__`.
 */
function icons(): unknown {
  const nuxtUi = dirname(fileURLToPath(import.meta.resolve('@nuxt/ui/vite')))
  const files = [
    ...filesUnder(join(nuxtUi, 'shared')),
    ...filesUnder(join(import.meta.dirname, 'app')),
  ]
  const names = new Set<string>()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/i-lucide-([a-z0-9-]+)/g)) {
      if (match[1] !== undefined) names.add(match[1])
    }
  }
  const lucide: Parameters<typeof getIcons>[0] = JSON.parse(
    readFileSync(require.resolve('@iconify-json/lucide/icons.json'), 'utf8'),
  )
  return getIcons(lucide, [...names].sort())
}

export default defineConfig({
  root: 'app',
  base: '/admin/',
  // Nuxt UI's components resolve where a template uses them; composables are imported by name.
  plugins: [
    vue(),
    ui({
      autoImport: false,
      // Dark only: the page carries the class, and nothing switches it.
      colorMode: false,
      // The theme of hollware.com (apps/web/app/app.config.ts; tests/conventions/brand.test.ts).
      ui: {
        colors: { primary: 'neutral', secondary: 'emerald', neutral: 'neutral' },
        input: { defaultVariants: { variant: 'subtle' } },
        textarea: { defaultVariants: { variant: 'subtle' } },
        select: { defaultVariants: { variant: 'subtle' } },
        selectMenu: { defaultVariants: { variant: 'subtle' } },
        inputMenu: { defaultVariants: { variant: 'subtle' } },
        inputNumber: { defaultVariants: { variant: 'subtle' } },
      },
    }),
    assetHeaders(fileURLToPath(new URL('dist/client', import.meta.url))),
  ],
  define: { __HOLLWARE_ICONS__: JSON.stringify(icons()) },
  build: {
    outDir: '../dist/client/admin',
    emptyOutDir: true,
  },
})
