import * as client from '@hollware/client'
import { describe, expect, it } from 'vite-plus/test'

import * as vue from '../src/index.ts'

describe('the server helpers of @hollware/vue', () => {
  it('are the ones of @hollware/client', () => {
    expect(vue.createHollware).toBe(client.createHollware)
    expect(vue.hollwareBinding).toBe(client.hollwareBinding)
    expect(vue.isPreviewRequest).toBe(client.isPreviewRequest)
    expect(vue.PREVIEW_COOKIE).toBe(client.PREVIEW_COOKIE)
    expect(vue.previewCookieClear).toBe(client.previewCookieClear)
    expect(vue.previewHeaders).toBe(client.previewHeaders)
    expect(vue.previewRedirect).toBe(client.previewRedirect)
  })
})
