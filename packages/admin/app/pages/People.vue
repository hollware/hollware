<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { sortable } from '../lib/columns.ts'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { useToast } from '@nuxt/ui/composables'
import { computed, onMounted, ref } from 'vue'
import { ApiError } from '../lib/api.ts'
import { api } from '../lib/session.ts'

type Member = { id: string; name: string | null; role: string; since: string }
type Invitation = { id: string; role: string; expiresAt: string }
interface People {
  people: Member[]
  invitations: Invitation[]
}

const m = useMessages()
const memberColumns = computed<TableColumn<Member>[]>(() => [
  { accessorKey: 'name', header: sortable(m.value.people.columns.name) },
  { accessorKey: 'role', header: sortable(m.value.people.columns.role) },
  { accessorKey: 'since', header: sortable(m.value.people.columns.since) },
  { id: 'actions', header: '' },
])
const invitationColumns = computed<TableColumn<Invitation>[]>(() => [
  { accessorKey: 'role', header: sortable(m.value.people.columns.role) },
  { accessorKey: 'expiresAt', header: sortable(m.value.people.columns.validUntil) },
])
/** The roles to pick, each with its name in the admin's language. */
const roleItems = (roles: readonly string[]) =>
  roles.map((value) => ({ label: m.value.roles[value] ?? value, value }))

const toast = useToast()
const data = ref<People | null>(null)
const failure = ref<string | null>(null)
const role = ref<'editor' | 'author'>('author')
/** The link of the invitation just made: it holds the secret, so it is shown once. */
const link = ref<string | null>(null)
const busy = ref(false)

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

async function load() {
  try {
    data.value = await api.admin<People>('people')
    failure.value = null
  } catch (error) {
    failure.value = describe(error)
  }
}

onMounted(load)

async function invite() {
  busy.value = true
  try {
    link.value = (await api.admin<{ link: string }>('invitations', { role: role.value })).link
    await load()
  } catch (error) {
    toast.add({ title: m.value.people.notInvited, description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

/** The member about to be removed, while the person confirms. */
const removing = ref<People['people'][number] | null>(null)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (value) => {
    if (!value) removing.value = null
  },
})

async function setRole(userId: string, next: unknown) {
  try {
    await api.admin('people/role', { userId, role: String(next) })
    toast.add({ title: m.value.people.roleChanged, color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.people.notChanged, description: describe(error), color: 'error' })
  }
  await load()
}

async function remove() {
  const person = removing.value
  removing.value = null
  if (person === null) return
  try {
    await api.admin('people/remove', { userId: person.id })
    toast.add({ title: m.value.people.out(person.name ?? person.id), color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.people.notRemoved, description: describe(error), color: 'error' })
  }
  await load()
}

async function copy() {
  if (link.value !== null) await navigator.clipboard.writeText(link.value)
}
</script>

<template>
  <Page :title="m.people.title">
    <div class="space-y-6">
      <UAlert
        v-if="failure !== null"
        color="warning"
        :title="m.people.ownerOnly"
        :description="failure"
      />
      <template v-else-if="data !== null">
        <form class="flex items-end gap-3" @submit.prevent="invite">
          <UFormField :label="m.people.role" :help="m.people.roleHelp">
            <USelect v-model="role" :items="roleItems(['author', 'editor'])" class="w-40" />
          </UFormField>
          <UButton type="submit" :label="m.people.invite" :loading="busy" />
        </form>
        <UAlert
          v-if="link !== null"
          color="success"
          :title="m.people.linkShown"
          :description="link"
          :actions="[
            { label: m.common.copy, onClick: copy },
            { label: m.common.done, onClick: () => (link = null) },
          ]"
        />
        <section :aria-label="m.people.members" class="space-y-2">
          <h2 class="font-medium">{{ m.people.members }}</h2>
          <DataTable
            :data="data.people"
            :columns="memberColumns"
            :filter-label="m.people.filter"
            :empty="m.people.empty"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name ?? row.original.id }}</span>
            </template>
            <template #role-cell="{ row }">
              <USelect
                :model-value="row.original.role"
                :items="roleItems(['owner', 'editor', 'author'])"
                :aria-label="m.people.roleOf(row.original.name ?? row.original.id)"
                size="sm"
                class="w-32"
                @update:model-value="setRole(row.original.id, $event)"
              />
            </template>
            <template #since-cell="{ row }">{{ formatDateTime(row.original.since) }}</template>
            <template #actions-cell="{ row }">
              <div class="text-right">
                <UButton
                  icon="i-lucide-user-minus"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :aria-label="m.people.remove(row.original.name ?? row.original.id)"
                  @click="removing = row.original"
                />
              </div>
            </template>
          </DataTable>
        </section>
        <section
          v-if="data.invitations.length > 0"
          :aria-label="m.people.invitations"
          class="space-y-2"
        >
          <h2 class="font-medium">{{ m.people.waiting }}</h2>
          <DataTable
            :data="data.invitations"
            :columns="invitationColumns"
            :filter-label="m.people.filterRole"
          >
            <template #expiresAt-cell="{ row }">{{
              formatDateTime(row.original.expiresAt)
            }}</template>
          </DataTable>
        </section>
      </template>
      <UModal
        v-model:open="removeOpen"
        :title="m.people.removeTitle(removing?.name ?? removing?.id ?? '')"
      >
        <template #body>
          <p>{{ m.people.removeBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.people.keepThem" variant="ghost" @click="removing = null" />
          <UButton :label="m.common.remove" color="error" @click="remove" />
        </template>
      </UModal>
    </div>
  </Page>
</template>
