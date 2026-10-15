import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite-plus'

/**
 * The single-page app of the admin (ADR-026), built apart from the package's entry (`vite.config.ts`
 * packs `src/`). It is served by the user's Worker at `/admin/`, from the static assets of
 * `dist/client`, so its base is `/admin/` and it lands in `dist/client/admin`.
 */
export default defineConfig({
  root: 'app',
  base: '/admin/',
  plugins: [vue(), ui({ autoImport: false, components: false })],
  build: {
    outDir: '../dist/client/admin',
    emptyOutDir: true,
  },
})
