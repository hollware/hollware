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
import { api } from '../lib/session.ts'
import { useStructureChange } from '../lib/structure.ts'

const props = defineProps<{ name: string }>()

type Structure = Output<'get_structure'>
type Collection = Structure['definition']['collections'][string]

const toast = useToast()
const router = useRouter()
const structure = ref<Structure | null>(null)
const missing = ref(false)
const builder = ref<BuilderSchema | null>(null)
const collection = ref<Collection | null>(null)
const components = ref('')
const removeOpen = ref(false)

const KINDS: { label: string; value: BuilderKind }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Date', value: 'date' },
  { label: 'Date and time', value: 'datetime' },
  { label: 'Choice', value: 'choice' },
  { label: 'List of texts', value: 'list' },
  { label: 'Number', value: 'number' },
  { label: 'Whole number', value: 'integer' },
  { label: 'Yes or no', value: 'switch' },
  { label: 'Other (JSON Schema)', value: 'other' },
]
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
const NONE = '(none)'
const optionalFields = computed(() => [NONE, ...fieldKeys.value])
const formProblems = computed(() => [
  ...problemsOf(builder.value?.fields ?? []),
  ...(componentsValue() === undefined ? ['The components are not a JSON object.'] : []),
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
    title: answer.outcome === 'updated' ? 'Saved: it applies at once' : 'Nothing changed',
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
  <Page
    :title="name"
    description="A change applies at once to every new save and publish; nothing is deployed."
  >
    <template v-if="collection !== null" #actions>
      <UButton
        label="Remove"
        color="error"
        variant="outline"
        :loading="change.busy.value"
        @click="removeOpen = true"
      />
      <UButton
        label="Save"
        :loading="change.busy.value"
        :disabled="formProblems.length > 0"
        @click="save"
      />
    </template>
    <p v-if="missing" class="text-muted">There is no collection "{{ name }}".</p>
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
      <UAlert v-if="formProblems.length > 0" color="warning" title="Fix these to save">
        <template #description>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="problem in formProblems" :key="problem">{{ problem }}</li>
          </ul>
        </template>
      </UAlert>

      <section aria-labelledby="fields" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 id="fields" class="font-semibold">Fields of the frontmatter</h2>
          <UButton
            label="Add a field"
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
              <UFormField label="Name">
                <UInput v-model="field.key" class="w-full font-mono" />
              </UFormField>
              <UFormField label="Description">
                <UInput v-model="field.description" class="w-full" />
              </UFormField>
              <template v-if="BOUNDED.includes(field.kind)">
                <UFormField
                  :label="
                    field.kind === 'text'
                      ? 'Fewest characters'
                      : field.kind === 'list'
                        ? 'Fewest items'
                        : 'Least'
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
                      ? 'Most characters'
                      : field.kind === 'list'
                        ? 'Most items'
                        : 'Most'
                  "
                >
                  <UInputNumber
                    :model-value="field.max ?? undefined"
                    class="w-full"
                    @update:model-value="field.max = $event ?? null"
                  />
                </UFormField>
              </template>
              <UFormField v-if="field.kind === 'choice'" label="Values" class="sm:col-span-2">
                <UInputTags v-model="field.options" class="w-full" />
              </UFormField>
            </div>
            <div class="space-y-3">
              <UFormField label="Kind">
                <USelect v-model="field.kind" :items="KINDS" class="w-full" />
              </UFormField>
              <USwitch v-model="field.required" label="Required" />
            </div>
            <div class="flex items-start gap-1">
              <UButton
                icon="i-lucide-arrow-up"
                variant="ghost"
                size="sm"
                :disabled="index === 0"
                :aria-label="`Move ${field.key} up`"
                @click="move(index, -1)"
              />
              <UButton
                icon="i-lucide-arrow-down"
                variant="ghost"
                size="sm"
                :disabled="index === builder.fields.length - 1"
                :aria-label="`Move ${field.key} down`"
                @click="move(index, 1)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="`Remove ${field.key}`"
                @click="builder.fields.splice(index, 1)"
              />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="routes" class="space-y-3">
        <h2 id="routes" class="font-semibold">Pages on the site</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField
            v-for="locale in structure.definition.locales"
            :key="locale"
            :label="`Path in ${locale}`"
            help="With :slug where the entry's slug goes."
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
            label="Translations share"
            help="The field that the translations of an entry share."
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
          <UFormField label="Tags" help="A list of texts.">
            <USelect
              :model-value="collection.tagsField ?? NONE"
              :items="optionalFields"
              class="w-full"
              @update:model-value="collection.tagsField = $event === NONE ? null : String($event)"
            />
          </UFormField>
          <UFormField label="Newest first by" help="A date; the first publication otherwise.">
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
          <h2 id="rules" class="font-semibold">Rules</h2>
          <UButton
            label="Add a rule"
            icon="i-lucide-plus"
            variant="outline"
            size="sm"
            @click="addRule"
          />
        </div>
        <p class="text-sm text-muted">
          Every write and publish is checked against them, besides the schema, the components and
          content safety. An error blocks publishing; a warning has to be acknowledged.
        </p>
        <p v-if="collection.rules.length === 0" class="text-sm text-muted">No rules.</p>
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
        <h2 id="guide" class="font-semibold">For whoever writes here</h2>
        <UFormField
          label="Style guide"
          help="Markdown. Agents read it with describe_site before they write."
        >
          <UTextarea
            :model-value="collection.styleGuide ?? ''"
            :rows="4"
            autoresize
            class="w-full"
            @update:model-value="collection.styleGuide = $event === '' ? null : String($event)"
          />
        </UFormField>
        <UFormField
          label="Components"
          help="The components the body may use, as JSON: { name: { props, description, example } }."
        >
          <UTextarea v-model="components" :rows="6" autoresize class="w-full font-mono text-xs" />
        </UFormField>
      </section>

      <UModal v-model:open="removeOpen" :title="`Remove the collection ${name}?`">
        <template #body>
          <p>
            Its entries are not deleted: they are out of reach until a collection of this name comes
            back.
          </p>
        </template>
        <template #footer>
          <UButton label="Keep it" variant="ghost" @click="removeOpen = false" />
          <UButton label="Remove" color="error" @click="remove" />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">Loading…</p>
  </Page>
</template>
