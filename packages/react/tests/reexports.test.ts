import * as client from '@hollware/client'
import { describe, expect, it } from 'vite-plus/test'

import * as react from '../src/index.ts'

// Fails when: @hollware/react stops re-exporting one of the server helpers of @hollware/client
// (or exports another function under its name), so a React app loses a name it imports.

describe('the server helpers of @hollware/react', () => {
  it('are the ones of @hollware/client', () => {
    expect(react.createHollware).toBe(client.createHollware)
    expect(react.hollwareBinding).toBe(client.hollwareBinding)
    expect(react.isPreviewRequest).toBe(client.isPreviewRequest)
    expect(react.PREVIEW_COOKIE).toBe(client.PREVIEW_COOKIE)
    expect(react.previewCookieClear).toBe(client.previewCookieClear)
    expect(react.previewHeaders).toBe(client.previewHeaders)
    expect(react.previewRedirect).toBe(client.previewRedirect)
  })
})
