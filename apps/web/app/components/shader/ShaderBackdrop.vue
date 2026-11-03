<script setup lang="ts">
const props = defineProps<{ variant: 'hero' | 'order' | 'cta'; progress?: number }>()
const root = useTemplateRef('root')
const wanted = ref(false)
const visible = ref(false)
const hidden = ref(false)
const shown = ref(false)
const failed = ref(false)
let observer: IntersectionObserver | null = null
const seen = () => (hidden.value = document.hidden)

onMounted(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  const saving =
    (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true
  if (!motion || saving || !('gpu' in navigator) || root.value === null) return
  observer = new IntersectionObserver(
    ([entry]) => {
      visible.value = entry?.isIntersecting === true
      if (visible.value) wanted.value = true
    },
    { rootMargin: '200px' },
  )
  observer.observe(root.value)
  document.addEventListener('visibilitychange', seen)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', seen)
})
</script>

<template>
  <div
    ref="root"
    class="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    aria-hidden="true"
  >
    <div :class="`shader-fallback shader-fallback-${props.variant}`" />
    <ClientOnly>
      <LazyShaderScene
        v-if="wanted && !failed"
        :variant="props.variant"
        :progress="props.progress"
        :active="visible && !hidden"
        class="absolute inset-0 transition-opacity duration-1000"
        :class="shown ? 'opacity-100' : 'opacity-0'"
        @ready="shown = true"
        @unavailable="failed = true"
      />
    </ClientOnly>
    <div :class="`shader-scrim shader-scrim-${props.variant}`" />
  </div>
</template>
