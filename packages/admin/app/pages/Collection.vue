<script setup lang="ts">
import Page from '../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RuleEditor from '../components/RuleEditor.vue'
import StructureDialogs from '../components/StructureDialogs.vue'
import { collectionDefinitionData } from '@hollware/core'
import type { Output } from '../lib/api.ts'
import { cleanParams } from '../lib/params.ts'
import {
  fieldsFromSchema,
  newField,
  problemsOf,
  schemaFromFields,
  type BuilderKind,
  type BuilderSchema,
} from '../lib/schema-builder.ts'
import { useMessages } from '../i18n/index.ts'
import { api } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'

const props = defineProps<{ name: string }>()

type Structure = Output<'get_structure'>
type Collection = Structure['definition']['collections'][string]

const toast = useToast()
const m = useMessages()
const router = useRouter()
const structure = ref<Structure | null>(null)
const missing = ref(false)
const builder = ref<BuilderSchema | null>(null)
const collection = ref<Collection | null>(null)
const components = ref('')
const removeOpen = ref(false)

const KIND_ORDER: readonly BuilderKind[] = [
  'text',
  'date',
  'datetime',
  'choice',
  'list',
  'number',
  'integer',
  'switch',
  'other',
]
const KINDS = computed(() =>
  KIND_ORDER.map((value) => ({ label: m.value.collection.kinds[value], value })),
)
/** The components of a collection, as the server checks them. */
const componentsData = collectionDefinitionData.shape.components

const BOUNDED: readonly BuilderKind[] = ['text', 'list', 'number', 'integer']

async function load() {
  const read = await api.call('get_structure', {})
  structure.value = read
  const found = read.definition.collections[props.name]
  missing.value = found === undefined
  if (found === undefined) return
  collection.value = structuredClone(found)
  builder.value = fieldsFromSchema(found.schema)
  components.value = JSON.stringify(found.components, null, 2)
}
watch(() => props.name, load, { immediate: true })

const fieldKeys = computed(() => (builder.value?.fields ?? []).map((field) => field.key))
/** A select of no field: Reka's selects take no empty value, so none has a name of its own. */
const NONE = computed(() => m.value.common.none)
const optionalFields = computed(() => [NONE.value, ...fieldKeys.value])
const formProblems = computed(() => [
  ...problemsOf(builder.value?.fields ?? [], m.value.collection.problems),
  ...(componentsValue() === undefined ? [m.value.collection.notJson] : []),
])

function componentsValue(): Collection['components'] | undefined {
  try {
    const value: unknown = JSON.parse(components.value || '{}')
    return componentsData.safeParse(value).data
  } catch {
    return undefined
  }
}

function addField() {
  const used = new Set(fieldKeys.value)
  let index = 1
  while (used.has(`field${index}`)) index += 1
  builder.value?.fields.push(newField(`field${index}`, 'text'))
}
function move(index: number, by: -1 | 1) {
  const fields = builder.value?.fields
  if (fields === undefined) return
  const [field] = fields.splice(index, 1)
  if (field !== undefined) fields.splice(index + by, 0, field)
}
function addRule() {
  collection.value?.rules.push({ rule: 'field-length', severity: 'warning', params: {} })
}

const change = useStructureChange(async (answer) => {
  toast.add({
    title:
      answer.outcome === 'updated' ? m.value.common.savedApplies : m.value.common.nothingChanged,
    color: 'success',
  })
  await load()
})

function edited(): Collection | null {
  if (collection.value === null || builder.value === null) return null
  const parsedComponents = componentsValue()
  if (parsedComponents === undefined) return null
  return {
    ...collection.value,
    schema: schemaFromFields(builder.value),
    components: parsedComponents,
    rules: collection.value.rules.map((rule) => ({ ...rule, params: cleanParams(rule.params) })),
  }
}

async function save() {
  const next = edited()
  const version = structure.value?.version
  if (next === null || version === undefined) return
  await change.run((confirm) =>
    api.call('set_collection', { version, name: props.name, collection: next, confirm }),
  )
}

async function remove() {
  removeOpen.value = false
  const version = structure.value?.version
  if (version === undefined) return
  await change.run(async (confirm) => {
    const answer = await api.call('set_collection', {
      version,
      name: props.name,
      collection: null,
      confirm,
    })
    if (answer.outcome === 'updated') await router.push('/collections')
    return answer
  })
}
</script>

<template>
  <Page :title="name" :description="m.collection.description">
    <template v-if="collection !== null" #actions>
      <UButton
        :label="m.common.remove"
        color="error"
        variant="outline"
        :loading="change.busy.value"
        @click="removeOpen = true"
      />
      <UButton
        :label="m.common.save"
        :loading="change.busy.value"
        :disabled="formProblems.length > 0"
        @click="save"
      />
    </template>
    <p v-if="missing" class="text-muted">{{ m.collection.missing(name) }}</p>
    <div
      v-else-if="collection !== null && builder !== null && structure !== null"
      class="space-y-8"
    >
      <StructureDialogs
        :impact="change.impact.value"
        :problems="change.problems.value"
        :conflict="change.conflict.value"
        :failure="change.failure.value"
        @confirm="change.confirmPending"
        @cancel="change.cancel"
        @reload="load"
      />
      <UAlert v-if="formProblems.length > 0" color="warning" :title="m.collection.fixToSave">
        <template #description>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="problem in formProblems" :key="problem">{{ problem }}</li>
          </ul>
        </template>
      </UAlert>

      <section aria-labelledby="fields" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 id="fields" class="font-semibold">{{ m.collection.fields }}</h2>
          <UButton
            :label="m.collection.addField"
            icon="i-lucide-plus"
            variant="outline"
            size="sm"
            @click="addField"
          />
        </div>
        <div class="divide-y divide-default rounded-lg border border-default">
          <div
            v-for="(field, index) in builder.fields"
            :key="index"
            class="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_10rem_auto]"
          >
            <div class="grid min-w-0 gap-3 sm:grid-cols-2">
              <UFormField :label="m.common.name">
                <UInput v-model="field.key" class="w-full font-mono" />
              </UFormField>
              <UFormField :label="m.collection.fieldDescription">
                <UInput v-model="field.description" class="w-full" />
              </UFormField>
              <template v-if="BOUNDED.includes(field.kind)">
                <UFormField
                  :label="
                    field.kind === 'text'
                      ? m.collection.fewestCharacters
                      : field.kind === 'list'
                        ? m.collection.fewestItems
                        : m.collection.least
                  "
                >
                  <UInputNumber
                    :model-value="field.min ?? undefined"
                    class="w-full"
                    @update:model-value="field.min = $event ?? null"
                  />
                </UFormField>
                <UFormField
                  :label="
                    field.kind === 'text'
                      ? m.collection.mostCharacters
                      : field.kind === 'list'
                        ? m.collection.mostItems
                        : m.collection.most
                  "
                >
                  <UInputNumber
                    :model-value="field.max ?? undefined"
                    class="w-full"
                    @update:model-value="field.max = $event ?? null"
                  />
                </UFormField>
              </template>
              <UFormField
                v-if="field.kind === 'choice'"
                :label="m.collection.values"
                class="sm:col-span-2"
              >
                <UInputTags v-model="field.options" class="w-full" />
              </UFormField>
            </div>
            <div class="space-y-3">
              <UFormField :label="m.collection.kind">
                <USelect v-model="field.kind" :items="KINDS" class="w-full" />
              </UFormField>
              <USwitch v-model="field.required" :label="m.collection.required" />
            </div>
            <div class="flex items-start gap-1">
              <UButton
                icon="i-lucide-arrow-up"
                variant="ghost"
                size="sm"
                :disabled="index === 0"
                :aria-label="m.collection.moveUp(field.key)"
                @click="move(index, -1)"
              />
              <UButton
                icon="i-lucide-arrow-down"
                variant="ghost"
                size="sm"
                :disabled="index === builder.fields.length - 1"
                :aria-label="m.collection.moveDown(field.key)"
                @click="move(index, 1)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="m.collection.removeField(field.key)"
                @click="builder.fields.splice(index, 1)"
              />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="routes" class="space-y-3">
        <h2 id="routes" class="font-semibold">{{ m.collection.pages }}</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField
            v-for="locale in structure.definition.locales"
            :key="locale"
            :label="m.collection.pathIn(locale)"
            :help="m.collection.pathHelp"
          >
            <UInput
              :model-value="collection.routes[locale] ?? ''"
              class="w-full font-mono"
              @update:model-value="
                collection.routes = { ...collection.routes, [locale]: String($event) }
              "
            />
          </UFormField>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <UFormField
            :label="m.collection.translationsShare"
            :help="m.collection.translationsShareHelp"
          >
            <USelect
              :model-value="collection.translationGroupField ?? NONE"
              :items="optionalFields"
              class="w-full"
              @update:model-value="
                collection.translationGroupField = $event === NONE ? null : String($event)
              "
            />
          </UFormField>
          <UFormField :label="m.collection.tags" :help="m.collection.tagsHelp">
            <USelect
              :model-value="collection.tagsField ?? NONE"
              :items="optionalFields"
              class="w-full"
              @update:model-value="collection.tagsField = $event === NONE ? null : String($event)"
            />
          </UFormField>
          <UFormField :label="m.collection.newestFirst" :help="m.collection.newestFirstHelp">
            <USelect
              :model-value="collection.sortByField ?? NONE"
              :items="optionalFields"
              class="w-full"
              @update:model-value="collection.sortByField = $event === NONE ? null : String($event)"
            />
          </UFormField>
        </div>
      </section>

      <section aria-labelledby="rules" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 id="rules" class="font-semibold">{{ m.collection.rules }}</h2>
          <UButton
            :label="m.collection.addRule"
            icon="i-lucide-plus"
            variant="outline"
            size="sm"
            @click="addRule"
          />
        </div>
        <p class="text-sm text-muted">
          {{ m.collection.rulesNote }}
        </p>
        <p v-if="collection.rules.length === 0" class="text-sm text-muted">
          {{ m.collection.noRules }}
        </p>
        <RuleEditor
          v-for="(rule, index) in collection.rules"
          :key="index"
          :rule="rule"
          :catalog="structure.catalog"
          :fields="fieldKeys"
          @remove="collection.rules.splice(index, 1)"
        />
      </section>

      <section aria-labelledby="guide" class="space-y-3">
        <h2 id="guide" class="font-semibold">{{ m.collection.forWriters }}</h2>
        <UFormField :label="m.collection.styleGuide" :help="m.collection.styleGuideHelp">
          <UTextarea
            :model-value="collection.styleGuide ?? ''"
            :rows="4"
            autoresize
            class="w-full"
            @update:model-value="collection.styleGuide = $event === '' ? null : String($event)"
          />
        </UFormField>
        <UFormField :label="m.collection.components" :help="m.collection.componentsHelp">
          <UTextarea v-model="components" :rows="6" autoresize class="w-full font-mono text-xs" />
        </UFormField>
      </section>

      <UModal v-model:open="removeOpen" :title="m.collection.removeTitle(name)">
        <template #body>
          <p>{{ m.collection.removeBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="removeOpen = false" />
          <UButton :label="m.common.remove" color="error" @click="remove" />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
