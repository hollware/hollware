<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useToast } from '@nuxt/ui/composables'
import { useQuery } from '@pinia/colada'
import { computed, ref, watch } from 'vue'
import DataTable from '../components/DataTable.vue'
import Page from '../components/Page.vue'
import { formatDateTime, useMessages } from '../i18n/index.ts'
import { ApiError } from '../lib/api.ts'
import { sortable } from '../lib/columns.ts'
import { me } from '../lib/me.ts'
import { canRemoveLast, enrollPasskey } from '../lib/passkeys.ts'
import { admin } from '../lib/queries.ts'
import { api, auth } from '../lib/session.ts'

type Passkey = { id: string; label: string; createdAt: string; lastUsedAt: string | null }
type App = {
  id: string
  grantId: string
  name: string
  scopes: string[]
  site: string | null
  createdAt: string
  admin: boolean
}
type Identity = {
  id: string
  provider: string
  name: string
  email: string | null
  createdAt: string
}
interface Account {
  passkeys: Passkey[]
  apps: Omit<App, 'id'>[]
  identities: Identity[]
  passkeysEnabled: boolean
}

const m = useMessages()
const toast = useToast()
const accountQuery = useQuery(admin<Account>('account'))
const data = computed(() => accountQuery.data.value ?? null)
const failure = computed(() =>
  accountQuery.error.value === null ? null : describe(accountQuery.error.value),
)

const passkeyColumns = computed<TableColumn<Passkey>[]>(() => [
  { accessorKey: 'label', header: sortable(m.value.account.columns.label) },
  { accessorKey: 'createdAt', header: sortable(m.value.account.columns.created) },
  { accessorKey: 'lastUsedAt', header: sortable(m.value.account.columns.lastUsed) },
  { id: 'actions', header: '' },
])
const identityColumns = computed<TableColumn<Identity>[]>(() => [
  { accessorKey: 'name', header: sortable(m.value.account.columns.provider) },
  { accessorKey: 'email', header: sortable(m.value.account.columns.email) },
  { accessorKey: 'createdAt', header: sortable(m.value.account.columns.since) },
])
const appColumns = computed<TableColumn<App>[]>(() => [
  { accessorKey: 'name', header: sortable(m.value.account.columns.app) },
  { accessorKey: 'scopes', header: m.value.account.columns.scopes },
  { accessorKey: 'site', header: sortable(m.value.account.columns.site) },
  { accessorKey: 'createdAt', header: sortable(m.value.account.columns.since) },
  { id: 'actions', header: '' },
])

const apps = computed<App[]>(() => {
  const all = data.value?.apps ?? []
  const admin = all.find((app) => app.admin)
  return [
    ...(admin === undefined ? [] : [{ ...admin, id: 'admin' }]),
    ...all.filter((app) => !app.admin).map((app) => ({ ...app, id: app.grantId })),
  ]
})
const lastPasskey = computed(
  () => !canRemoveLast(data.value?.passkeys.length ?? 0, data.value?.identities.length ?? 0),
)

const adding = ref(false)
const addLabel = ref('')
const addOpen = ref(false)

async function addPasskey() {
  adding.value = true
  try {
    await enrollPasskey(
      {
        admin: (path, body) => api.admin(path, body),
        create: async (options) => {
          const credential = await navigator.credentials.create({
            publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
              JSON.parse(JSON.stringify(options)),
            ),
          })
          return credential instanceof PublicKeyCredential ? credential.toJSON() : null
        },
      },
      addLabel.value,
    )
    addOpen.value = false
    toast.add({ title: m.value.account.passkeyAdded, color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.account.notAdded, description: describe(error), color: 'error' })
  } finally {
    adding.value = false
  }
}

function describe(error: unknown): string {
  return error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
}

const name = ref('')
const savingName = ref(false)
watch(
  () => me.value?.user?.name,
  (known) => {
    if (name.value === '' && typeof known === 'string') name.value = known
  },
  { immediate: true },
)

async function saveName() {
  if (name.value.trim() === '') return
  savingName.value = true
  try {
    const answer = await api.admin<{ name: string }>('account/name', { name: name.value })
    name.value = answer.name
    toast.add({ title: m.value.account.nameSaved, color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.account.notSaved, description: describe(error), color: 'error' })
  } finally {
    savingName.value = false
  }
}

const renaming = ref<Passkey | null>(null)
const newLabel = ref('')

function startRename(passkey: Passkey) {
  renaming.value = passkey
  newLabel.value = passkey.label
}

async function renamePasskey() {
  const passkey = renaming.value
  if (passkey === null || newLabel.value.trim() === '') return
  try {
    const answer = await api.admin<{ label: string }>('account/passkeys/rename', {
      id: passkey.id,
      label: newLabel.value,
    })
    renaming.value = null
    toast.add({ title: m.value.account.passkeyRenamed(answer.label), color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.account.notSaved, description: describe(error), color: 'error' })
  }
}

const removing = ref<Passkey | null>(null)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (value: boolean) => {
    if (!value) removing.value = null
  },
})

async function removePasskey() {
  const passkey = removing.value
  removing.value = null
  if (passkey === null) return
  try {
    await api.admin('account/passkeys/remove', { id: passkey.id })
    toast.add({ title: m.value.account.passkeyRemoved(passkey.label), color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.account.notRemoved, description: describe(error), color: 'error' })
  }
}

const revoking = ref<App | null>(null)
const revokeOpen = computed({
  get: () => revoking.value !== null,
  set: (value: boolean) => {
    if (!value) revoking.value = null
  },
})

async function revokeApp() {
  const app = revoking.value
  revoking.value = null
  if (app === null) return
  try {
    await api.admin('account/apps/revoke', { grantId: app.grantId })
    toast.add({ title: m.value.account.revoked(app.name), color: 'success' })
  } catch (error) {
    toast.add({ title: m.value.account.notRevoked, description: describe(error), color: 'error' })
  }
}

const endOpen = ref(false)
const ending = ref(false)

async function endAll() {
  ending.value = true
  try {
    await api.admin('account/sessions/end', {})
    endOpen.value = false
    await auth.signOut()
  } catch (error) {
    toast.add({ title: m.value.account.notEnded, description: describe(error), color: 'error' })
  } finally {
    ending.value = false
  }
}
</script>

<template>
  <Page :title="m.account.title">
    <div class="space-y-8">
      <UAlert
        v-if="failure !== null"
        color="warning"
        :title="m.account.failed"
        :description="failure"
      />
      <template v-else-if="data !== null">
        <form
          :aria-label="m.account.profile"
          class="max-w-xl space-y-2"
          novalidate
          @submit.prevent="saveName"
        >
          <h2 class="font-medium">{{ m.account.profile }}</h2>
          <UFormField :label="m.account.profile" :help="m.account.profileHelp">
            <UInput v-model="name" maxlength="100" class="w-full" />
          </UFormField>
          <UButton
            type="submit"
            :label="m.account.saveName"
            :loading="savingName"
            :disabled="name.trim() === ''"
          />
        </form>

        <section :aria-label="m.account.passkeys" class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-medium">{{ m.account.passkeys }}</h2>
            <UButton
              v-if="data.passkeysEnabled"
              :label="m.account.addPasskey"
              icon="i-lucide-key-round"
              variant="outline"
              size="sm"
              @click="addOpen = true"
            />
          </div>
          <p class="text-sm text-muted">{{ m.account.passkeysHelp }}</p>
          <DataTable :data="data.passkeys" :columns="passkeyColumns" :empty="m.account.noPasskeys">
            <template #label-cell="{ row }">
              <span class="font-medium">{{ row.original.label }}</span>
            </template>
            <template #createdAt-cell="{ row }">{{
              formatDateTime(row.original.createdAt)
            }}</template>
            <template #lastUsedAt-cell="{ row }">{{
              row.original.lastUsedAt === null
                ? m.account.never
                : formatDateTime(row.original.lastUsedAt)
            }}</template>
            <template #actions-cell="{ row }">
              <div class="flex items-center justify-end gap-2">
                <span v-if="lastPasskey" class="text-xs text-muted">{{
                  m.account.lastPasskey
                }}</span>
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  size="sm"
                  :aria-label="m.account.renamePasskey(row.original.label)"
                  @click="startRename(row.original)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  :disabled="lastPasskey"
                  :aria-label="m.account.removePasskey(row.original.label)"
                  @click="removing = row.original"
                />
              </div>
            </template>
          </DataTable>
        </section>

        <section :aria-label="m.account.identities" class="space-y-2">
          <h2 class="font-medium">{{ m.account.identities }}</h2>
          <p class="text-sm text-muted">{{ m.account.identitiesHelp }}</p>
          <DataTable
            :data="data.identities"
            :columns="identityColumns"
            :empty="m.account.noIdentities"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}</span>
            </template>
            <template #email-cell="{ row }">{{ row.original.email ?? '' }}</template>
            <template #createdAt-cell="{ row }">{{
              formatDateTime(row.original.createdAt)
            }}</template>
          </DataTable>
        </section>

        <section :aria-label="m.account.apps" class="space-y-2">
          <h2 class="font-medium">{{ m.account.apps }}</h2>
          <p class="text-sm text-muted">{{ m.account.appsHelp }}</p>
          <DataTable
            :data="apps"
            :columns="appColumns"
            :filter-label="m.account.filterApps"
            :empty="m.account.noApps"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name }}</span>
              <UBadge
                v-if="row.original.admin"
                :label="m.account.thisAdmin"
                color="neutral"
                variant="subtle"
                class="ms-2"
              />
            </template>
            <template #scopes-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.scopes.join(' ') }}</span>
            </template>
            <template #site-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.site ?? '' }}</span>
            </template>
            <template #createdAt-cell="{ row }">{{
              formatDateTime(row.original.createdAt)
            }}</template>
            <template #actions-cell="{ row }">
              <div class="text-right">
                <span v-if="row.original.admin" class="text-xs text-muted">{{
                  m.account.thisAdminNote
                }}</span>
                <UButton
                  v-else
                  :label="m.tokens.revoke"
                  :aria-label="m.account.revoke(row.original.name)"
                  color="error"
                  variant="ghost"
                  size="sm"
                  @click="revoking = row.original"
                />
              </div>
            </template>
          </DataTable>
        </section>

        <section :aria-label="m.account.sessions" class="space-y-2">
          <h2 class="font-medium">{{ m.account.sessions }}</h2>
          <p class="text-sm text-muted">{{ m.account.sessionsHelp }}</p>
          <UButton
            :label="m.account.endAll"
            icon="i-lucide-log-out"
            color="error"
            variant="outline"
            @click="endOpen = true"
          />
        </section>
      </template>

      <UModal
        v-model:open="removeOpen"
        :title="m.account.removePasskeyTitle(removing?.label ?? '')"
      >
        <template #body>
          <p class="text-sm">{{ m.account.removePasskeyBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.keepIt" variant="ghost" @click="removing = null" />
          <UButton :label="m.common.remove" color="error" @click="removePasskey" />
        </template>
      </UModal>
      <UModal v-model:open="revokeOpen" :title="m.account.revokeTitle(revoking?.name ?? '')">
        <template #body>
          <p class="text-sm">{{ m.account.revokeBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.cancel" variant="ghost" @click="revoking = null" />
          <UButton :label="m.tokens.revoke" color="error" @click="revokeApp" />
        </template>
      </UModal>
      <UModal v-model:open="endOpen" :title="m.account.endAllTitle">
        <template #body>
          <p class="text-sm">{{ m.account.endAllBody }}</p>
        </template>
        <template #footer>
          <UButton :label="m.common.cancel" variant="ghost" @click="endOpen = false" />
          <UButton :label="m.account.endAll" color="error" :loading="ending" @click="endAll" />
        </template>
      </UModal>
    </div>
    <UModal v-model:open="addOpen" :title="m.account.addPasskeyTitle">
      <template #body>
        <form id="add-passkey" @submit.prevent="addPasskey">
          <UFormField :label="m.account.passkeyLabel">
            <UInput v-model="addLabel" maxlength="100" class="w-full" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <UButton :label="m.common.cancel" variant="ghost" @click="addOpen = false" />
        <UButton type="submit" form="add-passkey" :label="m.account.addPasskey" :loading="adding" />
      </template>
    </UModal>
    <UModal
      :open="renaming !== null"
      :title="m.account.renamePasskeyTitle"
      @update:open="(open) => (open ? null : (renaming = null))"
    >
      <template #body>
        <form id="rename-passkey" @submit.prevent="renamePasskey">
          <UFormField :label="m.account.passkeyLabel">
            <UInput v-model="newLabel" maxlength="100" class="w-full" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <UButton :label="m.common.cancel" variant="ghost" @click="renaming = null" />
        <UButton
          type="submit"
          form="rename-passkey"
          :label="m.common.save"
          :disabled="newLabel.trim() === ''"
        />
      </template>
    </UModal>
  </Page>
</template>
