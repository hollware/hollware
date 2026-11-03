<script setup lang="ts">
const { m } = useLocale()

const ASSETS = [
  { key: 'mark-on-dark', kind: 'mark', ground: 'dark' },
  { key: 'mark-on-light', kind: 'mark', ground: 'light' },
  { key: 'wordmark-on-dark', kind: 'wordmark', ground: 'dark' },
  { key: 'wordmark-on-light', kind: 'wordmark', ground: 'light' },
] as const

const SWATCHES = [
  { name: 'carbon', hex: BRAND.carbon950, ink: BRAND.flame300 },
  { name: 'carbon', hex: BRAND.carbon800, ink: BRAND.flame300 },
  { name: 'flame', hex: BRAND.flame400, ink: BRAND.carbon950 },
  { name: 'flame', hex: BRAND.flame600, ink: BRAND.carbon950 },
] as const
</script>

<template>
  <div class="not-prose my-8 space-y-10">
    <div class="grid gap-4 sm:grid-cols-2">
      <figure
        v-for="asset in ASSETS"
        :key="asset.key"
        class="overflow-hidden rounded-xl border border-default"
      >
        <img
          :src="`/brand/hollware-${asset.key}.png`"
          :alt="asset.kind === 'mark' ? m.pages.brand.mark : m.pages.brand.wordmark"
          class="aspect-[3/1] w-full object-contain"
          :class="asset.kind === 'mark' ? 'p-6' : ''"
          :style="{ background: asset.ground === 'dark' ? BRAND.carbon950 : '#f7f4ef' }"
          loading="lazy"
        />
        <figcaption
          class="flex items-center justify-between gap-3 border-t border-default px-4 py-3 text-sm"
        >
          <span class="text-highlighted">
            {{ asset.kind === 'mark' ? m.pages.brand.mark : m.pages.brand.wordmark }} ·
            {{ asset.ground === 'dark' ? m.pages.brand.onDark : m.pages.brand.onLight }}
          </span>
          <span class="flex gap-2">
            <UButton
              :to="`/brand/hollware-${asset.key}.svg`"
              :label="m.pages.brand.svg"
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-download"
              download
              external
            />
            <UButton
              :to="`/brand/hollware-${asset.key}.png`"
              :label="m.pages.brand.png"
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-download"
              download
              external
            />
          </span>
        </figcaption>
      </figure>
    </div>

    <div>
      <h3 class="text-sm font-medium text-highlighted">{{ m.pages.brand.colors }}</h3>
      <ul class="mt-3 grid gap-3 sm:grid-cols-4">
        <li
          v-for="swatch in SWATCHES"
          :key="swatch.hex"
          class="flex h-24 flex-col justify-end rounded-lg border border-default p-3 font-mono text-xs"
          :style="{ background: swatch.hex, color: swatch.ink }"
        >
          <span>{{ m.pages.brand[swatch.name] }}</span>
          <span>{{ swatch.hex }}</span>
        </li>
      </ul>
    </div>

    <div>
      <h3 class="text-sm font-medium text-highlighted">{{ m.pages.brand.fonts }}</h3>
      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <li class="rounded-lg border border-default p-4">
          <span class="text-xs text-dimmed">{{ m.pages.brand.sans }}</span>
          <span class="mt-1 block text-2xl font-semibold text-highlighted">{{
            m.pages.brand.sansName
          }}</span>
        </li>
        <li class="rounded-lg border border-default p-4">
          <span class="text-xs text-dimmed">{{ m.pages.brand.mono }}</span>
          <span class="mt-1 block font-mono text-2xl text-highlighted">{{
            m.pages.brand.monoName
          }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
