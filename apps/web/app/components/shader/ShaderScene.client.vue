<script setup lang="ts">
import {
  Aurora,
  CursorRipples,
  DotGrid,
  FilmGrain,
  FlowingGradient,
  Godrays,
  Shader,
} from 'shaders/vue'
import { BRAND } from '../../utils/brand'

interface Controls {
  setFrameRateCap: (fps: number) => void
  setResolutionScale: (scale: number) => void
  pause: () => void
  resume: () => void
}

const props = defineProps<{
  variant: 'hero' | 'order' | 'cta'
  progress?: number
  active: boolean
}>()
const emit = defineEmits<{ ready: []; unavailable: [] }>()
const shader = useTemplateRef<Controls>('shader')
const disorder = computed(() => 0.9 * (1 - Math.min(1, Math.max(0, props.progress ?? 0))))

function ready() {
  shader.value?.setFrameRateCap(30)
  shader.value?.setResolutionScale(0.6)
  emit('ready')
}

watch(
  () => props.active,
  (active) => (active ? shader.value?.resume() : shader.value?.pause()),
)
</script>

<template>
  <Shader
    ref="shader"
    class="size-full"
    :disable-telemetry="true"
    color-space="srgb"
    @ready="ready"
    @unavailable="emit('unavailable')"
  >
    <template v-if="variant === 'hero'">
      <Aurora
        :color-a="BRAND.flame800"
        :color-b="BRAND.flame400"
        :color-c="BRAND.flame950"
        color-space="oklch"
        :intensity="42"
        :curtain-count="3"
        :speed="1.4"
        :waviness="38"
        :height="95"
      />
      <CursorRipples :intensity="4" :decay="12" :radius="0.35" :chromatic-split="0" />
      <FilmGrain :strength="0.12" :animated="true" />
    </template>
    <template v-else-if="variant === 'order'">
      <FlowingGradient
        :color-a="BRAND.carbon950"
        :color-b="BRAND.carbon900"
        :color-c="BRAND.flame950"
        :color-d="BRAND.flame800"
        :speed="0.6"
        :distortion="disorder"
      />
      <DotGrid :color="BRAND.flame600" :density="48" :dot-size="0.12" :twinkle="disorder" />
      <FilmGrain :strength="0.1" />
    </template>
    <template v-else>
      <Godrays
        :center="{ x: 0.5, y: -0.1 }"
        :density="0.22"
        :intensity="0.55"
        :spotty="0.6"
        :speed="0.25"
        :ray-color="BRAND.flame400"
      />
      <FilmGrain :strength="0.12" :animated="true" />
    </template>
  </Shader>
</template>
