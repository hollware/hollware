<script setup lang="ts">
import { MarkdownDocument } from '@comark/vue/components/MarkdownDocument'
import { computed } from 'vue'

const props = defineProps<{ document: unknown }>()

const value = computed(() => props.document as never)
</script>

<template>
  <article
    class="max-w-none space-y-4 leading-relaxed [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-default [&_blockquote]:ps-4 [&_blockquote]:text-muted [&_code]:font-mono [&_code]:text-sm [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_img]:rounded-md [&_ol]:list-decimal [&_ol]:ps-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-elevated [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6"
  >
    <Suspense>
      <MarkdownDocument :value="value" />
    </Suspense>
  </article>
</template>
