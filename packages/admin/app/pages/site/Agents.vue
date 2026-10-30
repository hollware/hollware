<script setup lang="ts">
import Page from '../../components/Page.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import StructureDialogs from '../../components/StructureDialogs.vue'
import { ApiError } from '../../lib/api.ts'
import { formatDateTime, useMessages } from '../../i18n/index.ts'
import {
  AGENT_EVENTS,
  AGENT_SCOPES,
  agentForm,
  agentFormProblems,
  agentOf,
  canSendAgain,
  deliveryState,
  emptyAgentForm,
  isAgentName,
  needsSecret,
  withAgent,
  withoutAgent,
  type AgentDeliveryRow,
  type AgentForm,
  type AgentMember,
  type AgentSubscription,
} from '../../lib/agents.ts'
import { api } from '../../lib/session.ts'
import { useSiteSettings } from '../../lib/site-settings.ts'

const toast = useToast()
const m = useMessages()

const members = ref<AgentMember[]>([])
const deliveries = ref<AgentDeliveryRow[]>([])
const failure = ref<string | null>(null)
const memberName = ref('')
const making = ref(false)
const removing = ref<AgentMember | null>(null)
const sending = ref<string | null>(null)
const madeSecret = ref<{ webhook: string; secret: string } | null>(null)
const form = ref<AgentForm | null>(null)
const editing = ref<string | null>(null)
const tried = ref(false)
const requireAgents = ref(false)

const { structure, change, load, save } = useSiteSettings((read) => {
  requireAgents.value = read.definition.review.requireAgents
})

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function loadMembers() {
  try {
    members.value = (await api.admin<{ agents: AgentMember[] }>('agents')).agents
    failure.value = null
  } catch (error) {
    failure.value = describe(error)
  }
}

async function loadDeliveries() {
  try {
    deliveries.value = (
      await api.admin<{ deliveries: AgentDeliveryRow[] }>('agents/deliveries')
    ).deliveries
  } catch (error) {
    failure.value = describe(error)
  }
}

onMounted(() => Promise.all([loadMembers(), loadDeliveries()]))

const subscriptions = computed<readonly AgentSubscription[]>(
  () => structure.value?.definition.agents ?? [],
)
const memberIds = computed(() => members.value.map((member) => member.id))
const memberItems = computed(() =>
  members.value.map((member) => ({ label: member.name, value: member.id })),
)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (value: boolean) => {
    if (!value) removing.value = null
  },
})
const problems = computed(() =>
  form.value === null
    ? []
    : agentFormProblems(
        form.value,
        subscriptions.value.map((agent) => agent.name).filter((name) => name !== editing.value),
        memberIds.value,
      ),
)
const shownProblems = computed(() => (tried.value ? problems.value : []))

function problemOf(...keys: (typeof problems.value)[number][]): string | undefined {
  const found = shownProblems.value.find((problem) => keys.includes(problem))
  return found === undefined ? undefined : m.value.agents.problems[found]
}

function memberLabel(id: string): string {
  return members.value.find((member) => member.id === id)?.name ?? m.value.agents.unknownMember(id)
}

async function makeMember() {
  making.value = true
  try {
    const made = await api.admin<{ id: string; name: string }>('agents', {
      name: memberName.value,
    })
    memberName.value = ''
    toast.add({ title: m.value.agents.memberMade(made.name), color: 'success' })
    await loadMembers()
  } catch (error) {
    toast.add({ title: m.value.agents.notMade, description: describe(error), color: 'error' })
  } finally {
    making.value = false
  }
}

async function removeMember() {
  const member = removing.value
  removing.value = null
  if (member === null) return
  try {
    await api.adminDelete(`agents/${member.id}`)
    toast.add({ title: m.value.agents.removed(member.name), color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.agents.notRemoved, description: describe(error), color: 'error' })
  }
  await loadMembers()
}

function startNew() {
  form.value = emptyAgentForm(members.value[0]?.id ?? '')
  editing.value = null
  tried.value = false
}

function startEdit(agent: AgentSubscription) {
  form.value = agentForm(agent)
  editing.value = agent.name
  tried.value = false
}

function stopEditing() {
  form.value = null
  editing.value = null
  tried.value = false
}

function update(patch: Partial<AgentForm>) {
  if (form.value !== null) form.value = { ...form.value, ...patch }
}

function toggleIn<Item>(list: readonly Item[], item: Item, on: boolean): Item[] {
  return on ? [...list.filter((other) => other !== item), item] : list.filter((o) => o !== item)
}

async function saveAgents(next: AgentSubscription[]) {
  await save((definition) => ({ ...definition, agents: next }))
}

async function saveForm() {
  tried.value = true
  if (form.value === null || problems.value.length > 0) return
  const agent = agentOf(form.value)
  const isNew = editing.value === null
  await saveAgents(withAgent(subscriptions.value, agent, editing.value))
  const settled =
    change.problems.value.length === 0 &&
    change.failure.value === null &&
    !change.conflict.value &&
    change.impact.value === null
  if (!settled) return
  stopEditing()
  if (isNew && needsSecret(agent)) await makeSecret(agent.name)
}

async function saveRequireAgents(on: boolean) {
  requireAgents.value = on
  await save((definition) => ({ ...definition, review: { requireAgents: on } }))
}

async function makeSecret(webhook: string) {
  try {
    const answer = await api.call('make_webhook_secret', { webhook })
    if (answer.outcome === 'made' && answer.secret !== undefined) {
      madeSecret.value = { webhook, secret: answer.secret }
    } else {
      toast.add({
        title: m.value.site.noSecret,
        description:
          answer.outcome === 'unavailable' ? m.value.site.noSealSecret : m.value.site.ownSecret,
        color: 'warning',
      })
    }
  } catch (error) {
    toast.add({ title: m.value.site.noSecret, description: describe(error), color: 'error' })
  }
}

async function copySecret() {
  if (madeSecret.value !== null) await navigator.clipboard.writeText(madeSecret.value.secret)
}

async function sendAgain(event: string) {
  sending.value = event
  try {
    await api.admin(`events/${event}/retry`, {})
    toast.add({ title: m.value.site.sentAgain, color: 'success' })
    await loadDeliveries()
  } catch (error) {
    toast.add({ title: m.value.site.notSentAgain, description: describe(error), color: 'error' })
  } finally {
    sending.value = null
  }
}

function deliveryLine(delivery: AgentDeliveryRow): string {
  switch (deliveryState(delivery)) {
    case 'delivered':
      return m.value.agents.delivered(delivery.attempts)
    case 'retrying':
      return m.value.site.retrying(delivery.attempts)
    case 'abandoned':
      return m.value.site.gaveUp(delivery.attempts)
  }
}
</script>

<template>
  <Page :title="m.settings.sections.agents" :description="m.agents.note">
    <div v-if="structure !== null" class="max-w-2xl space-y-8">
      <StructureDialogs
        :impact="change.impact.value"
        :problems="change.problems.value"
        :conflict="change.conflict.value"
        :failure="change.failure.value"
        @confirm="change.confirmPending"
        @cancel="change.cancel"
        @reload="load"
      />
      <UAlert
        v-if="failure !== null"
        color="warning"
        :title="m.agents.notLoaded"
        :description="failure"
      />
      <UAlert
        v-if="madeSecret !== null"
        color="success"
        :title="m.site.secretShown(madeSecret.webhook)"
        :description="madeSecret.secret"
        :actions="[
          { label: m.common.copy, onClick: copySecret },
          { label: m.common.done, onClick: () => (madeSecret = null) },
        ]"
      />

      <section class="space-y-3" aria-labelledby="agent-members">
        <h2 id="agent-members" class="text-sm font-semibold text-highlighted">
          {{ m.agents.members }}
        </h2>
        <p class="text-sm text-muted">{{ m.agents.membersNote }}</p>
        <p v-if="members.length === 0" class="text-sm text-muted">{{ m.agents.noMembers }}</p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="member in members"
            :key="member.id"
            class="flex flex-wrap items-center gap-3 px-4 py-2.5"
          >
            <span class="font-mono">{{ member.name }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted">{{
              member.id
            }}</span>
            <span class="text-xs text-dimmed">{{ formatDateTime(member.since) }}</span>
            <UButton
              icon="i-lucide-user-minus"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="m.agents.removeMember(member.name)"
              @click="removing = member"
            />
          </li>
        </ul>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="makeMember">
          <UFormField :label="m.agents.memberName">
            <UInput
              v-model="memberName"
              class="w-56 font-mono"
              :placeholder="m.agents.memberPlaceholder"
            />
          </UFormField>
          <UButton
            type="submit"
            :label="m.agents.makeMember"
            :disabled="!isAgentName(memberName)"
            :loading="making"
          />
        </form>
      </section>

      <section class="space-y-3" aria-labelledby="agent-subscriptions">
        <h2 id="agent-subscriptions" class="text-sm font-semibold text-highlighted">
          {{ m.agents.subscriptions }}
        </h2>
        <p class="text-sm text-muted">{{ m.agents.subscriptionsNote }}</p>
        <USwitch
          :model-value="requireAgents"
          :label="m.agents.requireAgents"
          :description="m.agents.requireAgentsHelp"
          :disabled="change.busy.value"
          @update:model-value="saveRequireAgents"
        />
        <p v-if="subscriptions.length === 0" class="text-sm text-muted">
          {{ m.agents.noSubscriptions }}
        </p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="agent in subscriptions"
            :key="agent.name"
            class="flex flex-wrap items-center gap-3 px-4 py-2.5"
          >
            <div class="min-w-0 flex-1 space-y-0.5">
              <p class="flex flex-wrap items-center gap-2">
                <span class="font-mono">{{ agent.name }}</span>
                <span class="text-muted">· {{ memberLabel(agent.member) }}</span>
                <UBadge
                  v-if="agent.required"
                  :label="m.agents.requiredBadge"
                  variant="subtle"
                  size="sm"
                />
              </p>
              <p class="truncate text-xs text-muted">
                {{
                  agent.delivery.kind === 'webhook'
                    ? agent.delivery.url
                    : m.agents.viaBinding(agent.delivery.binding)
                }}
                <template v-if="agent.delivery.kind === 'webhook'">
                  ·
                  {{
                    agent.delivery.secret === undefined
                      ? m.site.signedByHollware
                      : m.site.signedBy(agent.delivery.secret)
                  }}
                </template>
              </p>
              <p class="text-xs text-dimmed">
                {{ agent.events.map((kind) => m.agents.eventLabels[kind]).join(' · ') }}
              </p>
            </div>
            <UButton
              v-if="needsSecret(agent)"
              :label="m.site.newSecret"
              size="xs"
              variant="outline"
              @click="makeSecret(agent.name)"
            />
            <UButton
              icon="i-lucide-pencil"
              variant="ghost"
              size="xs"
              :aria-label="m.agents.edit(agent.name)"
              @click="startEdit(agent)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="m.agents.remove(agent.name)"
              @click="saveAgents(withoutAgent(subscriptions, agent.name))"
            />
          </li>
        </ul>
        <UButton
          v-if="form === null"
          :label="m.agents.newSubscription"
          icon="i-lucide-plus"
          variant="outline"
          :disabled="members.length === 0"
          @click="startNew"
        />
        <form
          v-else
          class="space-y-4 rounded-lg border border-default p-4"
          novalidate
          @submit.prevent="saveForm"
        >
          <h3 class="text-sm font-semibold">
            {{ editing === null ? m.agents.newSubscription : m.agents.editing(editing) }}
          </h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="m.common.name" :error="problemOf('name', 'nameTaken')">
              <UInput
                :model-value="form.name"
                class="w-full font-mono"
                :placeholder="m.agents.namePlaceholder"
                @update:model-value="(name: string) => update({ name })"
              />
            </UFormField>
            <UFormField :label="m.agents.member" :error="problemOf('member')">
              <USelect
                :model-value="form.member"
                :items="memberItems"
                :placeholder="m.agents.pickMember"
                class="w-full"
                @update:model-value="(member: string) => update({ member })"
              />
            </UFormField>
          </div>
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">{{ m.agents.events }}</legend>
            <UCheckbox
              v-for="kind in AGENT_EVENTS"
              :key="kind"
              :label="m.agents.eventLabels[kind]"
              :model-value="form.events.includes(kind)"
              @update:model-value="
                (on: boolean | 'indeterminate') =>
                  update({ events: toggleIn(form?.events ?? [], kind, on === true) })
              "
            />
            <p v-if="problemOf('events') !== undefined" class="text-sm text-error">
              {{ problemOf('events') }}
            </p>
          </fieldset>
          <UFormField :label="m.agents.delivery">
            <URadioGroup
              :model-value="form.kind"
              orientation="horizontal"
              :items="[
                { label: m.agents.webhook, value: 'webhook' },
                { label: m.agents.binding, value: 'binding' },
              ]"
              @update:model-value="
                (kind) => update({ kind: kind === 'binding' ? 'binding' : 'webhook' })
              "
            />
          </UFormField>
          <div v-if="form.kind === 'webhook'" class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="m.agents.url" :error="problemOf('url')">
              <UInput
                :model-value="form.url"
                class="w-full"
                :placeholder="m.agents.urlPlaceholder"
                @update:model-value="(url: string) => update({ url })"
              />
            </UFormField>
            <UFormField
              :label="m.agents.secret"
              :help="m.agents.secretHelp"
              :error="problemOf('secret')"
            >
              <UInput
                :model-value="form.secret"
                class="w-full font-mono"
                @update:model-value="(secret: string) => update({ secret })"
              />
            </UFormField>
          </div>
          <UFormField
            v-else
            :label="m.agents.bindingName"
            :help="m.agents.bindingHelp"
            :error="problemOf('binding')"
          >
            <UInput
              :model-value="form.binding"
              class="w-56 font-mono"
              @update:model-value="(binding: string) => update({ binding })"
            />
          </UFormField>
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">{{ m.agents.scopes }}</legend>
            <UCheckbox
              v-for="scope in AGENT_SCOPES"
              :key="scope"
              :label="m.agents.scopeLabels[scope]"
              :model-value="form.scopes.includes(scope)"
              @update:model-value="
                (on: boolean | 'indeterminate') =>
                  update({ scopes: toggleIn(form?.scopes ?? [], scope, on === true) })
              "
            />
            <p v-if="problemOf('scopes') !== undefined" class="text-sm text-error">
              {{ problemOf('scopes') }}
            </p>
          </fieldset>
          <USwitch
            :model-value="form.required"
            :label="m.agents.required"
            :description="m.agents.requiredHelp"
            @update:model-value="(required: boolean) => update({ required })"
          />
          <div class="flex gap-2">
            <UButton type="submit" :label="m.agents.save" :loading="change.busy.value" />
            <UButton :label="m.common.cancel" variant="ghost" @click="stopEditing" />
          </div>
        </form>
      </section>

      <section class="space-y-2" aria-labelledby="agent-deliveries">
        <h2 id="agent-deliveries" class="text-sm font-semibold text-highlighted">
          {{ m.agents.deliveries }}
        </h2>
        <p class="text-sm text-muted">{{ m.agents.deliveriesNote }}</p>
        <p v-if="deliveries.length === 0" class="text-sm text-muted">
          {{ m.agents.noDeliveries }}
        </p>
        <ul v-else class="divide-y divide-default rounded-lg border border-default text-sm">
          <li
            v-for="delivery in deliveries"
            :key="`${delivery.event}:${delivery.agent}`"
            class="flex flex-wrap items-start gap-3 px-4 py-2.5"
          >
            <div class="min-w-0 flex-1 space-y-0.5">
              <p class="break-words">
                <span class="font-mono">{{ delivery.agent }}</span>
                <span class="text-muted"> · {{ delivery.kind }}</span>
              </p>
              <p v-if="delivery.lastError !== null" class="text-xs break-words text-muted">
                {{ delivery.lastError }}
              </p>
              <p class="text-xs text-dimmed">
                {{ deliveryLine(delivery) }}
                · {{ formatDateTime(delivery.deliveredAt ?? delivery.triedAt) }}
              </p>
            </div>
            <UButton
              v-if="canSendAgain(delivery)"
              :label="m.site.sendAgain"
              size="xs"
              variant="outline"
              :loading="sending === delivery.event"
              @click="sendAgain(delivery.event)"
            />
          </li>
        </ul>
      </section>

      <UModal v-model:open="removeOpen" :title="m.agents.removeTitle(removing?.name ?? '')">
        <template #body>
          <p>{{ m.agents.removeBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.agents.keepIt" variant="ghost" @click="removing = null" />
          <UButton :label="m.common.remove" color="error" @click="removeMember" />
        </template>
      </UModal>
    </div>
    <p v-else class="text-muted">{{ m.common.loading }}</p>
  </Page>
</template>
