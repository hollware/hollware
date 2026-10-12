import type { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { createProvider } from './provider.ts'

// The provider reads its options once, at construction, and the public URL is a var: build it on
// the first request and keep it. One URL per deployment, so there is one instance per isolate.
const providers = new Map<string, OAuthProvider<Env>>()

function providerFor(publicUrl: string): OAuthProvider<Env> {
  const existing = providers.get(publicUrl)
  if (existing !== undefined) return existing
  const created = createProvider(publicUrl)
  providers.set(publicUrl, created)
  return created
}

export default {
  fetch(request, env, ctx) {
    return providerFor(env.HOLLWARE_PUBLIC_URL).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
