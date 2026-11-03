<script setup lang="ts">
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
  observer = new IntersectionObserver(([entry]) => {
    visible.value = entry?.isIntersecting === true
    if (visible.value) wanted.value = true
  })
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
    class="hero-mark relative mx-auto aspect-[430/512] w-full max-w-[26rem]"
    aria-hidden="true"
  >
    <img
      src="/brand/hollware-mark.svg"
      alt=""
      class="hero-mark-still absolute inset-[14%] size-[72%] transition-opacity duration-700"
      :class="shown ? 'opacity-0' : 'opacity-100'"
    />
    <ClientOnly>
      <LazyShaderScene
        v-if="wanted && !failed"
        :active="visible && !hidden"
        class="absolute inset-0 transition-opacity duration-1000"
        :class="shown ? 'opacity-100' : 'opacity-0'"
        @ready="shown = true"
        @unavailable="failed = true"
      />
    </ClientOnly>
  </div>
</template>
