<script setup lang="ts">
const root = useTemplateRef('root')
const progress = ref(0)

function measure() {
  const box = root.value?.getBoundingClientRect()
  if (box === undefined) return
  const span = window.innerHeight + box.height
  progress.value = Math.min(1, Math.max(0, (window.innerHeight - box.top) / span) * 1.6)
}

onMounted(() => {
  measure()
  window.addEventListener('scroll', measure, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', measure))
</script>

<template>
  <section ref="root" class="relative isolate overflow-hidden py-24">
    <ShaderBackdrop variant="order" :progress="progress" />
    <UContainer class="grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
      <div class="landing-code chaos-before min-w-0">
        <slot name="before" />
      </div>
      <UIcon
        name="i-lucide-arrow-right"
        class="mx-auto size-6 rotate-90 text-secondary lg:rotate-0"
      />
      <div class="landing-code chaos-after min-w-0">
        <slot name="after" />
      </div>
    </UContainer>
  </section>
</template>
