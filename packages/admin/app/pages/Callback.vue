<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { auth } from '../lib/session.ts'

const router = useRouter()
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
    title="You are not signed in"
    :description="failure"
    :actions="[{ label: 'Sign in again', onClick: again }]"
  />
  <p v-else class="text-muted">Signing in…</p>
</template>
