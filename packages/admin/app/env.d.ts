// The type-check of the repository (tsgo) does not read single-file components: it sees each one
// as a component. Their templates are checked by the build, and their logic lives in `lib/`.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

// Styles are imported for their effect: Vite puts them in the page.
declare module '*.css'

// The Lucide icons of the admin, which vite.app.config.ts finds and defines.
declare const __HOLLWARE_ICONS__: Parameters<typeof import('@iconify/vue').addCollection>[0] | null
