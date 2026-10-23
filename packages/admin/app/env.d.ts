declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

declare module '*.css'

declare const __HOLLWARE_ICONS__: Parameters<typeof import('@iconify/vue').addCollection>[0] | null
