<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import Page from '../components/Page.vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VerdictList from '../components/VerdictList.vue'
import { ApiError, type Output } from '../lib/api.ts'
import { useMessages } from '../i18n/index.ts'
import { operation } from '../lib/queries.ts'
import { api } from '../lib/session.ts'
import { newEntryMarkdown } from '../lib/template.ts'

const m = useMessages()
const router = useRouter()
const route = useRoute()

function queried(name: string): string | undefined {
  const value = route.query[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}
const group = queried('group')
const siteQuery = useQuery(operation('describe_site', {}))
const site = computed(() => siteQuery.data.value?.site ?? null)
const collection = ref('')
const locale = ref('')
const slug = ref('')
const title = ref('')
const refusal = ref<Output<'create_draft'>['verdict'] | null>(null)
const failure = ref<string | null>(null)
const saving = ref(false)

watch(
  site,
  (described) => {
    if (described === null || collection.value !== '') return
    const asked = queried('collection')
    collection.value = described.collections.some((c) => c.name === asked)
      ? (asked ?? '')
      : (described.collections[0]?.name ?? '')
    const askedLocale = queried('locale')
    locale.value =
      askedLocale !== undefined && described.locales.includes(askedLocale)
        ? askedLocale
        : described.defaultLocale
  },
  { immediate: true },
)

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
    if (created.outcome === 'in_trash') {
      failure.value = m.value.newEntry.inTrash
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
  <Page :title="group === undefined ? m.newEntry.title : m.newEntry.translation">
    <form v-if="site !== null" class="max-w-lg space-y-4" @submit.prevent="create">
      <p v-if="group !== undefined" class="text-sm text-muted">
        {{ m.newEntry.joins }}<span class="font-mono">{{ group }}</span
        >.
      </p>
      <UFormField :label="m.newEntry.collection">
        <USelect v-model="collection" :items="site.collections.map((c) => c.name)" class="w-full" />
      </UFormField>
      <UFormField :label="m.newEntry.locale">
        <USelect v-model="locale" :items="site.locales" class="w-full" />
      </UFormField>
      <UFormField :label="m.newEntry.entryTitle">
        <UInput v-model="title" class="w-full" required />
      </UFormField>
      <UFormField
        :label="m.newEntry.slug"
        :help="m.newEntry.slugHelp"
        :error="slug !== '' && !validSlug ? m.newEntry.notSlug : undefined"
      >
        <UInput v-model="slug" class="w-full" required />
      </UFormField>
      <UButton type="submit" :label="m.newEntry.create" :loading="saving" :disabled="!validSlug" />
      <UAlert
        v-if="failure !== null"
        color="error"
        :title="m.newEntry.notCreated"
        :description="failure"
      />
      <VerdictList :verdict="refusal" />
    </form>
  </Page>
</template>
