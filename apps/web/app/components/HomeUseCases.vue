<script setup lang="ts">
/**
 * The ways of working with Hollware, one at a time: a list to pick from and the workflow of the
 * one picked. Every panel is in the page, so a reader without JavaScript and a crawler see them all.
 */
const { m } = useLocale()
const active = ref(0)
const cases = computed(() => m.value.home.cases.items)

const ICONS = [
  'i-lucide-pen-line',
  'i-lucide-users',
  'i-lucide-book-open',
  'i-lucide-languages',
  'i-lucide-trending-up',
  'i-lucide-folder-input',
]
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <div
      role="tablist"
      aria-orientation="vertical"
      class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
    >
      <button
        v-for="(item, index) in cases"
        :id="`case-tab-${index}`"
        :key="item.label"
        type="button"
        role="tab"
        :aria-selected="active === index"
        :aria-controls="`case-panel-${index}`"
        class="flex shrink-0 items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors"
        :class="
          active === index
            ? 'border-accented bg-elevated text-highlighted'
            : 'border-transparent text-muted hover:bg-elevated/50 hover:text-default'
        "
        @click="active = index"
      >
        <UIcon
          :name="ICONS[index] ?? 'i-lucide-circle'"
          class="size-4 shrink-0"
          :class="active === index ? 'text-secondary' : ''"
        />
        <span class="font-medium whitespace-nowrap">{{ item.label }}</span>
      </button>
    </div>

    <div class="min-w-0 rounded-lg border border-default bg-muted/40">
      <div
        v-for="(item, index) in cases"
        v-show="active === index"
        :id="`case-panel-${index}`"
        :key="item.label"
        role="tabpanel"
        :aria-labelledby="`case-tab-${index}`"
        class="grid gap-8 p-6 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
      >
        <div class="flex flex-col gap-3">
          <h3 class="text-xl font-semibold text-balance text-highlighted">{{ item.title }}</h3>
          <p class="text-muted">{{ item.description }}</p>
        </div>
        <ol class="relative flex flex-col gap-4">
          <li v-for="(step, n) in item.steps" :key="step" class="relative flex gap-4">
            <span
              v-if="n < item.steps.length - 1"
              class="absolute top-7 bottom-[-1rem] left-[0.6875rem] w-px bg-(--ui-border-accented)"
            />
            <span
              class="relative flex size-6 shrink-0 items-center justify-center rounded-md border border-accented bg-default font-mono text-[11px] text-secondary"
              >{{ n + 1 }}</span
            >
            <span class="pt-0.5 text-sm text-default">{{ step }}</span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>
