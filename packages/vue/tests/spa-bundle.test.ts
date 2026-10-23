import { fileURLToPath } from 'node:url'
import { build } from 'vite-plus'
import { describe, expect, it } from 'vite-plus/test'

describe('the bundle of a browser-only app', () => {
  it('holds the composables and the component, and no schema library or parser', async () => {
    const entry = fileURLToPath(new URL('./spa-entry.ts', import.meta.url))
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ['es'], fileName: 'spa' },
        rollupOptions: { external: ['vue'] },
      },
    })
    const chunks = (Array.isArray(output) ? output : [output]).flatMap((item) =>
      'output' in item ? item.output : [],
    )
    const code = chunks.map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n')

    expect(code).not.toContain('ZodError')
    expect(code).not.toContain('markdown-exit')
    expect(code.length).toBeLessThan(30_000)
  })
})
