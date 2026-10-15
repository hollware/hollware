<script setup lang="ts">
const route = useRoute()
const slug = computed(() => String(route.params['slug']))
const [{ data, error }, pages] = await Promise.all([
  useHollwareEntry('docs', 'en', slug),
  useDocsPages(),
])
if (error.value)
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })

const entry = computed(() => data.value?.entry ?? null)
const page = computed(() => (entry.value === null ? null : docLink(entry.value)))
const headings = computed(() => headingsOf(entry.value?.document))
const surround = computed(() => {
  const index = pages.value.findIndex((candidate) => candidate.slug === slug.value)
  return { previous: pages.value[index - 1], next: pages.value[index + 1] }
})
const section = computed(
  () => SECTIONS.find((candidate) => candidate.key === page.value?.section)?.label ?? 'Docs',
)

useSeoMeta({
  title: () => page.value?.title ?? 'Docs',
  description: () => page.value?.description ?? '',
})
useHead({
  link: [{ rel: 'alternate', type: 'text/markdown', href: `/docs/${slug.value}.md` }],
})

const components = { callout: resolveComponent('DocsCallout') }
</script>

<template>
  <UContainer>
    <div
      class="grid gap-10 py-10 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]"
    >
      <aside class="hidden lg:block">
        <div class="sticky top-[calc(var(--ui-header-height)+2.5rem)]">
          <DocsSidebar :pages="pages" />
        </div>
      </aside>

      <article v-if="page" class="min-w-0">
        <p class="font-mono text-xs text-primary">{{ section }}</p>
        <h1 class="mt-2 text-4xl font-semibold tracking-tight text-highlighted text-balance">
          {{ page.title }}
        </h1>
        <p class="mt-3 max-w-2xl text-lg text-muted text-pretty">{{ page.description }}</p>
        <div class="mt-4 flex gap-2">
          <UButton
            :to="`/docs/${slug}.md`"
            label="Markdown"
            icon="i-lucide-file-text"
            size="xs"
            color="neutral"
            variant="outline"
          />
        </div>
        <USeparator class="my-8" />
        <HollwareContent :entry="entry" :components="components" class="prose" />

        <div class="mt-16 grid gap-4 sm:grid-cols-2">
          <ULink
            v-if="surround.previous"
            :to="surround.previous.to"
            class="rounded-lg border border-default p-4 hover:border-accented"
          >
            <span class="text-xs text-dimmed">Previous</span>
            <span class="mt-1 block font-medium text-highlighted">{{
              surround.previous.title
            }}</span>
          </ULink>
          <span v-else />
          <ULink
            v-if="surround.next"
            :to="surround.next.to"
            class="rounded-lg border border-default p-4 text-right hover:border-accented"
          >
            <span class="text-xs text-dimmed">Next</span>
            <span class="mt-1 block font-medium text-highlighted">{{ surround.next.title }}</span>
          </ULink>
        </div>
      </article>

      <aside v-if="headings.length > 0" class="hidden xl:block">
        <div class="sticky top-[calc(var(--ui-header-height)+2.5rem)]">
          <p class="mb-3 text-xs font-medium tracking-wide text-dimmed uppercase">On this page</p>
          <ul class="space-y-2 border-l border-default text-sm">
            <li
              v-for="heading in headings"
              :key="heading.id"
              :class="heading.depth === 3 ? 'pl-7' : 'pl-4'"
            >
              <a :href="`#${heading.id}`" class="text-muted hover:text-highlighted">{{
                heading.text
              }}</a>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </UContainer>
</template>
