import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getIcons } from '@iconify/utils'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'
import { assetHeaders } from './headers.ts'

const require = createRequire(import.meta.url)

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  )
}

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
  plugins: [
    vue(),
    ui({
      autoImport: false,
      colorMode: false,
      ui: {
        colors: { primary: 'carbon', secondary: 'flame', neutral: 'carbon' },
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
