<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables'
import { onMounted, ref } from 'vue'
import { ApiError } from '../lib/api.ts'
import { api } from '../lib/session.ts'

interface People {
  people: { id: string; name: string | null; role: string; since: string }[]
  invitations: { id: string; role: string; expiresAt: string }[]
}

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
    toast.add({ title: 'Not invited', description: describe(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function copy() {
  if (link.value !== null) await navigator.clipboard.writeText(link.value)
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-semibold">People</h1>
    <UAlert
      v-if="failure !== null"
      color="warning"
      title="Only an owner invites people"
      :description="failure"
    />
    <template v-else-if="data !== null">
      <form class="flex items-end gap-3" @submit.prevent="invite">
        <UFormField label="Role" help="An editor publishes; an author's posts go through review.">
          <USelect v-model="role" :items="['author', 'editor']" class="w-40" />
        </UFormField>
        <UButton type="submit" label="Invite" :loading="busy" />
      </form>
      <UAlert
        v-if="link !== null"
        color="success"
        title="Send this link to the person: it works once, for 7 days"
        :description="link"
        :actions="[
          { label: 'Copy', onClick: copy },
          { label: 'Done', onClick: () => (link = null) },
        ]"
      />
      <section aria-label="Members" class="space-y-2">
        <h2 class="font-medium">Members</h2>
        <ul class="text-sm">
          <li
            v-for="person in data.people"
            :key="person.id"
            class="flex gap-3 border-t border-default py-2"
          >
            <span class="font-medium">{{ person.name ?? person.id }}</span>
            <UBadge :label="person.role" variant="subtle" />
          </li>
        </ul>
      </section>
      <section v-if="data.invitations.length > 0" aria-label="Invitations" class="space-y-2">
        <h2 class="font-medium">Waiting invitations</h2>
        <ul class="text-sm">
          <li
            v-for="invitation in data.invitations"
            :key="invitation.id"
            class="border-t border-default py-2"
          >
            {{ invitation.role }} · until {{ new Date(invitation.expiresAt).toLocaleDateString() }}
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
