import { watchEffect } from 'vue'
import { me } from './me.ts'

export function usePageTitle(title: () => string): void {
  watchEffect(() => {
    document.title = [title(), me.value?.site, 'Hollware']
      .filter((part) => part !== undefined && part !== '')
      .join(' · ')
  })
}
