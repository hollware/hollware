<script setup lang="ts">
const slots = useSlots()
const { m } = useLocale()
const root = useTemplateRef('root')
const shown = ref(Number.POSITIVE_INFINITY)
let timer: ReturnType<typeof setInterval> | null = null
let observer: IntersectionObserver | null = null

const lines = () => parseSession(textOfVNodes(slots.default?.()))

function play() {
  const total = root.value?.querySelectorAll('[data-line]').length ?? 0
  if (timer !== null || total === 0) return
  shown.value = 0
  let tick = 0
  timer = setInterval(() => {
    tick = (tick + 1) % (total + 7)
    shown.value = tick
  }, 650)
}

function stop() {
  if (timer !== null) clearInterval(timer)
  timer = null
  shown.value = Number.POSITIVE_INFINITY
}

onMounted(() => {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return
  if (root.value === null) return
  observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? play() : stop()))
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  stop()
})

const LOOK = {
  call: 'text-highlighted',
  out: 'text-muted',
  err: 'text-error',
  fix: 'text-secondary',
  person: 'text-success',
  ok: 'text-success',
} as const

const MARK = { call: '›', out: ' ', err: '✕', fix: '→', person: '●', ok: '✓' } as const
</script>

<template>
  <figure
    ref="root"
    class="overflow-hidden rounded-xl border border-default bg-elevated/70 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] backdrop-blur-sm"
  >
    <figcaption
      class="flex items-center gap-2 border-b border-default px-4 py-3 font-mono text-[11px] text-dimmed"
    >
      <span class="size-2.5 rounded-xs bg-accented" />
      <span class="size-2.5 rounded-xs bg-accented" />
      <span class="size-2.5 rounded-xs bg-accented" />
      <span class="ml-2">{{ m.pages.session }}</span>
    </figcaption>
    <ol class="min-h-[22rem] space-y-1.5 p-5 font-mono text-[13px] leading-relaxed">
      <li
        v-for="(line, index) in lines()"
        :key="index"
        data-line
        class="flex gap-3 transition-opacity duration-300"
        :class="[LOOK[line.kind], index < shown ? 'opacity-100' : 'opacity-0']"
      >
        <span class="w-3 shrink-0 select-none text-dimmed">{{ MARK[line.kind] }}</span>
        <span class="min-w-0 break-words">{{ line.text }}</span>
      </li>
    </ol>
  </figure>
</template>
