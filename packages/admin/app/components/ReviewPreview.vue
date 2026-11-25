<script setup lang="ts">
import { MarkdownDocument } from '@comark/vue/components/MarkdownDocument'
import { computed } from 'vue'
import { visibleDocument } from '../lib/visible-document.ts'

const props = defineProps<{ document: unknown }>()

const value = computed(() => visibleDocument(props.document) as never)
</script>

<template>
  <article
    class="max-w-none space-y-4 leading-relaxed [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-default [&_blockquote]:ps-4 [&_blockquote]:text-muted [&_code]:font-mono [&_code]:text-sm [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_img]:rounded-md [&_ol]:list-decimal [&_ol]:ps-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-elevated [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6 [&_.hw-preview-block]:space-y-2 [&_.hw-preview-block]:rounded-lg [&_.hw-preview-block]:border [&_.hw-preview-block]:border-default [&_.hw-preview-block]:p-3 [&_.hw-preview-name]:font-mono [&_.hw-preview-name]:text-xs [&_.hw-preview-name]:text-muted [&_.hw-preview-slot]:space-y-2 [&_.hw-preview-slot-name]:font-mono [&_.hw-preview-slot-name]:text-xs [&_.hw-preview-slot-name]:text-dimmed [&_.hw-preview-inline]:rounded [&_.hw-preview-inline]:bg-elevated [&_.hw-preview-inline]:px-1"
  >
    <Suspense>
      <MarkdownDocument :value="value" />
    </Suspense>
  </article>
</template>
