import { onBeforeUnmount, ref, type Ref } from 'vue'

export const NARROW = '(max-width: 639px)'

export function useNarrow(): Readonly<Ref<boolean>> {
  const media = window.matchMedia(NARROW)
  const narrow = ref(media.matches)
  const update = () => {
    narrow.value = media.matches
  }
  media.addEventListener('change', update)
  onBeforeUnmount(() => media.removeEventListener('change', update))
  return narrow
}
