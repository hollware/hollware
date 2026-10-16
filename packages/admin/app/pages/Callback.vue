<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessages } from '../i18n/index.ts'
import { auth } from '../lib/session.ts'

const router = useRouter()
const m = useMessages()
const failure = ref<string | null>(null)

onMounted(async () => {
  try {
    const back = await auth.complete(new URL(window.location.href))
    await router.replace(back.replace(/^\/admin/, '') || '/')
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
})

async function again() {
  await auth.signIn('/admin/')
}
</script>

<template>
  <UAlert
    v-if="failure !== null"
    color="error"
    :title="m.callback.notSignedIn"
    :description="failure"
    :actions="[{ label: m.callback.signInAgain, onClick: again }]"
  />
  <p v-else class="text-muted">{{ m.callback.signingIn }}</p>
</template>
