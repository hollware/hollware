<script setup lang="ts">
import { Fog, Glow, ImageTexture, Shader, WaveDistortion } from 'shaders/vue'
import { BRAND } from '../../utils/brand'

interface Controls {
  setFrameRateCap: (fps: number) => void
  setResolutionScale: (scale: number) => void
  pause: () => void
  resume: () => void
}

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ ready: []; unavailable: [] }>()
const shader = useTemplateRef<Controls>('shader')
const flame = ref(0.9)
let frame = 0
let started = 0

function flicker(now: number) {
  const t = (now - started) / 1000
  flame.value =
    0.85 + 0.18 * Math.sin(t * 2.1) + 0.08 * Math.sin(t * 5.3 + 1.7) + 0.05 * Math.sin(t * 11.9)
  frame = requestAnimationFrame(flicker)
}

function ready() {
  shader.value?.setFrameRateCap(30)
  emit('ready')
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      shader.value?.resume()
      started = performance.now()
      frame = requestAnimationFrame(flicker)
    } else {
      shader.value?.pause()
      cancelAnimationFrame(frame)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelAnimationFrame(frame))
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
    <Fog
      :color-a="BRAND.carbon800"
      :color-b="BRAND.flame950"
      :speed="0.25"
      :turbulence="0.5"
      :detail="8"
      :blending="0.6"
      :mouse-influence="0.05"
    />
    <Glow :intensity="flame" :threshold="0.25" :size="48">
      <WaveDistortion :strength="0.012" :frequency="2.5" :speed="0.7" :angle="90">
        <ImageTexture url="/brand/hollware-mark.png" object-fit="contain" />
      </WaveDistortion>
    </Glow>
  </Shader>
</template>
