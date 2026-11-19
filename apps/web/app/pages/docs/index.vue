<script setup lang="ts">
const { locale, m, to } = useLocale()
const pages = await useDocsPages(locale.value)
if (pages.value.length === 0)
  throw createError({ statusCode: 404, statusMessage: m.value.docs.empty, fatal: true })

const reference = computed(() => [
  {
    title: m.value.tools.title,
    description: m.value.tools.description,
    to: to('/reference/mcp-tools/'),
  },
  {
    title: m.value.readApi.title,
    description: m.value.readApi.description,
    to: to('/reference/read-api/'),
  },
  {
    title: m.value.events.title,
    description: m.value.events.description,
    to: to('/reference/events/'),
  },
])
const groups = computed(() =>
  SECTIONS.map((section) => ({
    section,
    label: m.value.docs.sections[section],
    items: [
      ...pages.value.filter((page) => page.section === section),
      ...(section === 'reference' ? reference.value : []),
    ],
  })).filter((group) => group.items.length > 0),
)

useSeoMeta({
  title: () => m.value.docs.title,
  description: () => m.value.docs.description,
  ogTitle: () => `${m.value.docs.title} · Hollware`,
  ogDescription: () => m.value.docs.description,
})
useHead({
  script: () => [
    {
      key: 'jsonld-page',
      type: 'application/ld+json',
      innerHTML: jsonLdOf([
        breadcrumbs([
          { name: 'Hollware', path: to('/') },
          { name: m.value.docs.label, path: to('/docs/') },
        ]),
      ]),
    },
  ],
})
</script>

<template>
  <UContainer>
    <div class="grid gap-10 py-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside class="hidden lg:block">
        <div class="sticky top-[calc(var(--ui-header-height)+2.5rem)]">
          <DocsSidebar :pages="pages" />
        </div>
      </aside>
      <article class="min-w-0">
        <h1 class="text-4xl font-semibold tracking-tight text-highlighted text-balance">
          {{ m.docs.title }}
        </h1>
        <p class="mt-3 max-w-2xl text-lg text-muted text-pretty">{{ m.docs.description }}</p>
        <USeparator class="my-8" />
        <section v-for="group in groups" :id="group.section" :key="group.section" class="py-6">
          <h2 class="text-xl font-semibold text-highlighted">{{ group.label }}</h2>
          <ul class="mt-4 grid gap-4 sm:grid-cols-2">
            <li v-for="item in group.items" :key="item.to">
              <NuxtLink
                :to="item.to"
                class="flex h-full flex-col gap-2 rounded-lg border border-default p-4 hover:border-accented"
              >
                <span class="font-medium text-highlighted">{{ item.title }}</span>
                <span class="text-sm text-muted">{{ item.description }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </article>
    </div>
  </UContainer>
</template>
