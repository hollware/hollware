<script setup lang="ts">
import Page from '../components/Page.vue'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { api } from '../lib/session.ts'
import { newEntryMarkdown } from '../lib/template.ts'

const router = useRouter()
const route = useRoute()

/** What the link that opened the page set: a collection, a locale, the group a translation joins. */
function queried(name: string): string | undefined {
  const value = route.query[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}
const group = queried('group')
const site = ref<Output<'describe_site'>['site'] | null>(null)
const collection = ref('')
const locale = ref('')
const slug = ref('')
const title = ref('')
const refusal = ref<Output<'create_draft'>['verdict'] | null>(null)
const failure = ref<string | null>(null)
const saving = ref(false)

onMounted(async () => {
  site.value = (await api.call('describe_site', {})).site
  const asked = queried('collection')
  collection.value = site.value.collections.some((c) => c.name === asked)
    ? (asked ?? '')
    : (site.value.collections[0]?.name ?? '')
  const askedLocale = queried('locale')
  locale.value =
    askedLocale !== undefined && site.value.locales.includes(askedLocale)
      ? askedLocale
      : site.value.defaultLocale
})

const validSlug = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value))

async function create() {
  saving.value = true
  refusal.value = null
  failure.value = null
  try {
    const definition = site.value?.collections.find((c) => c.name === collection.value)
    const markdown = newEntryMarkdown(definition?.schema ?? {}, {
      title: title.value,
      slug: slug.value,
      today: new Date().toISOString().slice(0, 10),
      translationGroupField: definition?.translationGroupField ?? null,
      ...(group === undefined ? {} : { translationGroup: group }),
    })
    const created = await api.call('create_draft', {
      collection: collection.value,
      locale: locale.value,
      slug: slug.value,
      markdown,
    })
    if (created.outcome === 'saved') {
      await router.push(`/entries/${collection.value}/${locale.value}/${slug.value}`)
      return
    }
    refusal.value = created.verdict ?? null
  } catch (error) {
    failure.value = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Page :title="group === undefined ? 'New entry' : 'New translation'">
    <form v-if="site !== null" class="max-w-lg space-y-4" @submit.prevent="create">
      <p v-if="group !== undefined" class="text-sm text-muted">
        It joins the translations of <span class="font-mono">{{ group }}</span
        >.
      </p>
      <UFormField label="Collection">
        <USelect v-model="collection" :items="site.collections.map((c) => c.name)" class="w-full" />
      </UFormField>
      <UFormField label="Locale">
        <USelect v-model="locale" :items="site.locales" class="w-full" />
      </UFormField>
      <UFormField label="Title">
        <UInput v-model="title" class="w-full" required />
      </UFormField>
      <UFormField
        label="Slug"
        help="Lowercase letters and digits joined by hyphens, such as edge-caching-guide."
        :error="slug !== '' && !validSlug ? 'Not a slug.' : undefined"
      >
        <UInput v-model="slug" class="w-full" required />
      </UFormField>
      <UButton type="submit" label="Create the draft" :loading="saving" :disabled="!validSlug" />
      <UAlert v-if="failure !== null" color="error" title="Not created" :description="failure" />
      <VerdictList :verdict="refusal" />
    </form>
  </Page>
</template>
