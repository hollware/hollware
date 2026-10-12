import { createBaseApp } from './app.ts'

// The S1 Worker: nothing but a Hono 5 app. Its build is the Hono-only size baseline.
const app = createBaseApp()

// What this isolate has: the Worker is configured with no_nodejs_compat and no_nodejs_compat_v2.
app.get('/__runtime', (c) => {
  const globals: Record<string, unknown> = globalThis
  return c.json({
    process: typeof globals.process,
    Buffer: typeof globals.Buffer,
    setImmediate: typeof globals.setImmediate,
    userAgent: navigator.userAgent,
  })
})

export default app
